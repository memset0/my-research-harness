## MODIFIED Requirements

### Requirement: Endpoint classification for future read-only public-share

Every HTTP route SHALL be classified in `apps/web/lib/server/auth/route-classes.ts` as one of `anon | read | mutating`. Each rule SHALL also declare a `projectFor(method, pathname, searchParams)` function that returns:

- a project name (string),
- `'multi'` (the route legitimately aggregates across projects; handler must filter via `req.scopeProjects`),
- `'global'` (project-independent; owner-only by default for non-`anon` classes),
- `null` (no extraction possible — fail-closed; treated as `'global'`).

The classification + extractor SHALL be the single source of truth for both:
- whether a route requires auth (today: every non-`anon` route requires AT LEAST ONE of the three modes),
- whether viewer-scoped sessions are allowed (only `read` routes, only when `projectFor` resolves into the viewer's `scopeProjects` or returns `'multi'`).

The middleware enforces the policy table from "Project-scope enforcement for read routes". New routes default to `mutating` (fail-closed) AND `projectFor: () => null` (also fail-closed). The `route-classes.test.ts` suite SHALL include a smoke test that walks every `apps/web/app/api/**/route.ts` and asserts it has an explicit rule (failing the build if a developer adds a route without classifying it).

The current classifications are:

- **anon** — `GET /login`, `POST /api/auth/login`, `GET /api/auth/check`, `GET /share/<project>/<token>`, all static asset paths.
- **read** — every GET listed in the existing classification PLUS `GET /api/projects/<project>/shares` is owner-only (treated as `mutating` for viewer purposes).
- **mutating** — every other non-GET under `/api/`. Catch-all default.

`projectFor` extractors per pattern:

- `/p/<project>/...` → first segment after `/p/`.
- `/e/<project>/<exp>` → first segment after `/e/`.
- `/api/projects` → `'multi'` (filtered list); `?project=P` → P.
- `/api/projects/<project>/...` → first segment after `/api/projects/`.
- `/api/runs?project=P` → P; `/api/runs/<id>` → RunIndex lookup → run's project; if id not in index → `null`.
- `/api/experiments?project=P` → P; `/api/experiments/<id>` → ExperimentIndex lookup.
- `/api/reports?project=P` → P; `/api/reports/<id>` → ReportStore lookup.
- `/api/anomalies?project=P` → P; otherwise `'multi'`.
- `/api/events` → `'multi'` (SSE; filter in handler).
- `/api/log?path=<absolute-or-relative>` → derive project from path by matching against configured project roots; if no match → `null`.
- `/api/readme?path=...` → same.
- `/api/hypotheses?project=P` → P.
- `/api/journal?project=P` → P.
- `/api/log-files?project=P` → P.
- `/api/runtime/health` → `'global'`.

#### Scenario: Mutating route rejects anonymous
- **WHEN** an anonymous `PUT /api/experiments/foo/readme` is received
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"` (for API) or 302 to /login (for HTML)

#### Scenario: Mutating route rejects viewer
- **WHEN** a viewer (valid `memon-shares`) does `PUT /api/experiments/X/readme`
- **THEN** the response is 403 Forbidden with no `WWW-Authenticate` header

#### Scenario: Read route in-scope passes viewer
- **WHEN** a viewer scoped to project-a does `GET /p/project-a`
- **THEN** middleware extracts "project-a" from the path, confirms in-scope, passes through

#### Scenario: Read route out-of-scope rejects viewer
- **WHEN** the same viewer does `GET /p/project-b`
- **THEN** the response is 403 Forbidden

#### Scenario: Multi-project read passes viewer with filter contract
- **WHEN** a viewer does `GET /api/projects`
- **THEN** middleware sees `projectFor='multi'`, passes through
- **AND** the route handler (`/api/projects/route.ts`) filters its returned list to `req.scopeProjects` before responding

#### Scenario: Classification source-of-truth enforces explicit map
- **WHEN** a new route is added to `apps/web/app/api/<thing>/route.ts` without being added to `route-classes.ts`
- **THEN** `route-classes.test.ts` enumerates app routes and FAILS the build for the unclassified route
- **AND** even if the test is bypassed, middleware defaults the route to `mutating` + `projectFor=null` (fail-closed)

