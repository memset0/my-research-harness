## MODIFIED Requirements

### Requirement: HTTP Basic auth gates all dashboard and API routes

Next.js `middleware.ts` SHALL inspect every incoming request and require a valid IDENTITY before passing the request through. An identity is valid when AT LEAST ONE of the following holds (evaluated lazily, in order):

1. **Owner session cookie** — `memon-session` cookie present, signature verifies against `cfg.auth.session_secret`, payload `exp` is in the future, payload `role === "owner"`.
2. **Owner HTTP Basic** — `Authorization: Basic <b64(username:password)>` header where `username` and `password` match `cfg.auth.username` and `cfg.auth.password` after `crypto.timingSafeEqual` on equal-length UTF-8 byte buffers (with dummy compare on length mismatch to avoid leaking length via timing).
3. **Viewer share cookie** — `memon-shares` cookie present, signature verifies,
   AND at least one entry in the cookie validates against the central share
   registry record of its Host-qualified Project (with `expires_at` either
   null or future). Tokens in a project's `.memon/shares.json` never validate.
   **Mode 3 is evaluated ONLY for `read`-classed routes.** For `mutating`
   routes, the share cookie SHALL NOT be decoded; without owner identity the
   request follows anonymous handling.

The middleware SHALL evaluate modes in the order listed; the FIRST passing mode wins. The acceptance criterion is "at least one applicable mode passes"; mode 3 is "applicable" only for `read` routes.

When no applicable mode passes on a non-`anon` route, the middleware SHALL respond:
- HTML page request (Accept: text/html or no Accept header on a non-`/api/*` path) → `302 Found` with `Location: /login?next=<encoded-path>`.
- API request (path starts with `/api/` or `Accept: application/json`) → `401 Unauthorized` with `WWW-Authenticate: Basic realm="memon"`.

The check SHALL apply to all routes EXCEPT those in the `anon` class (see "anon route class"). The login challenge SHALL go through the `/login` page in the browser; legacy clients calling with bad Basic credentials still get the 401 + `WWW-Authenticate` so they can prompt.

#### Scenario: Anonymous request to a page route
- **WHEN** a browser GETs `/host-a/project-a` with no cookies and no Authorization header (Accept: text/html)
- **THEN** the response is 302 to `/login?next=/host-a/project-a`
- **AND** no Next.js page rendering occurs

#### Scenario: Anonymous API request
- **WHEN** an anonymous request hits `/api/projects` (Accept: application/json)
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** the body is short (`Unauthorized`)

#### Scenario: Valid owner cookie
- **WHEN** the request carries a valid `memon-session` cookie
- **THEN** middleware passes through; the route handler runs normally; the cookie's `exp` is refreshed on the response

#### Scenario: Valid Basic credentials (CLI tooling)
- **WHEN** the request carries `Authorization: Basic <b64(admin:<correct-password>)>` and no cookie
- **THEN** middleware passes through; the route handler runs normally (Basic remains a first-class auth mode for CLI/curl)

#### Scenario: Valid viewer share cookie on a read route
- **WHEN** the request is a `read`-class route, carries `memon-shares` with at least one validating entry, AND no owner identity is present
- **THEN** middleware computes `scopeProjects` from the validating entries
- **AND** the request is passed through IF the requested project resolves in-scope per the route-class policy (see "Project-scope enforcement"); otherwise 403

#### Scenario: Viewer share cookie on a mutating route is ignored
- **WHEN** the request is `mutating`-class and no owner identity is present, even with a valid `memon-shares` cookie
- **THEN** middleware does not decode the share cookie; mode 3 is not evaluated
- **AND** the response follows anonymous handling
- **AND** the failed owner-auth attempt is not refunded from the rate-limit bucket

#### Scenario: Owner cookie present but expired
- **WHEN** `memon-session` exists but `exp` is past, and no Basic header, on a `read` route with no valid share cookie
- **THEN** middleware treats as anonymous; HTML → 302 /login, API → 401

