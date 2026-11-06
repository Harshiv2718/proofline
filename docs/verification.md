# Verification

## Executable checks

| Layer | Coverage | Recorded result |
|---|---|---|
| Django services, parser and API | Validation, source preservation, transactions, idempotency, workspace scope, CSRF, version conflicts, metrics | 34 tests passed |
| React, TypeScript and adapters | UI workflow, source/status persistence, rollback, filters, CSRF transport, recovery, normalization, storage and metric boundaries | 22 tests passed; strict build passed |
| Real HTTP and rendered browser | Cross-session isolation, concurrent replays, invalid input, import/review, decisions, exports, reload, two-tab conflicts and mobile overflow | 12 tests passed |
| PostgreSQL 16 | Same Django suite against PostgreSQL | 34 tests passed in GitHub CI |
| Docker Compose | PostgreSQL + Gunicorn + Nginx, health and HTML, same-origin CSRF GraphQL workflow | Full-stack smoke passed in GitHub CI |

The PostgreSQL run repeats the backend suite; it is not another 34 distinct tests. The browser suite combines rendered UI and real HTTP/adapter checks, rather than representing 12 separate page workflows.

The initial full source snapshot, commit [`46e7a2e`](https://github.com/Harshiv2718/proofline/commit/46e7a2e9e65d4c5e40222d34cdbdf38ca293997f), passed all jobs in [GitHub run 42135124857](https://github.com/Harshiv2718/proofline/actions/runs/42135124857). The subsequent readability pass also passed the 22 frontend and 12 browser/integration tests locally. Use the [current workflow runs](https://github.com/Harshiv2718/proofline/actions/workflows/ci.yml) to check the exact latest commit.

## Reproduce

```bash
make setup
make test
make test-browser
docker compose up --build -d --wait
python3 scripts/smoke.py http://127.0.0.1:8080
```

Local verification used Python 3.12, Node 24 and an explicit Chromium 153 executable because the environment's Playwright CDN download returned an invalid archive. The configured GitHub CI successfully installed and used Playwright's bundled Chromium. The optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` environment variable supports such local environments; normal CI does not require it.

`node scripts/capture-demo.mjs` recreates the README screenshots from the actual browser demo with synthetic data. It requires the frontend and e2e dependencies and an installed Playwright browser.

## What these checks establish

The checked scenarios exercise a complete usable workflow and several important failure paths. They do not establish production load capacity, universal browser/device compatibility, a penetration test, or real-user productivity gains. The static demo exercises its local-storage adapter; server isolation and SQL behavior are verified separately in the Django, HTTP, PostgreSQL and container checks.
