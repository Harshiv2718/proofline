import json
from datetime import date

from django.test import Client, TestCase

from followthrough.models import Meeting, Workspace
from followthrough.services import import_meeting

IMPORT = """mutation Import($title:String!, $notes:String!, $meetingDate:Date!) {
  importMeeting(title:$title, notes:$notes, meetingDate:$meetingDate) {
    duplicate meeting { id title meetingDate notes createdAt suggestions { id kind title owner dueDate sourceLine sourceQuote reviewState taskId } }
  }
}"""
REVIEW = """mutation Review($id:ID!, $decision:ReviewDecision!, $dueDate:Date) {
  reviewSuggestion(id:$id, decision:$decision, dueDate:$dueDate) {
    suggestion { id reviewState taskId dueDate }
    task { id title owner dueDate status version meetingId meetingTitle suggestionId sourceLine sourceQuote updatedAt }
  }
}"""


class ApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.session_info = self.client.get("/api/session/").json()
        self.token = self.session_info["csrfToken"]

    def graphql(self, query, variables=None, client=None, token=None):
        return (client or self.client).post("/graphql/", data=json.dumps({"query": query, "variables": variables or {}}), content_type="application/json", HTTP_X_CSRFTOKEN=token or self.token)

    def imported(self):
        result = self.graphql(IMPORT, {"title": "Export sync", "notes": "ACTION [Maya] Ship export | due:2026-11-12\nDECISION: Use CSV", "meetingDate": "2026-11-05"}).json()
        self.assertNotIn("errors", result)
        return result["data"]["importMeeting"]["meeting"]

    def test_session_is_stable_and_not_cached(self):
        response = self.client.get("/api/session/")
        self.assertEqual(response.json()["workspaceId"], self.session_info["workspaceId"])
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertTrue(self.client.cookies["sessionid"]["httponly"])

    def test_csrf_is_required_on_graphql(self):
        response = self.client.post("/graphql/", data=json.dumps({"query": "mutation { seedDemo { dashboard { metrics { totalTasks } } } }"}), content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Meeting.objects.count(), 0)

    def test_no_workspace_argument_is_accepted(self):
        response = self.graphql("query { dashboard(workspaceId: \"other\") { metrics { totalTasks } } }").json()
        self.assertIn("errors", response)

    def test_session_required_for_query(self):
        response = Client().get("/graphql/", {"query": "{ dashboard { metrics { totalTasks } } }"}).json()
        self.assertEqual(response["errors"][0]["extensions"]["code"], "SESSION_REQUIRED")

    def test_complete_graphql_workflow_and_source_fields(self):
        meeting = self.imported()
        self.assertEqual(meeting["suggestions"][0]["sourceLine"], 1)
        self.assertEqual(meeting["suggestions"][0]["reviewState"], "PENDING")
        result = self.graphql(REVIEW, {"id": meeting["suggestions"][0]["id"], "decision": "ACCEPT", "dueDate": None}).json()
        self.assertNotIn("errors", result)
        reviewed = result["data"]["reviewSuggestion"]
        self.assertEqual(reviewed["suggestion"]["taskId"], reviewed["task"]["id"])
        self.assertEqual(reviewed["task"]["meetingId"], meeting["id"])
        self.assertEqual(reviewed["task"]["sourceQuote"], meeting["suggestions"][0]["sourceQuote"])
        self.assertIsNone(reviewed["task"]["dueDate"])
        update = "mutation Update($id:ID!,$version:Int!) { updateTask(id:$id,status:DONE,expectedVersion:$version) { task { status version } } }"
        variables = {"id": reviewed["task"]["id"], "version": 1}
        changed = self.graphql(update, variables).json()
        self.assertEqual(changed["data"]["updateTask"]["task"], {"status": "DONE", "version": 2})
        conflict = self.graphql(update, variables).json()
        self.assertEqual(conflict["errors"][0]["extensions"]["code"], "CONFLICT")

    def test_cross_browser_dashboard_and_mutation_isolation(self):
        foreign = Workspace.objects.create()
        meeting, _ = import_meeting(foreign, "Foreign notes", "ACTION: Private action", date(2026, 11, 5))
        response = self.graphql("{ dashboard { meetings { id } tasks { id } metrics { totalTasks meetingsCount } } }").json()
        self.assertEqual(response["data"]["dashboard"]["meetings"], [])
        result = self.graphql(REVIEW, {"id": str(meeting.suggestions.get().id), "decision": "ACCEPT"}).json()
        self.assertEqual(result["errors"][0]["extensions"]["code"], "NOT_FOUND")
        meeting.suggestions.get().refresh_from_db()
        self.assertEqual(meeting.suggestions.get().review_state, "PENDING")

    def test_invalid_date_and_blank_title_are_rejected(self):
        bad_date = self.graphql(IMPORT, {"title": "Sync", "notes": "ACTION: Ship", "meetingDate": "2026-02-30"}).json()
        self.assertIn("errors", bad_date)
        bad_title = self.graphql(IMPORT, {"title": " ", "notes": "ACTION: Ship", "meetingDate": "2026-11-05"}).json()
        self.assertEqual(bad_title["errors"][0]["extensions"]["code"], "VALIDATION_ERROR")
        self.assertEqual(Meeting.objects.count(), 0)

    def test_full_length_unicode_notes_fit_transport_limit(self):
        notes = "🙂" * 20_000
        response = self.graphql(IMPORT, {"title": "Unicode notes", "notes": notes, "meetingDate": "2026-11-05"}).json()
        self.assertNotIn("errors", response)
        self.assertEqual(response["data"]["importMeeting"]["meeting"]["notes"], notes)

    def test_mutation_over_get_is_rejected(self):
        response = self.client.get("/graphql/", {"query": "mutation { seedDemo { dashboard { metrics { totalTasks } } } }"})
        self.assertEqual(response.status_code, 405)
        self.assertEqual(Meeting.objects.count(), 0)

    def test_health_is_read_only(self):
        before = Workspace.objects.count()
        response = Client().get("/api/health/")
        self.assertEqual(response.json()["extractor"], "deterministic-rules-v1")
        self.assertEqual(Workspace.objects.count(), before)

    def test_seed_response_has_a_complete_dashboard(self):
        response = self.graphql("mutation { seedDemo { dashboard { meetings { id suggestions { id } } tasks { id version } metrics { totalTasks doneTasks overdueTasks completionRate reviewRate pendingSuggestions meetingsCount asOf } } } }").json()
        self.assertNotIn("errors", response)
        self.assertEqual(response["data"]["seedDemo"]["dashboard"]["metrics"]["totalTasks"], 3)
