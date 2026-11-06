# API and extraction contract

The canonical schema is [`backend/schema.graphql`](../backend/schema.graphql). GraphQL uses camelCase names. IDs are UUID strings in the Django-backed application. `Date` values use `YYYY-MM-DD`; `DateTime` values are ISO 8601 timestamps.

## Session and transport

| Endpoint | Method | Behavior |
| --- | --- | --- |
| `/api/session/` | GET | Create/reuse anonymous workspace; return `{csrfToken, workspaceId}`; `Cache-Control: no-store` |
| `/api/health/` | GET | Return `{status:"ok", service:"proofline", extractor:"deterministic-rules-v1"}`; no database readiness guarantee |
| `/graphql/` | POST | Queries and mutations with the Django session cookie and `X-CSRFToken` header |

The frontend first calls `/api/session/` with same-origin credentials, then sends the returned CSRF token with GraphQL requests. `workspaceId` is informational. Requests cannot choose a workspace. GET GraphQL queries are supported for debug tooling, but mutations over GET are rejected. The browser IDE is enabled only when `DJANGO_DEBUG=true`.

## Grammar

```text
ACTION [Maya] Ship export | due:2026-11-12
ACTION [Maya] Ship export
ACTION: Ship export
DECISION: Start with CSV
```

Markers are case sensitive. Leading whitespace and an optional `-` or `*` bullet are accepted. An action must use `[owner]` or a colon; `[owner]` may be empty. Spaces around the owner, title, bullet and `|` are trimmed for the proposal. The source quote retains the complete original line, excluding its line terminator. Source lines are 1-based and include blank/prose lines in the count.

The optional action metadata suffix is `| due:YYYY-MM-DD`, with no space between `due:` and its value. Dates must be real calendar dates. A recognized action with an invalid date or unsupported `|` metadata rejects the entire import. Title text before the due suffix may contain `|` characters; only the last recognized due suffix is parsed. Without a recognized suffix, any `|` in an action is rejected. A decision treats its entire suffix as text and has no extracted owner or due date.

Unrecognized lines, lowercase markers and incomplete markers yield no suggestion; they remain in the notes. The parser does not understand ordinary prose, relative dates, implied owners, speaker attribution or natural-language commitments. No LLM adapter is implemented.

| Bound | Limit |
| --- | --- |
| Meeting title | 1–160 characters after trimming |
| Meeting notes | Nonblank, at most 20,000 characters before trimming |
| Suggestion title | 1–160 characters after trimming |
| Owner | At most 80 characters after trimming; empty allowed |
| Marked suggestions | 100 per meeting |
| Meetings | 100 per workspace |
| Tasks | 500 per workspace |

## Dashboard query

```graphql
query Dashboard {
  dashboard {
    meetings {
      id title meetingDate notes createdAt
      suggestions {
        id kind title owner dueDate sourceLine sourceQuote reviewState taskId
      }
    }
    tasks {
      id title owner dueDate status version meetingId meetingTitle suggestionId
      sourceLine sourceQuote updatedAt
    }
    metrics {
      totalTasks doneTasks overdueTasks completionRate reviewRate
      pendingSuggestions meetingsCount asOf
    }
  }
}
```

`kind` is `ACTION | DECISION`. `reviewState` is `PENDING | ACCEPTED | REJECTED`. `status` is `TODO | IN_PROGRESS | DONE`. `taskId` is null until an action is accepted and is always null for decisions. Rates are percentages from 0 to 100, rounded to one decimal. See [metric definitions](architecture.md#metrics).

## Import

```graphql
mutation Import($title: String!, $notes: String!, $meetingDate: Date!) {
  importMeeting(title: $title, notes: $notes, meetingDate: $meetingDate) {
    duplicate
    meeting { id title suggestions { id title kind sourceLine sourceQuote reviewState } }
  }
}
```

An import creates a meeting and pending suggestions atomically. It never creates tasks. Normalized duplicates within the same workspace return the first meeting with `duplicate: true`. The normalization is documented in [architecture](architecture.md#import-and-review).

## Review

```graphql
mutation Review($id: ID!, $decision: ReviewDecision!, $title: String, $owner: String, $dueDate: Date) {
  reviewSuggestion(id: $id, decision: $decision, title: $title, owner: $owner, dueDate: $dueDate) {
    suggestion { id title owner dueDate reviewState taskId }
    task { id title status version sourceLine sourceQuote }
  }
}
```

`decision` is `ACCEPT | REJECT`. On acceptance, omitted edit arguments preserve the existing proposal. `dueDate: null` clears a date and `owner: ""` clears an owner. `title: null`, a blank title and `owner: null` are invalid on acceptance. Rejection ignores edit arguments. Accepting an action creates exactly one task; accepting a decision creates none. Repeating a final decision is idempotent and ignores edits. The opposite final decision returns `CONFLICT`.

## Task status

```graphql
mutation Update($id: ID!, $status: TaskStatus!, $expectedVersion: Int!) {
  updateTask(id: $id, status: $status, expectedVersion: $expectedVersion) {
    task { id status version updatedAt }
  }
}
```

Tasks start at version 1. A successful update increments the version. A stale `expectedVersion` returns `CONFLICT` and leaves the stored task unchanged. The caller should refresh the dashboard and ask the person to retry using the new version. The API updates status only; there is no general task-edit mutation.

## Synthetic seed

```graphql
mutation Seed {
  seedDemo {
    dashboard { meetings { id title } tasks { id status version } metrics { totalTasks asOf } }
  }
}
```

The server seed adds two synthetic meetings with relative dates, reviewed and pending suggestions, and tasks in all three statuses. Seeding is transactional and recorded per workspace. Repeating it preserves user meetings and task changes; it does not delete/reset data or add new dated copies the next day. The browser-only demonstration uses its own synthetic seed and storage adapter.

## Errors

Application errors appear in GraphQL's `errors` array, usually with HTTP 200. Use `errors[0].message` for a human-readable explanation and `errors[0].extensions.code` for application handling. GraphQL type validation errors may have no application code. CSRF failures use HTTP 403; unsupported methods use an appropriate HTTP error.

| Code | Meaning |
| --- | --- |
| `VALIDATION_ERROR` | Input violates a domain bound or grammar rule |
| `NOT_FOUND` | Unknown object, malformed object ID, or object in another workspace |
| `CONFLICT` | Stale task version or contradictory final review |
| `LIMIT_EXCEEDED` | Workspace meeting/task capacity reached |
| `SESSION_REQUIRED` | Call `/api/session/` to initialize/reinitialize browser access |

Example:

```json
{"errors":[{"message":"This task changed in another tab. Refresh before updating it.","extensions":{"code":"CONFLICT"}}],"data":{"updateTask":null}}
```