#### Scenario: Invalid password (Basic) — fallthrough to share cookie on a read route
- **WHEN** the request is `read`-classed, carries `Authorization: Basic <b64(admin:<wrong-password>)>`, no `memon-session`, AND a valid `memon-shares` cookie
- **THEN** mode 1 N/A; mode 2 fails (token consumed, no refund); mode 3 evaluated next; if any entry validates, the request proceeds as viewer
- **AND** the rate-limit bucket has dropped by ONE for this request (the failed Basic), not two

#### Scenario: Invalid password (Basic) — no fallthrough on a mutating route
- **WHEN** the request is `mutating`-classed, carries `Authorization: Basic <b64(admin:<wrong-password>)>`, AND any `memon-shares` cookie state
- **THEN** mode 2 fails; mode 3 is NOT evaluated; response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** the rate-limit token is consumed without refund

#### Scenario: Wrong username (Basic)
- **WHEN** the request carries `Authorization: Basic <b64(other:<correct-password>)>` and no cookie and no valid share
- **THEN** the response is 401 (username mismatch)

#### Scenario: Static asset is not gated
- **WHEN** an anonymous request hits `/_next/static/css/app/layout.css?v=...`
- **THEN** the middleware passes through and the asset is served with 200

#### Scenario: Cookie AND Basic both present and valid
- **WHEN** a request carries valid `memon-session` AND valid `Authorization: Basic`
- **THEN** mode 1 wins; the request is owner-scoped; the rate-limit token is consumed once for mode 1's evaluation, refunded on success
- **AND** mode 2 is NOT evaluated, mode 3 is NOT decoded

#### Scenario: Cookie invalid, Basic valid, share cookie also present, on a read route
- **WHEN** a request to a `read` route carries an expired `memon-session`, valid `Authorization: Basic`, and a `memon-shares` cookie
- **THEN** mode 1 fails (expired session ignored as if absent); mode 2 passes; the request is owner-scoped; `memon-shares` is NOT decoded for THIS request

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

- **anon** — `GET /login`, `POST /api/auth/login`, `GET /api/auth/check`, `GET /s/<token>`, `GET /share/<host>/<project>/<token>`, the legacy page redirect `GET|HEAD /h/<host>/p/<project>/…`, all static asset paths.
- **read** — every GET listed in the existing classification, including every canonical project page under `/<host>/<project>` (see the page-routes capability).
- **mutating** — every other non-GET under `/api/`. Catch-all default.

`projectFor` extractors per pattern:

- `/<host>/<project>/...` (a canonical project page, where `<host>` is a configured Host) → the Host-qualified Project `{host, project}` named by the first two segments.
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
- **WHEN** a viewer scoped to `{host-a, project-a}` does `GET /host-a/project-a/r/5`
- **THEN** middleware extracts `{host-a, project-a}` from the path, confirms in-scope, passes through

#### Scenario: Read route out-of-scope rejects viewer
- **WHEN** the same viewer does `GET /host-a/project-b`
- **THEN** the response is 403 Forbidden

#### Scenario: Multi-project read passes viewer with filter contract
- **WHEN** a viewer does `GET /api/projects`
- **THEN** middleware sees `projectFor='multi'`, passes through
- **AND** the route handler (`/api/projects/route.ts`) filters its returned list to `req.scopeProjects` before responding

#### Scenario: Classification source-of-truth enforces explicit map
- **WHEN** a new route is added to `apps/web/app/api/<thing>/route.ts` without being added to `route-classes.ts`
- **THEN** `route-classes.test.ts` enumerates app routes and FAILS the build for the unclassified route
- **AND** even if the test is bypassed, middleware defaults the route to `mutating` + `projectFor=null` (fail-closed)

### Requirement: Project-scope enforcement for read routes via `route-classes.ts` `projectFor`

