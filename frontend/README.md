# Proofline frontend

React 19, TypeScript, and Vite 8. Node 24.22.1 is the project runtime. Exact dependency versions and the npm lockfile are committed.

```sh
npm ci
npm run dev
```

The frontend runs on port 5173. The Vite proxy sends `/api` and `/graphql` to Django at `http://127.0.0.1:8000`, preserving the original host for CSRF origin checks. The default build always uses the server API; there is no automatic fallback to demo mode. A shared session bootstrap gets `/api/session/` and sends `X-CSRFToken` with GraphQL requests.

```sh
npm test
npm run build
```

## Explicit browser demo

```sh
VITE_DEMO=true npm run dev
VITE_DEMO=true VITE_BASE_PATH=/proofline/ npm run build
```

Only `VITE_DEMO=true` enables the browser adapter. It is labeled **Interactive demo · saved in this browser** and never calls or claims to use Django. The demo uses the same typed operations and deterministic extraction grammar, with fictional seed data. Meetings, reviewed suggestions, and versioned task status persist under `proofline.demo.v1` in localStorage. Stored data is schema checked, bounded, and checked against original source references before use. Corrupt data is reported, never silently replaced. A confirmed **Reset demo** clears this one key and loads fresh samples. Private browsing, browser data deletion, or unavailable storage can affect persistence; save errors are visible.

## Product behavior

- **Overview:** source-linked task board, search, owner/due/status filters, optimistic status updates with version conflicts and failure rollback.
- **Meeting inbox:** import title/date/notes, then edit, accept, or reject suggestions. Accepted actions create one task; accepted decisions create a log entry. Repeated reviews do not create extra tasks. Every suggestion starts pending.
- **Decision log:** search approved decisions and read their original meeting line.
- **Insights:** transparent denominators for action completion, suggestion review, and overdue work. Due today is not overdue; dates use UTC.
- **Source drawer:** original notes and exact, 1-based source line, preserved through review edits and task status changes.
- **Export:** full JSON includes all meetings, notes, suggestions, tasks, metrics, mode, and an export timestamp. Task CSV includes ownership, status, dates, and source quotes; formula-like cells are escaped. Export is download-only; there is no reimport feature.

Marker grammar is case sensitive and matches the server parser: optional leading whitespace or `-`/`*` bullet, `ACTION [Owner] Title | due:YYYY-MM-DD`, `ACTION: Title`, and `DECISION: Title`. Unmarked prose remains notes. Invalid action metadata fails the whole import. Limits: 160-character meeting/suggestion titles, 80-character owners, 20,000-character notes, 100 suggestions per meeting, 100 meetings and 500 tasks per workspace. Duplicate detection normalizes title case/whitespace and trailing note whitespace while preserving the first original notes.

Navigation uses fragment state, so the static GitHub Pages build has no route-refresh 404. Keyboard focus, skip navigation, labeled controls, responsive layout, modal focus containment, escape-to-close, and reduced-motion support are included. No API keys or paid services are required.

Tests cover the marker grammar, source preservation, import atomicity and deduplication, decision/action review behavior, idempotency, optimistic version conflicts, persistence/schema failures, CSRF transport, percentages, UI review-to-task flow, source viewing, filtering, and failed-status rollback. Full real-server browser tests live in the repository’s root `e2e` directory.
