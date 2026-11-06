# Product specification

## Problem and user

A meeting facilitator needs to turn structured notes into a small set of agreed actions and decisions without losing the context behind them. Copying a sentence into a task board often drops the original wording, owner or due date. Proofline preserves that evidence through review and follow-through.

The initial user is a student project lead or individual meeting facilitator working in one browser. Owner names describe people in the notes; they are labels, not registered accounts or shared access permissions.

## Primary workflow

1. Paste a meeting title, date and notes containing explicit action/decision markers.
2. Review suggestions beside their original source lines.
3. Correct an action's title, owner or due date before accepting it.
4. Move accepted actions through To do, In progress and Done.
5. Filter tasks, inspect source evidence and export a snapshot for sharing.
6. Read the metric definitions before interpreting completion and review progress.

## Acceptance criteria

| Capability | Observable behavior | Verification |
|---|---|---|
| Ingestion | Invalid marked dates reject the entire import; unmarked prose remains notes | Parser and API tests |
| Evidence | The exact source quote and 1-based line number survive edits, approval and reload | Backend and browser tests |
| Human review | Pending suggestions may be edited; accept/reject decisions are final and replay-safe | Service and HTTP tests |
| Task uniqueness | Repeated or concurrent approval creates one task | Database constraint and HTTP concurrency test |
| Import uniqueness | Replaying the same normalized title/date/notes in one workspace returns the original meeting | Unit, HTTP and browser tests |
| Version safety | A stale task update returns a conflict and preserves the latest state | API regression test |
| Workspace boundary | A second browser session cannot read or mutate the first workspace's objects | Isolated-context tests |
| CSRF | Mutations require the session's token and a matching origin | Real HTTP tests |
| Responsive UI | Import and review remain usable at a narrow viewport without horizontal overflow | Browser test and visual review |
| Metrics | Counts, denominators, date rules and rounding are explicit | Service and adapter checks |

## Metrics

- **Completion:** done tasks / all tasks, expressed as a percentage.
- **Review progress:** accepted or rejected suggestions / all suggestions.
- **Overdue:** unfinished tasks whose due date precedes the displayed as-of date.
- **Pending suggestions:** suggestions that have not been accepted or rejected.

Empty denominators produce zero. Percentage ties round half-up to one decimal place. These are workspace state summaries; the project has no measured adoption or productivity study.

## Delivery scope

The full-stack app uses Django sessions, SQL and GraphQL. The hosted demonstration uses a separately labeled browser-only adapter with synthetic data and local persistence. The demo's successful interactions do not establish that a server-side database is hosted at that URL.

The extractor uses an explicit deterministic grammar. Free-form language extraction, external LLM calls, shared accounts and enterprise integrations are future work. The existing app works without a paid service or API key.

## Engineering review decisions

- **Preserve the original Host through proxies.** A valid browser POST from port 5173 or 8080 must reach Django with that port intact. Vite and Nginx preserve it so the built-in origin/CSRF checks continue to work.
- **Reserve SQLite writes before service reads.** A real concurrent-import test exposed a deferred read-to-write lock upgrade failure. SQLite transactions now use IMMEDIATE mode with a bounded timeout; PostgreSQL keeps its own locking behavior.
- **Define cross-language rounding.** Python's default tie handling differed from the JavaScript demo at 1/16. A shared half-up rule now produces 6.3% in both modes.
- **Validate persisted relationships.** Browser demo data is checked before use; malformed evidence links produce a recoverable error without silently erasing stored notes.

These decisions came from executable checks during AI-assisted implementation and review. See [the architecture](architecture.md), [API contract](api.md) and [interview guide](interview-guide.md) for the code and trade-offs.
