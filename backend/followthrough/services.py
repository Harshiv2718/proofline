"""Workspace-scoped application rules shared by GraphQL and the demo seed."""
import hashlib
import json
import uuid
from datetime import timedelta
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import Meeting, Suggestion, Task, Workspace
from .parser import InputError, parse_notes

MAX_MEETINGS = 100
MAX_TASKS = 500
UNSET = object()


def percentage(numerator, denominator):
    if not denominator:
        return 0.0
    return float((Decimal(numerator) * 100 / Decimal(denominator)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


class ServiceError(ValueError):
    def __init__(self, message, code="VALIDATION_ERROR"):
        super().__init__(message)
        self.code = code


def required_text(value, label, limit):
    value = value.strip()
    if not value or len(value) > limit:
        raise ServiceError(f"{label} must contain 1–{limit} characters.")
    return value


def object_id(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ServiceError("Item not found in this workspace.", "NOT_FOUND") from exc


def get_workspace(request):
    workspace_id = request.session.get("workspace_id")
    if not workspace_id:
        raise ServiceError("Initialize your workspace before using the API.", "SESSION_REQUIRED")
    workspace = Workspace.objects.filter(id=object_id(workspace_id)).first()
    if workspace is None:
        raise ServiceError("Initialize your workspace before using the API.", "SESSION_REQUIRED")
    return workspace


def normalized_hash(title, meeting_date, notes):
    normalized_notes = "\n".join(line.rstrip() for line in notes.replace("\r\n", "\n").replace("\r", "\n").splitlines()).strip()
    payload = [" ".join(title.split()).casefold(), meeting_date.isoformat(), normalized_notes]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode("utf-8")).hexdigest()


@transaction.atomic
def import_meeting(workspace, title, notes, meeting_date):
    title = required_text(title, "Meeting title", 160)
    if not notes.strip() or len(notes) > 20_000:
        raise ServiceError("Notes must contain 1–20,000 characters.")
    try:
        parsed = parse_notes(notes)
    except InputError as exc:
        raise ServiceError(str(exc)) from exc
    import_hash = normalized_hash(title, meeting_date, notes)
    Workspace.objects.select_for_update().get(id=workspace.id)
    existing = Meeting.objects.filter(workspace=workspace, import_hash=import_hash).first()
    if existing:
        return existing, True
    if Meeting.objects.filter(workspace=workspace).count() >= MAX_MEETINGS:
        raise ServiceError("This workspace has reached the 100-meeting limit.", "LIMIT_EXCEEDED")
    meeting = Meeting.objects.create(workspace=workspace, title=title, notes=notes, meeting_date=meeting_date, import_hash=import_hash)
    Suggestion.objects.bulk_create([
        Suggestion(meeting=meeting, kind=item.kind, title=item.title, owner=item.owner,
                   due_date=item.due_date, source_line=item.source_line, source_quote=item.source_quote)
        for item in parsed
    ])
    return meeting, False


@transaction.atomic
def review_suggestion(workspace, suggestion_id, decision, *, title=UNSET, owner=UNSET, due_date=UNSET):
    Workspace.objects.select_for_update().get(id=workspace.id)
    suggestion = Suggestion.objects.select_for_update().filter(id=object_id(suggestion_id), meeting__workspace=workspace).first()
    if suggestion is None:
        raise ServiceError("Item not found in this workspace.", "NOT_FOUND")
    target = {"ACCEPT": "ACCEPTED", "REJECT": "REJECTED"}.get(decision)
    if target is None:
        raise ServiceError("Review decision must be ACCEPT or REJECT.")
    if suggestion.review_state != Suggestion.ReviewState.PENDING:
        if suggestion.review_state != target:
            raise ServiceError("This suggestion has already been reviewed. Refresh to see its current state.", "CONFLICT")
        # Replays do not apply edits or create a second task.
        return suggestion, Task.objects.filter(suggestion=suggestion).first()
    if target == Suggestion.ReviewState.REJECTED:
        suggestion.review_state = target
        suggestion.save(update_fields=["review_state"])
        return suggestion, None
    if title is not UNSET:
        if title is None:
            raise ServiceError("Suggestion title cannot be null.")
        suggestion.title = required_text(title, "Suggestion title", 160)
    if owner is not UNSET:
        if owner is None or len(owner.strip()) > 80:
            raise ServiceError("Owner must contain at most 80 characters; use an empty string to clear it.")
        suggestion.owner = owner.strip()
    if due_date is not UNSET:
        suggestion.due_date = due_date
    task = None
    if suggestion.kind == Suggestion.Kind.ACTION:
        if Task.objects.filter(suggestion__meeting__workspace=workspace).count() >= MAX_TASKS:
            raise ServiceError("This workspace has reached the 500-task limit.", "LIMIT_EXCEEDED")
        task = Task.objects.create(suggestion=suggestion, title=suggestion.title, owner=suggestion.owner, due_date=suggestion.due_date)
    suggestion.review_state = target
    suggestion.save(update_fields=["title", "owner", "due_date", "review_state"])
    return suggestion, task


@transaction.atomic
def update_task(workspace, task_id, status, expected_version):
    task = Task.objects.filter(id=object_id(task_id), suggestion__meeting__workspace=workspace).first()
    if task is None:
        raise ServiceError("Item not found in this workspace.", "NOT_FOUND")
    if status not in Task.Status.values:
        raise ServiceError("Task status must be TODO, IN_PROGRESS or DONE.")
    if expected_version < 1:
        raise ServiceError("Expected version must be a positive integer.")
    updated = Task.objects.filter(id=task.id, version=expected_version).update(status=status, version=F("version") + 1, updated_at=timezone.now())
    if updated != 1:
        raise ServiceError("This task changed in another tab. Refresh before updating it.", "CONFLICT")
    task.refresh_from_db()
    return task


def dashboard(workspace):
    tasks = list(Task.objects.filter(suggestion__meeting__workspace=workspace).select_related("suggestion__meeting"))
    meetings = list(Meeting.objects.filter(workspace=workspace).prefetch_related("suggestions__task"))
    suggestions = [suggestion for meeting in meetings for suggestion in meeting.suggestions.all()]
    today = timezone.localdate()
    done = sum(task.status == Task.Status.DONE for task in tasks)
    reviewed = sum(suggestion.review_state != Suggestion.ReviewState.PENDING for suggestion in suggestions)
    return {
        "meetings": meetings,
        "tasks": tasks,
        "metrics": {
            "total_tasks": len(tasks),
            "done_tasks": done,
            "overdue_tasks": sum(task.due_date is not None and task.due_date < today and task.status != Task.Status.DONE for task in tasks),
            "completion_rate": percentage(done, len(tasks)),
            "review_rate": percentage(reviewed, len(suggestions)),
            "pending_suggestions": len(suggestions) - reviewed,
            "meetings_count": len(meetings),
            "as_of": today,
        },
    }


@transaction.atomic
def seed_demo(workspace):
    workspace = Workspace.objects.select_for_update().get(id=workspace.id)
    if workspace.demo_seeded:
        return dashboard(workspace)
    today = timezone.localdate()
    first, _ = import_meeting(workspace, "Product sync · export pilot", "\n".join([
        "Synthetic demo notes. The team is planning a lightweight export pilot.",
        f"ACTION [Maya] Draft the CSV export specification | due:{(today - timedelta(days=2)).isoformat()}",
        f"ACTION [Jordan] Add validation for empty exports | due:{(today + timedelta(days=2)).isoformat()}",
        "DECISION: Start with CSV before adding spreadsheet formats.",
        f"ACTION [Sam] Ask pilot reviewers for accessibility feedback | due:{(today + timedelta(days=5)).isoformat()}",
    ]), today - timedelta(days=3))
    first_suggestions = list(first.suggestions.all())
    for suggestion in first_suggestions[:3]:
        _, task = review_suggestion(workspace, suggestion.id, "ACCEPT")
        if task and suggestion == first_suggestions[1]:
            update_task(workspace, task.id, "IN_PROGRESS", task.version)
    second, _ = import_meeting(workspace, "Engineering check-in · review workflow", "\n".join([
        "Synthetic demo notes. Every extracted item needs a person to review it.",
        f"ACTION [Alex] Add source-line links to the review panel | due:{(today - timedelta(days=1)).isoformat()}",
        "DECISION: Keep automatic extraction limited to explicit action and decision markers.",
        "ACTION [Taylor] Explore a calendar integration",
    ]), today - timedelta(days=1))
    second_suggestions = list(second.suggestions.all())
    _, completed = review_suggestion(workspace, second_suggestions[0].id, "ACCEPT")
    update_task(workspace, completed.id, "DONE", completed.version)
    review_suggestion(workspace, second_suggestions[2].id, "REJECT")
    workspace.demo_seeded = True
    workspace.save(update_fields=["demo_seeded"])
    return dashboard(workspace)
