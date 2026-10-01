# dev-route-prewarm Specification

## Purpose
Keeps development-mode dashboard navigation responsive by issuing authenticated requests against a fixed set of routes once the custom server is listening, so Next.js compiles them before the first user click. It applies only when `NODE_ENV` is not `production`, never blocks boot, and reports progress on stdout. Implemented in `apps/web/lib/route-prewarm.ts` and invoked from `apps/web/server.ts`.

## Requirements

### Requirement: Dev-only route prewarmer runs after the server is listening

The custom server (`apps/web/server.ts`) SHALL invoke a route prewarmer once `server.listen()` reports the port is open, ONLY when `process.env.NODE_ENV !== 'production'`. The prewarmer SHALL issue authenticated GETs against a fixed set of dashboard routes so the Next on-demand compiler pays the cold cost before any user navigation.

Set of routes prewarmed:
- `/api/projects`
- For every project `p` in the loaded `runtime.config.projects`: `/p/<encoded(p.name)>`, `/p/<…>/hypotheses`, `/p/<…>/journal`, `/p/<…>/reports`.

Dynamic-id routes (`.../experiments/[id]`, `.../reports/[id]`, `.../wiki/[id]`) SHALL NOT be prewarmed (no canonical id available; first user click still pays cold compile for those — out of scope).

Each request SHALL carry a `Authorization: Basic <base64(username:password)>` header built from `runtime.auth.username` / `runtime.auth.password` so middleware accepts the request.

#### Scenario: Prod boot does not run the prewarmer
- **GIVEN** the server starts with `NODE_ENV=production`
- **WHEN** `server.listen()` reports ready
- **THEN** no `[prewarm]` log lines are emitted and no extra HTTP requests are made by the server itself

#### Scenario: Dev boot prewarms expected routes
- **GIVEN** the server starts with `NODE_ENV !== 'production'` and `runtime.config.projects` contains `[project-a, project-b]`
- **WHEN** `server.listen()` reports ready
- **THEN** the prewarmer issues at least these GETs: `/api/projects`, `/p/project-a`, `/p/project-a/hypotheses`, `/p/project-a/journal`, `/p/project-a/reports`, `/p/project-b`, `/p/project-b/hypotheses`, `/p/project-b/journal`, `/p/project-b/reports`
- **AND** every request includes a Basic auth header derived from the loaded `runtime.auth`

### Requirement: Prewarmer is fire-and-forget and never blocks boot

The ready-message (`> memon ready on http://...`) SHALL print as soon as `server.listen()` invokes its callback, before any prewarm GET completes. Prewarm requests SHALL run asynchronously after that. The prewarmer SHALL NOT cause `server.listen()` to fail and SHALL NOT propagate request errors as unhandled rejections; transient failures (connection refused mid-startup, 500 from an in-flight compile, 401, 429, anything else) SHALL be caught, logged, and discarded.

#### Scenario: Ready-message prints before any prewarm result
- **WHEN** dev boot reaches the listen callback
- **THEN** `> memon ready on http://...` is the first line printed by the listen callback path
- **AND** any `[prewarm] ...` log lines appear only after that ready-message

#### Scenario: Prewarmer survives transient errors
- **GIVEN** the prewarmer is mid-flight and one route returns 500 because Next is still finishing the compile
- **WHEN** that response arrives
- **THEN** the prewarmer logs `[prewarm] GET <path> -> 500 in <ms>` (or the timing-out equivalent) and continues with the other routes
- **AND** the dev server keeps running with no unhandled rejection in stdout

### Requirement: Prewarmer is observable via stdout

Each prewarm GET SHALL log a single line of the form `[prewarm] GET <path> -> <status> in <ms>` on completion (success or non-2xx). On a thrown error (e.g. socket abort), the line format SHALL be `[prewarm] GET <path> -> error: <message> in <ms>`. Logging SHALL go to `console.log` / `console.warn`; nothing fancier (no log levels, no JSON).

#### Scenario: Successful prewarm result is logged
- **WHEN** the GET for `/p/project-a/hypotheses` returns 200 after 4200 ms
- **THEN** stdout contains the line `[prewarm] GET /p/project-a/hypotheses -> 200 in 4200ms`
