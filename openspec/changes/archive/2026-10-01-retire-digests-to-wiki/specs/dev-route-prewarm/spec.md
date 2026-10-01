## MODIFIED Requirements

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
