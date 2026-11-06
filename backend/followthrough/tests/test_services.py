from datetime import date
from unittest.mock import patch

from django.db import IntegrityError
from django.test import TestCase

from followthrough.models import Meeting, Suggestion, Task, Workspace
from followthrough.services import ServiceError, dashboard, import_meeting, review_suggestion, seed_demo, update_task


class WorkflowTests(TestCase):
    def setUp(self):
        self.workspace = Workspace.objects.create()
        self.other = Workspace.objects.create()

    def meeting(self, notes="ACTION [Maya] Ship export | due:2026-11-12", title="Export sync", workspace=None):
        return import_meeting(workspace or self.workspace, title, notes, date(2026, 11, 5))[0]

    def test_import_is_normalized_and_idempotent_with_original_evidence(self):
        notes = "Intro\r\n  ACTION [Maya] Ship export  \r\n"
        original, duplicate = import_meeting(self.workspace, " Export  SYNC ", notes, date(2026, 11, 5))
        replay, replay_duplicate = import_meeting(self.workspace, "export sync", "Intro\n  ACTION [Maya] Ship export\n", date(2026, 11, 5))
        self.assertFalse(duplicate)
        self.assertTrue(replay_duplicate)
        self.assertEqual(original.id, replay.id)
        self.assertEqual(replay.notes, notes)
        self.assertEqual(Meeting.objects.count(), 1)
        self.assertEqual(Suggestion.objects.count(), 1)
        self.assertEqual(replay.suggestions.get().source_quote, "  ACTION [Maya] Ship export  ")

    def test_same_input_in_another_workspace_is_separate(self):
        self.meeting()
        self.meeting(workspace=self.other)
        self.assertEqual(Meeting.objects.count(), 2)
        self.assertEqual(len(dashboard(self.workspace)["meetings"]), 1)

    def test_validation_writes_nothing(self):
        for title, notes in [(" ", "ACTION: Ship"), ("x" * 161, "ACTION: Ship"), ("Sync", " "), ("Sync", "x" * 20_001), ("Sync", "ACTION: Ship | due:2026-02-30")]:
            with self.subTest(title=title[:10], notes=notes[:50]), self.assertRaises(ServiceError):
                import_meeting(self.workspace, title, notes, date(2026, 11, 5))
        self.assertEqual(Meeting.objects.count(), 0)
        self.assertEqual(Suggestion.objects.count(), 0)

    def test_unmarked_notes_are_preserved_without_suggestions(self):
        meeting = self.meeting("Maya will ship tomorrow. This is intentionally unmarked prose.")
        self.assertEqual(meeting.suggestions.count(), 0)
        self.assertEqual(Task.objects.count(), 0)

    def test_accept_edits_and_null_date_preserve_source_and_create_one_task(self):
        suggestion = self.meeting().suggestions.get()
        reviewed, task = review_suggestion(self.workspace, suggestion.id, "ACCEPT", title="Review export", owner="Jordan", due_date=None)
        replayed, replay_task = review_suggestion(self.workspace, suggestion.id, "ACCEPT", title="Ignored replay")
        self.assertEqual((reviewed.review_state, task.title, task.owner, task.due_date), ("ACCEPTED", "Review export", "Jordan", None))
        self.assertEqual((replayed.id, replay_task.id), (reviewed.id, task.id))
        self.assertEqual(Task.objects.count(), 1)
        self.assertEqual(replay_task.title, "Review export")
        self.assertEqual(task.suggestion.source_quote, "ACTION [Maya] Ship export | due:2026-11-12")

    def test_omitted_date_preserves_extracted_date_and_empty_owner_clears(self):
        suggestion = self.meeting().suggestions.get()
        _, task = review_suggestion(self.workspace, suggestion.id, "ACCEPT", owner="")
        self.assertEqual(task.due_date, date(2026, 11, 12))
        self.assertEqual(task.owner, "")

    def test_decision_acceptance_never_creates_a_task(self):
        suggestion = self.meeting("DECISION: Use CSV").suggestions.get()
        reviewed, task = review_suggestion(self.workspace, suggestion.id, "ACCEPT")
        self.assertEqual(reviewed.review_state, "ACCEPTED")
        self.assertIsNone(task)
        self.assertEqual(Task.objects.count(), 0)

    def test_rejection_is_idempotent_and_final(self):
        suggestion = self.meeting().suggestions.get()
        review_suggestion(self.workspace, suggestion.id, "REJECT")
        review_suggestion(self.workspace, suggestion.id, "REJECT")
        with self.assertRaises(ServiceError) as conflict:
            review_suggestion(self.workspace, suggestion.id, "ACCEPT")
        self.assertEqual(conflict.exception.code, "CONFLICT")
        self.assertEqual(Task.objects.count(), 0)

    def test_invalid_review_edits_leave_state_pending(self):
        suggestion = self.meeting().suggestions.get()
        for edits in [{"title": " "}, {"title": None}, {"owner": "x" * 81}, {"owner": None}]:
            with self.subTest(edits=edits), self.assertRaises(ServiceError):
                review_suggestion(self.workspace, suggestion.id, "ACCEPT", **edits)
        suggestion.refresh_from_db()
        self.assertEqual(suggestion.review_state, "PENDING")
        self.assertEqual(Task.objects.count(), 0)

    def test_task_creation_failure_rolls_back_review_and_edits(self):
        suggestion = self.meeting().suggestions.get()
        with patch("followthrough.services.Task.objects.create", side_effect=IntegrityError("simulated constraint failure")):
            with self.assertRaises(IntegrityError):
                review_suggestion(self.workspace, suggestion.id, "ACCEPT", title="Edited")
        suggestion.refresh_from_db()
        self.assertEqual((suggestion.review_state, suggestion.title), ("PENDING", "Ship export"))
        self.assertFalse(Task.objects.exists())

    def test_every_read_and_write_is_workspace_scoped(self):
        suggestion = self.meeting(workspace=self.other).suggestions.get()
        _, task = review_suggestion(self.other, suggestion.id, "ACCEPT")
        self.assertEqual(dashboard(self.workspace)["meetings"], [])
        self.assertEqual(dashboard(self.workspace)["tasks"], [])
        for action in [lambda: review_suggestion(self.workspace, suggestion.id, "REJECT"), lambda: update_task(self.workspace, task.id, "DONE", 1)]:
            with self.assertRaises(ServiceError) as missing:
                action()
            self.assertEqual(missing.exception.code, "NOT_FOUND")
        task.refresh_from_db()
        self.assertEqual((task.status, task.version), ("TODO", 1))

    def test_invalid_ids_do_not_raise_database_errors(self):
        for value in ["not-a-uuid", "", "123"]:
            for action in [lambda: review_suggestion(self.workspace, value, "ACCEPT"), lambda: update_task(self.workspace, value, "DONE", 1)]:
                with self.subTest(value=value), self.assertRaises(ServiceError) as missing:
                    action()
                self.assertEqual(missing.exception.code, "NOT_FOUND")

    def test_optimistic_version_prevents_lost_updates(self):
        _, task = review_suggestion(self.workspace, self.meeting().suggestions.get().id, "ACCEPT")
        changed = update_task(self.workspace, task.id, "IN_PROGRESS", 1)
        self.assertEqual((changed.status, changed.version), ("IN_PROGRESS", 2))
        with self.assertRaises(ServiceError) as conflict:
            update_task(self.workspace, task.id, "DONE", 1)
        self.assertEqual(conflict.exception.code, "CONFLICT")
        task.refresh_from_db()
        self.assertEqual((task.status, task.version), ("IN_PROGRESS", 2))

    def test_workspace_limits_allow_replays_and_reject_new_work(self):
        meeting = self.meeting()
        with patch("followthrough.services.MAX_MEETINGS", 1):
            self.assertTrue(import_meeting(self.workspace, meeting.title, meeting.notes, meeting.meeting_date)[1])
            with self.assertRaises(ServiceError) as limited:
                self.meeting(title="Second")
            self.assertEqual(limited.exception.code, "LIMIT_EXCEEDED")
        with patch("followthrough.services.MAX_TASKS", 0):
            with self.assertRaises(ServiceError) as limited:
                review_suggestion(self.workspace, meeting.suggestions.get().id, "ACCEPT")
            self.assertEqual(limited.exception.code, "LIMIT_EXCEEDED")
        self.assertEqual(meeting.suggestions.get().review_state, "PENDING")

    @patch("followthrough.services.timezone.localdate", return_value=date(2026, 11, 5))
    def test_metric_denominators_and_overdue_boundaries(self, _today):
        meeting = self.meeting("\n".join([
            "ACTION: Open overdue | due:2026-11-04", "ACTION: Done overdue | due:2026-11-03",
            "ACTION: Due today | due:2026-11-05", "DECISION: CSV first", "ACTION: Unreviewed",
        ]))
        suggestions = list(meeting.suggestions.all())
        for suggestion in suggestions[:4]:
            _, task = review_suggestion(self.workspace, suggestion.id, "ACCEPT")
            if task and suggestion == suggestions[1]:
                update_task(self.workspace, task.id, "DONE", 1)
        metrics = dashboard(self.workspace)["metrics"]
        self.assertEqual(metrics, {"total_tasks": 3, "done_tasks": 1, "overdue_tasks": 1, "completion_rate": 33.3, "review_rate": 80.0, "pending_suggestions": 1, "meetings_count": 1, "as_of": date(2026, 11, 5)})
        self.assertEqual(dashboard(self.other)["metrics"]["completion_rate"], 0.0)
        self.assertEqual(dashboard(self.other)["metrics"]["review_rate"], 0.0)

    def test_seed_is_idempotent_retains_user_data_and_does_not_reset_status(self):
        self.meeting(title="My notes")
        first = seed_demo(self.workspace)
        task = first["tasks"][0]
        update_task(self.workspace, task.id, "DONE", task.version)
        before = list(Task.objects.values_list("id", "status", "version"))
        second = seed_demo(self.workspace)
        self.assertEqual(len(first["meetings"]), 3)
        self.assertEqual(len(second["meetings"]), 3)
        self.assertEqual(list(Task.objects.values_list("id", "status", "version")), before)
        self.assertTrue(Meeting.objects.filter(title="My notes").exists())

    def test_metric_midpoints_round_up_for_browser_adapter_parity(self):
        suggestions = list(self.meeting("\n".join(f"ACTION: Task {number}" for number in range(16))).suggestions.all())
        _, first_task = review_suggestion(self.workspace, suggestions[0].id, "ACCEPT")
        self.assertEqual(dashboard(self.workspace)["metrics"]["review_rate"], 6.3)
        update_task(self.workspace, first_task.id, "DONE", 1)
        for suggestion in suggestions[1:]:
            review_suggestion(self.workspace, suggestion.id, "ACCEPT")
        self.assertEqual(dashboard(self.workspace)["metrics"]["completion_rate"], 6.3)
