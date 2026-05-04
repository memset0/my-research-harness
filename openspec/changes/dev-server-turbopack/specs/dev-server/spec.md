## ADDED Requirements

### Requirement: Dev compilation backend SHALL be Turbopack

The dev server SHALL compile routes using Next.js Turbopack, not webpack, when started via `pnpm --filter @memon/web dev` (which runs `tsx server.ts`). The toggle SHALL be passed through the programmatic `next()` constructor as `{ dev, turbopack: dev }` so that production startup (`NODE_ENV=production tsx server.ts`) leaves Turbopack disabled.

#### Scenario: Dev startup uses Turbopack

- **WHEN** the developer runs `pnpm --filter @memon/web dev`
- **THEN** the Next ready-line in stdout indicates Turbopack is
  enabled (e.g. "Turbopack" appears in the startup log) and the
  process holds port 3737.

#### Scenario: Production startup does not enable Turbopack

- **WHEN** the operator runs `NODE_ENV=production tsx server.ts`
  after `next build`
- **THEN** the prebuilt webpack bundle serves traffic and the
  `turbopack` flag passed to `next()` is `false`, so Turbopack is
  not initialized.

### Requirement: Custom HTTP server SHALL retain ttyd-proxy and Next routing

The custom `http.Server` built by `apps/web/lib/server-core.ts:createMemonServer` SHALL continue to own the listening socket on port 3737 and SHALL route requests as follows, regardless of which compilation backend Next is using:

- HTTP and WebSocket-upgrade paths matching `/api/terminal/proxy/*`
  are authenticated via `authenticateNodeRequest()` and proxied to
  the ttyd target.
- All other HTTP requests are forwarded to
  `app.getRequestHandler()`.
- All other WebSocket upgrades are forwarded to
  `app.getUpgradeHandler()` (Next's HMR socket in dev).

#### Scenario: ttyd HTTP path bypasses Next entirely

- **WHEN** an authenticated client opens
  `GET /api/terminal/proxy/<id>/`
- **THEN** the request is proxied to `127.0.0.1:7682` and Next's
  request handler is not invoked.

#### Scenario: HMR WebSocket upgrade reaches Next under Turbopack

- **WHEN** the dev server is running with Turbopack and a browser
  opens the HMR WebSocket (URL outside `/api/terminal/proxy/*`)
- **THEN** the custom server's `'upgrade'` listener forwards the
  upgrade to `app.getUpgradeHandler()` and the HMR socket is
  established (no `WebSocket connection failed` in the dev
  console).

#### Scenario: Editing a tracked file triggers HMR refresh

- **WHEN** the developer edits a component file (e.g. adds a
  whitespace change to `apps/web/app/page.tsx`) while the Turbopack
  dev server is running
- **THEN** the open browser receives a Fast Refresh update and the
  page content reflects the edit without a full reload.

### Requirement: Instrumentation warmup SHALL run before the first compiled route serves traffic

The `register()` hook in `apps/web/instrumentation.ts` SHALL invoke
`getRuntime()` during `app.prepare()` so that
`ExperimentIndex`, `hypothesesCache`, `journalCache`, and the
`Poller` are populated before any HTTP request is dispatched to a
Next handler. This is the contract established by the archived
`add-runtime-cache` change and MUST hold under Turbopack as well.

#### Scenario: Warmup log appears before first request response

- **WHEN** the dev server starts and the operator runs
  `curl /api/projects` immediately after the "ready on
  http://localhost:3737" line is printed
- **THEN** the `memon: warmup complete in <N>ms — <K> experiments,
  …` log line has already been printed and the HTTP response
  reflects the pre-populated index without doing fresh disk
  scanning on the request path.

### Requirement: Node-runtime middleware SHALL continue to gate every request

The auth middleware at `apps/web/middleware.ts` SHALL keep its
`runtime: 'nodejs'` configuration so that scrypt-based HTTP Basic
verification runs on every non-bypass request. Turbopack-mode dev
SHALL compile this middleware in the Node runtime (not Edge) and
SHALL NOT cause the rate limiter or `verifyBasic` calls to be
skipped.

#### Scenario: Unauthenticated request to protected route returns 401

- **WHEN** any client requests `/p/project-a` without an
  `Authorization` header
- **THEN** the response is `401 Unauthorized` with a
  `WWW-Authenticate: Basic` challenge header.

#### Scenario: Authenticated request to protected route returns 200

- **WHEN** a client requests `/p/project-a` with valid Basic auth
  credentials matching `auth.username` and `auth.password` in
  `config.yml`
- **THEN** the response is `200 OK` with the rendered HTML.

#### Scenario: Bypass path serves without auth

- **WHEN** a client requests `/_next/static/...` or
  `/api/auth/check`
- **THEN** the middleware returns `NextResponse.next()` without
  invoking `verifyBasic`, and the resource (or auth check) is
  served.

### Requirement: Dev cold-compile latency SHALL meet the documented budget

The dev server SHALL deliver each route's first response within the budget below, and warm responses within the warm-target column. After the dev server has fully warmed up (instrumentation hook done, first non-route-specific request served), the *first* request to each route class SHALL complete within the listed cold target on the project's standard developer hardware. The budget is a guideline target; sustained breach indicates a regression to investigate.

| Route class | Cold target | Warm target |
|---|---:|---:|
| `/p/[project]` (HTML SSR) | ≤ 3 s | ≤ 300 ms |
| `/p/[project]/hypotheses` (HTML SSR) | ≤ 3 s | ≤ 300 ms |
| `/p/[project]/journal` (HTML SSR) | ≤ 3 s | ≤ 300 ms |
| `/api/*` (route handler) | ≤ 1 s | ≤ 100 ms |
| RSC payload (soft-nav) | n/a | ≤ 200 ms |

#### Scenario: Cold HTML SSR meets budget

- **WHEN** the dev server has been started fresh and the route
  `/p/<any-configured-project>` is requested for the first time
- **THEN** the full HTML response is delivered within 3 s.

#### Scenario: Warm HTML SSR meets budget

- **WHEN** a route has already been compiled in the current dev
  server session and is requested again
- **THEN** the full HTML response is delivered within 300 ms.

#### Scenario: API route cold compile meets budget

- **WHEN** an API route under `/api/*` is requested for the first
  time in the dev session
- **THEN** the JSON response is delivered within 1 s.