Every route classified `read` in `route-classes.ts` SHALL declare a `projectFor(method, pathname, searchParams)` function alongside its class. The function SHALL return one of:

- a project name `string` (extracted from the URL path or query),
- `'multi'` if the route legitimately aggregates across projects and the handler is expected to filter using `req.scopeProjects`,
- `'global'` if the route is project-independent (owner-only),
- `null` if extraction is not possible for that URL shape (fail-closed: treated as `'global'`).

Middleware SHALL apply the following policy. Mode 3 (viewer share cookie) is
not evaluated on mutating routes.

| Class      | Owner | Viewer + projectFor in scope | Viewer + 'multi' | Viewer + out-of-scope | Viewer + 'global' | Viewer + null | Anon |
| ---------- | ----- | --------------------------- | ---------------- | --------------------- | ----------------- | ------------- | ---- |
| `anon`     | pass  | pass                        | pass             | pass                  | pass              | pass          | pass |
| `read`     | pass  | pass                        | pass (handler must filter) | 403          | 403               | 403           | 401/302 |
| `mutating` | pass  | N/A (mode 3 not evaluated)  | N/A              | N/A                   | N/A               | N/A           | 401/302 |

For mutating routes, the share cookie is not decoded. Without owner identity,
the request gets 401/302.

Canonical project page paths `/<host>/<project>/…` SHALL extract the Host-qualified Project from their first two path segments, for every page of the canonical route table (overview, `experiments`, `e/<n>`, `e/<n>/cr/<date>-<slug>`, `wiki`, `w/<n>`, `reports`, `r/<n>`, `journal`, `code-review`, `cr/<date>-<slug>`). `/api/projects/<project>` paths SHALL extract the project from the first path segment after `/api/projects/`. Legacy `/h/<host>/p/<project>/…` paths are redirected before authentication and are never authorized as project reads; hostless `/p/<project>/…` paths are not project routes. `?project=<P>` query params SHALL extract from the query. `/api/runs/<id>`, `/api/experiments/<id>`, `/api/reports/<id>` SHALL extract via in-memory index lookup using the request's runtime cache; if the id is unknown to the cache, `projectFor` returns `null` (the handler will likely 404 anyway).

#### Scenario: Owner read across all projects
- **WHEN** an owner GETs `/host-a/project-b` (with valid session)
- **THEN** the response passes through to the handler (200)

#### Scenario: Viewer in-scope read
- **WHEN** a viewer with `scopeProjects = {"project-a"}` on `host-a` GETs `/host-a/project-a/e/10`
- **THEN** middleware extracts project "project-a" on `host-a`, confirms in-scope, passes through

