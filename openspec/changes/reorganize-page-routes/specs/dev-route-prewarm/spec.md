## MODIFIED Requirements

### Requirement: Dev-only route prewarmer runs after the server is listening

The custom server (`apps/web/server.ts`) SHALL invoke a route prewarmer once `server.listen()` reports the port is open, ONLY when `process.env.NODE_ENV !== 'production'`. The prewarmer SHALL issue authenticated GETs against a fixed set of dashboard routes so the Next on-demand compiler pays the cold cost before any user navigation.

Set of routes prewarmed:
- `/api/projects`
- For every project `p` in the loaded `runtime.config.projects`: its canonical project page `/<encoded(p.host)>/<encoded(p.name)>`, plus `/<…>/journal` and `/<…>/reports` under the same Host-qualified prefix. No hostless `/p/…` path SHALL be requested.

Numbered and review detail routes (`.../e/<n>`, `.../r/<n>`, `.../w/<n>`, `.../cr/<date>-<slug>`) SHALL NOT be prewarmed (no canonical id available; first user click still pays cold compile for those — out of scope).

Each request SHALL carry a `Authorization: Basic <base64(username:password)>` header built from `runtime.auth.username` / `runtime.auth.password` so middleware accepts the request.

#### Scenario: Prod boot does not run the prewarmer
- **GIVEN** the server starts with `NODE_ENV=production`
- **WHEN** `server.listen()` reports ready
- **THEN** no `[prewarm]` log lines are emitted and no extra HTTP requests are made by the server itself

#### Scenario: Dev boot prewarms expected routes
- **GIVEN** the server starts with `NODE_ENV !== 'production'` and `runtime.config.projects` contains `project-a` on Host `host-a` and `project-b` on Host `host-b`
- **WHEN** `server.listen()` reports ready
- **THEN** the prewarmer issues at least these GETs: `/api/projects`, `/host-a/project-a`, `/host-a/project-a/journal`, `/host-a/project-a/reports`, `/host-b/project-b`, `/host-b/project-b/journal`, `/host-b/project-b/reports`
- **AND** it issues no GET for a hostless `/p/…` path
- **AND** every request includes a Basic auth header derived from the loaded `runtime.auth`

### Requirement: Prewarmer is observable via stdout

Each prewarm GET SHALL log a single line of the form `[prewarm] GET <path> -> <status> in <ms>` on completion (success or non-2xx). On a thrown error (e.g. socket abort), the line format SHALL be `[prewarm] GET <path> -> error: <message> in <ms>`. Logging SHALL go to `console.log` / `console.warn`; nothing fancier (no log levels, no JSON).

#### Scenario: Successful prewarm result is logged
- **WHEN** the GET for `/host-a/project-a/journal` returns 200 after 4200 ms
- **THEN** stdout contains the line `[prewarm] GET /host-a/project-a/journal -> 200 in 4200ms`
