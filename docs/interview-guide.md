# Proofline interview walkthrough

Use this guide to understand and demonstrate the implementation. Describe only work you can explain and checks you have run. This is a student project developed with AI assistance; it is not employment experience or evidence of production usage.

## A concise project explanation

“Proofline turns explicitly marked meeting notes into suggestions that stay linked to their source. A reviewer accepts or rejects each suggestion before an action becomes a task. I used React and TypeScript for the interface, Django and GraphQL for the API, and relational constraints for evidence and task integrity. The extractor is a deterministic parser. I focused on input validation, workspace isolation, repeat-safe writes and stale-update conflicts.”

Adapt that explanation to your actual understanding. Do not call the extractor AI, claim a model was trained, claim users or productivity improvements, or claim performance measurements that are not present.

## A five-minute demonstration

1. Start the full-stack app and explain the anonymous browser workspace. Use synthetic notes.
2. Import a short meeting with one `ACTION [owner] ... | due:YYYY-MM-DD` and one `DECISION: ...`. Show that plain prose is not extracted.
3. Open the suggestion review and compare the proposed action with the exact source line. Change its title/owner/date and accept it.
4. Show the task's source, change its status and explain its version number.
5. Import the same notes again. Show the duplicate result and unchanged task count.
6. Explain completion and review denominators, and why an item due today is not overdue.
7. End with one concrete limitation and the next change you would design.

## Trace one request through the code

Start at `frontend/src/data/api.ts`. The adapter initializes `/api/session/`, keeps the CSRF token and posts a GraphQL operation with same-origin credentials. Trace `importMeeting` into `backend/followthrough/schema.py`, then `services.import_meeting` and `parser.parse_notes`.

Explain each boundary:

| Boundary | What to explain |
| --- | --- |
| Browser → API | Typed inputs, session cookie, CSRF header, handling GraphQL errors |
| GraphQL → service | Input schema and application error mapping; workspace from session |
| Service → parser | Deterministic grammar, validation before writes and exact source preservation |
| Service → SQL | Transaction, import hash, uniqueness constraints and scoped relationships |
| API → UI | Complete response fields, refreshing displayed data and accessible feedback |

Then trace `review_suggestion`: row lock, final-state check, optional edits, one-to-one task creation and review update in one transaction. Finally trace `update_task`: conditional version match, atomic increment and conflict response.

## Questions to be ready for

**Why explicit markers rather than an LLM?** The workflow can be reproduced without keys, network inference or uncertain extraction. The parser's scope is visible and testable. The tradeoff is limited input coverage. A future model adapter would need a separate interface, strict structured-output validation, evidence checking, failure handling, evaluation data, privacy controls and cost limits; none is currently implemented.

**Why store both notes and source quotes?** The notes preserve context, while the quote gives a stable, directly inspectable excerpt. Review edits change the proposal, not its evidence. Explain the risk of future note edits and why this implementation keeps imported notes immutable.

**Why GraphQL?** The dashboard and mutation results select nested meeting, suggestion and task fields through one typed schema. A REST design could also work. The tradeoffs include GraphQL error handling, query complexity and the need to control resolver query counts.

**How do you prevent cross-workspace access?** Every lookup starts with the workspace obtained from the Django session and filters through `meeting__workspace` or `suggestion__meeting__workspace`. UUIDs alone are not authorization. Foreign and unknown objects receive the same `NOT_FOUND` response. Tests create separate workspaces and attempt reads and writes across them.

**Is a browser session a complete authentication system?** No. The cookie grants access to one anonymous workspace. There is no identity, membership model, sharing or recovery. Clearing cookies loses access without deleting stored data. A real shared product would need accounts, authorization, recovery and retention/deletion.

**What makes a write idempotent?** Imports have a workspace-specific normalized-content hash and a database uniqueness constraint. A reviewed suggestion has a final state and one-to-one task relationship. Repeating the same review returns the existing result. Task status updates instead use optimistic versions; a stale replay returns a conflict rather than silently overwriting data.

**What if two tabs update the same task?** Both read version 1. The first update matches version 1 and increments to 2. The second update matches zero rows and receives `CONFLICT`. Explain why a read-then-save implementation without a conditional SQL update could lose the first change.

**Does SQLite provide the same concurrency behavior as PostgreSQL?** No. PostgreSQL honors row locks; SQLite's `SELECT FOR UPDATE` is ineffective. The SQLite configuration uses `IMMEDIATE` transactions to reserve the write lock before a service reads, which prevents read-to-write upgrade races. SQLite serializes writes across the database and can time out under sufficiently long contention. The constraints and conditional task update also protect persisted integrity. This project has no load-tested throughput claim.

**How do you know the metrics are correct?** Read the formulas in `services.dashboard` and the test with an open overdue task, completed overdue task, task due today, accepted decision and pending suggestion. Decisions contribute to review progress but not to task completion. Zero denominators produce zero. These are current-state metrics, not causal productivity evidence.

**Which test protects a real failure?** Walk through the transaction rollback test: simulated task creation fails, and the suggestion remains pending with its original title. Then show the API test that accepts an action and serializes the resulting task; it caught an enum serialization issue that service-only tests would miss.

**What would you improve next?** Pick a user need and propose a scoped change. Examples: workspace deletion and retention, signed-in membership and recovery, pagination, a task edit/history model, or evaluation of an optional extraction adapter. Explain the migration, API contract, tests and observable success criteria before implementing it.

## Practice without assistance

- Write a valid and invalid parser input, predict the result, then run the parser tests.
- Explain the SQL relationships and point to each uniqueness constraint.
- Add a task status in a throwaway branch and identify every layer that would need updating.
- Reproduce a stale-version conflict using two requests with the same expected version.
- Explain a failed test and the smallest correction, including why a broader change is unnecessary.

The strongest walkthrough is an accurate one: show the runnable workflow, name the safeguards, and be clear about what the project does not yet implement.