#### Scenario: Viewer cross-project read
- **WHEN** the same viewer GETs `/host-a/project-b`
- **THEN** the response is 403 Forbidden (viewer authenticated AND in some scope, but not THIS project's scope)

#### Scenario: Viewer multi-project list
- **WHEN** a viewer GETs `/api/projects` (no query)
- **THEN** middleware classifies the route as `read` + `projectFor='multi'`, passes through to the handler
- **AND** the handler filters the response array to project names in `req.scopeProjects` (the viewer sees ONLY their scoped projects)

#### Scenario: Viewer attempting mutating — share cookie ignored
- **WHEN** a viewer with scope `{"project-a"}` PUTs `/api/experiments/exp-id-in-project-a/readme`, carrying a valid `memon-shares` cookie
- **THEN** middleware does NOT decode the share cookie (mode 3 not evaluated on `mutating`)
- **AND** the response is 401 with `WWW-Authenticate: Basic realm="memon"` (API path)
- **AND** the rate-limit token consumed for this request is NOT refunded

#### Scenario: Viewer attempting id-resolved cross-project read
- **WHEN** a viewer with scope `{"project-a"}` GETs `/api/runs/<id-belonging-to-project-b>`
- **THEN** middleware resolves id → project-b via the RunIndex, detects out-of-scope, returns 403

#### Scenario: New uncatalogued route
- **WHEN** a new GET route under `/api/foo/bar` is added without being added to `route-classes.ts`
- **THEN** middleware classifies it as `mutating` (fail-closed catch-all)
- **AND** owners can call it (it works); non-owners get 401 regardless of share-cookie state (mode 3 not evaluated)
- **AND** the developer is forced to extend `route-classes.ts` to enable viewer access

#### Scenario: Every canonical page names its Project
- **WHEN** a viewer scoped to `{host-a, project-a}` GETs `/host-a/project-a/e/5/cr/2026-05-22-bf16-precision-guard`, `/host-a/project-a/w/4` or `/host-a/project-a/journal`
- **THEN** middleware extracts `{host-a, project-a}` for each and passes it through
- **AND** the same paths under `/host-b/project-a` receive 403

### Requirement: 401 vs 403 semantic distinction

Middleware SHALL distinguish between "no usable identity for this route" (`401 Unauthorized`) and "viewer identity present but project out of scope" (`403 Forbidden`):

- `401 Unauthorized` — no owner identity (mode 1+2 both failed) AND either:
  - the request is to a `mutating` route (where mode 3 is not evaluated), OR
  - the request is to a `read` route and mode 3 also failed.
  
  Carries `WWW-Authenticate: Basic realm="memon"`. HTML page requests that would result in 401 SHALL instead be served as `302 Found` with `Location: /login?next=<path>` so browsers land on the login form rather than triggering the native Basic-auth dialog. API requests (path starts with `/api/` OR `Accept: application/json`) get the raw 401.

- `403 Forbidden` — viewer identity established (mode 3 passed on a `read` route) but the requested project is OUT OF SCOPE (or the route's `projectFor` returns `'global'` or `null`). No `WWW-Authenticate` header. A short body identifies the reason: `Project not in your share scope`.

403 is therefore a NARROW response — it happens only on read routes where a viewer is "logged in" but trying to reach a project they have not been shared. Every other denial is 401 (or its HTML-rewritten 302).

#### Scenario: Anonymous browser to /p/foo
- **WHEN** an anonymous browser GETs `/p/foo` (Accept: text/html)
- **THEN** the response is a 404, because hostless project URLs are retired

#### Scenario: Anonymous browser to a project page
- **WHEN** an anonymous browser GETs `/host-a/foo` (Accept: text/html)
- **THEN** the response is 302 to `/login?next=/host-a/foo`
- **AND** no `WWW-Authenticate` header

#### Scenario: Anonymous curl to /api/projects
- **WHEN** an anonymous curl request hits `/api/projects` (no Accept or `Accept: application/json`)
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** the body is short (`Unauthorized`)

#### Scenario: Viewer-with-share-cookie to mutating endpoint → 401 (not 403)
- **WHEN** a viewer holding a valid `memon-shares` cookie POSTs `/api/experiments/X/readme`
- **THEN** middleware does not evaluate mode 3 (route is `mutating`)
- **AND** the response is 401 with `WWW-Authenticate: Basic realm="memon"` — treated as anon for this route

#### Scenario: Viewer-with-share-cookie to read endpoint, out-of-scope → 403
- **WHEN** a viewer with `scopeProjects = {"project-a"}` on `host-a` GETs `/host-a/project-b` (Accept: text/html)
- **THEN** mode 3 evaluates successfully; viewer identity established; project-b not in scope
- **AND** the response is 403 with no `WWW-Authenticate` header and a short body `Project not in your share scope`
- **AND** the response is NOT rewritten to a /login redirect (the user IS authenticated; the answer is "not for this project", not "please log in")

#### Scenario: Owner with expired session and no Basic
- **WHEN** an owner's `memon-session` cookie has expired and no other auth is present
- **THEN** middleware treats them as anonymous; HTML 302s to /login, API gets 401

### Requirement: `anon` route class for login/logout/share-landing

A fourth route class `anon` SHALL be added to `route-classes.ts`. Routes in this class SHALL pass middleware without identity. The class SHALL be applied to:

- `GET /login` — login form page
- `POST /api/auth/login` — credential POST
- `GET /api/auth/check` — auth-validation ping (existing behavior — preserved for bypass)
- `GET /s/<token>` — share-landing route
- `GET /share/<host>/<project>/<token>` — earlier Host-qualified share URL, redirected to `/<host>/<project>?share=<token>`
- `GET` / `HEAD` `/h/<host>/p/<project>/…` — legacy page URLs, redirected to their canonical page before authentication (see the page-routes capability)
- A `GET` of a project page carrying `?share=<token>` — redeemed before authentication (see the project-share capability)
- Static asset paths (`/_next/static/*`, `/_next/image`, `/favicon.ico`) — existing bypass extended into the `anon` classification
- `GET /api/runtime/health` — health-check endpoint that should be reachable without auth for monitoring (DEFERRED — see open question; default plan is to KEEP this owner-only as it is today)

`anon` routes SHALL still consume rate-limit tokens (refunded on success) so that `/api/auth/login` brute-force is throttled.

#### Scenario: Anonymous GET /login
- **WHEN** an anonymous browser GETs `/login`
- **THEN** the response is 200 with the login form

#### Scenario: Anonymous POST /api/auth/login (wrong creds)
- **WHEN** an anonymous POST with bad credentials hits `/api/auth/login`
- **THEN** the response is 401
- **AND** the rate-limit token is consumed (no refund)

#### Scenario: Anonymous GET /share/<project>/<token>
- **WHEN** an anonymous browser GETs `/share/project-a/<token>`
- **THEN** no share-landing handler grants access; the response is the generic invalid-link page (404) and no cookie is set

#### Scenario: Anonymous GET of a share URL
- **WHEN** an anonymous browser GETs a valid `/s/<token>` share URL
- **THEN** the share-landing handler runs (sets cookie, 302s to the token's canonical landing page under `/<host>/<project>`)
- **AND** an anonymous GET of `/share/<host>/<project>/<token>` 302s to `/<host>/<project>?share=<token>` without identity

#### Scenario: Anonymous GET / (root)
- **WHEN** an anonymous browser GETs `/` (Accept: text/html)
- **THEN** the response is 302 to `/login?next=/` (root is `read` + `projectFor='global'` — owner-only)

#### Scenario: Legacy page URL redirects before authentication
- **WHEN** an anonymous browser GETs `/h/host-a/p/project-a/reports/R0005`
- **THEN** the response is the 308 redirect to `/host-a/project-a/r/5` without a login redirect
- **AND** the canonical page then applies normal authentication

### Requirement: Central is the only human authentication boundary
In central mode, the existing owner username/password, owner session cookie, session-signing secret, rate limit, and viewer authorization SHALL be evaluated only by central. A Backend SHALL use only its independent service Bearer token and SHALL NOT initialize or accept browser-facing credentials. Standalone (hostless) Web serving is removed, so every Web request is authenticated under these central rules.

#### Scenario: One owner login covers all configured Hosts
- **WHEN** the owner authenticates to central once
- **THEN** authorized central pages may route to multiple Backends without asking for any Backend credential

#### Scenario: Backend challenge is not exposed to browser
- **WHEN** Backend service authentication fails
- **THEN** central reports a Host authentication failure without relaying the Backend token challenge or secret context to the browser

### Requirement: Document-scoped viewers reach only the shared document
A viewer whose only grant for a `{host, project}` is document-scoped SHALL be authorized for a `read` route of that Project only when the route targets the shared document: its page route; its detail, backlinks and bundle-asset reads; content-gateway assets that resolve to those bundle reads; and, for an Experiment, its README, results, document assets under its own directory, Run details and Run files of Runs under its own run directory, and log reads under that directory. Every other route of that Project, including Project-wide lists, SHALL be denied with 403, and multi-Project routes SHALL not expose that Project. Paths in query parameters SHALL be normalized and rejected when they contain dot-segments. Requests authorized through a document grant SHALL carry that Project in the request's viewer scope only for that request, so handler-level scope checks admit it while multi-Project handlers never see it. Project-scoped grants keep their existing authorization. The page route of a shared document SHALL be its canonical page, matched by kind and number: an `experiment E<NNNN>-<slug>` grant covers `/<host>/<project>/e/<n>`, a `wiki W<NNNN>` grant covers `/<host>/<project>/w/<n>` and a `report R<NNNN>` grant covers `/<host>/<project>/r/<n>`, where `<n>` is the document's number; no other page path, including the Experiment's code-review pages, matches a document grant. The server-injected session SHALL expose document grants so the UI can omit Project navigation for such viewers.

#### Scenario: Shared Wiki page and its assets
- **GIVEN** a viewer holding only a `wiki W0004` grant for `{host-a, project-x}`
- **WHEN** it requests the W0004 page, `/api/wiki/W0004` and W0004 bundle assets
- **THEN** each request is allowed

#### Scenario: Other documents and lists are denied
- **GIVEN** the same viewer
- **WHEN** it requests `/api/wiki/W0001`, `/api/wiki?host=host-a&project=project-x` or `/api/experiments`
- **THEN** each request receives 403

#### Scenario: Experiment share covers its Runs only
- **GIVEN** a viewer holding an `experiment E0001-x` grant
- **WHEN** it reads a Run under `logs/E0001/` and its log
- **THEN** the reads are allowed
- **AND** a Run or log under `logs/E0002/` or a `resource` with `..` is denied

#### Scenario: Experiment grant matches its canonical page by number
- **GIVEN** a viewer holding only an `experiment E0010-inference-kernels` grant for `{host-a, project-x}`
- **WHEN** it opens `/host-a/project-x/e/10` and `/host-a/project-x/e/10?run=<run>`
- **THEN** both pages are allowed
- **AND** `/host-a/project-x/e/11`, `/host-a/project-x/r/10` and `/host-a/project-x/experiments` receive 403

## REMOVED Requirements

### Requirement: Server-rendered project pages hydrate only resources of the requested project
**Reason**: Its subject, the hostless Run detail page `/p/<project>/experiments/<id>`, is retired together with every hostless project URL. The ownership rule continues for canonical pages in "Canonical project pages render only resources of the requested Project".
**Migration**: Open Runs through their Experiment page `/<host>/<project>/e/<n>?run=<run>`.

## ADDED Requirements

### Requirement: Canonical project pages render only resources of the requested Project
A server-rendered canonical page under `/<host>/<project>/…` that resolves an Experiment, Wiki page, Report, code review or Run by number or id SHALL resolve it only within that Host-qualified Project, before rendering, generating metadata, or dehydrating any of its data into the HTML. A resource that exists only in another Project, or in an equal-name Project on another Host, SHALL produce the same not-found response as a missing one, and its title, body or frontmatter SHALL NOT appear in the response. This applies to owners and viewers alike; for a viewer, route-level scope checks on `{host, project}` are therefore sufficient to keep another Project's content out of the page.

#### Scenario: Viewer requests another Project's Report number
- **GIVEN** a viewer whose share scope covers `{host-a, project-a}` only
- **AND** Report `R0005` exists in `project-b` but not in `project-a`
- **WHEN** the viewer requests `/host-a/project-a/r/5`
- **THEN** the not-found response is returned
- **AND** neither the HTML nor the page title contains that Report's title or body

#### Scenario: Equal-name Project on another Host
- **GIVEN** `project-a` exists on `host-a` and `host-b`, and only `host-b`'s copy has Experiment `E0010-a`
- **WHEN** an owner requests `/host-a/project-a/e/10`
- **THEN** the not-found response is returned and no content of `host-b`'s Experiment appears
