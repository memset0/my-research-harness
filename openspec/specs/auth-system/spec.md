# auth-system Specification

## Purpose
Protect central owner and project-scoped viewer access with persistent local authentication, safe cookies and non-challenging browser login flows.

## Requirements

### Requirement: Single-user credentials live in `config.yml` under top-level `auth` block (PLAINTEXT)

The config schema SHALL accept an optional top-level `auth` mapping with keys `username` (string, default `"admin"`) and `password` (string, **plaintext**). When `auth` is missing or `password` is missing/empty, the server SHALL treat the configuration as "uninitialised" and trigger first-run password generation (see "First-run password generation"). CLI commands that do NOT start the HTTP server (e.g. `memon list`, `memon serve --help`) SHALL NOT require `auth` to be present.

Plaintext on disk is intentional. The threat model is "single user, host filesystem trust = HTTP auth trust" (same boundary as `~/.ssh/id_*`). Storing plaintext in `config.yml` means dev agents and curl-based automation can read the password from a single canonical source; a hashed-on-disk + scrypt-verify path would add latency and tooling friction without changing the threat model meaningfully.

#### Scenario: Config has a complete auth block
- **WHEN** `config.yml` contains `auth: { username: "alice", password: "secret123" }`
- **THEN** `loadConfig` returns a `Config` whose `auth` field equals `{ username: "alice", password: "secret123" }`
- **AND** the HTTP server starts without modifying `config.yml`

#### Scenario: Config has no auth block
- **WHEN** `config.yml` has no top-level `auth` key
- **THEN** `loadConfig` returns `auth: undefined`
- **AND** the HTTP server's startup path triggers first-run password generation (see separate requirement)

#### Scenario: Config has malformed auth block
- **WHEN** `config.yml` has `auth: { password: 123 }` (wrong type) OR `auth: { password: "" }` (empty)
- **THEN** `loadConfig` throws `ConfigError` with a message identifying `auth.password`
- **AND** the HTTP server refuses to start

### Requirement: First-run random password generation persists plaintext and prints once

When `memon serve` starts and `cfg.auth?.password` is missing, the server SHALL generate a 24-character base64url password from 18 random bytes (`crypto.randomBytes(18)`) and append an `auth:` block (with **plaintext** `password`) to `config.yml` via atomic temp-file + rename. It SHALL print one stdout block:

```
*** memon: generated initial password ***
  username: <username>
  password: <plaintext>
Persisted in <configPath> as plaintext (auth.password).
```

The server SHALL NOT write to `~/.cache/memon/initial-password.txt` or any other location — `config.yml` is the single source of truth.

#### Scenario: Fresh install — no auth in config
- **WHEN** `config.yml` exists with `projects:` but no `auth:` block, and `memon serve` starts
- **THEN** `config.yml` is rewritten to contain a new top-level `auth: { username: "admin", password: "<plaintext>" }` block appended at the end
- **AND** the server's stdout contains the generated password block
- **AND** the server completes startup using the new credentials
- **AND** no file is created at `~/.cache/memon/initial-password.txt`

#### Scenario: Restart after first-run — config already populated
- **WHEN** `config.yml` already has a `password` and `memon serve` restarts
- **THEN** no password is generated and `config.yml` is not modified

#### Scenario: Concurrent edit collision on first run
- **WHEN** `config.yml`'s mtime changes between the initial read and the temp-file rename (operator was editing it)
- **THEN** the rename is aborted, the temp file is deleted, and the server fails startup with: `config.yml was modified during first-run init; set auth.password manually and restart`

### Requirement: HTTP Basic auth gates all dashboard and API routes

Next.js `middleware.ts` SHALL inspect every incoming request and require a valid IDENTITY before passing the request through. An identity is valid when AT LEAST ONE of the following holds (evaluated lazily, in order):

1. **Owner session cookie** — `memon-session` cookie present, signature verifies against `cfg.auth.session_secret`, payload `exp` is in the future, payload `role === "owner"`.
2. **Owner HTTP Basic** — `Authorization: Basic <b64(username:password)>` header where `username` and `password` match `cfg.auth.username` and `cfg.auth.password` after `crypto.timingSafeEqual` on equal-length UTF-8 byte buffers (with dummy compare on length mismatch to avoid leaking length via timing).
3. **Viewer share cookie** — `memon-shares` cookie present, signature verifies,
   AND at least one entry in the cookie validates against the corresponding
   project's `.memon/shares.json` (with `expires_at` either null or future).
   **Mode 3 is evaluated ONLY for `read`-classed routes.** For `mutating`
   routes, the share cookie SHALL NOT be decoded; without owner identity the
   request follows anonymous handling.

The middleware SHALL evaluate modes in the order listed; the FIRST passing mode wins. The acceptance criterion is "at least one applicable mode passes"; mode 3 is "applicable" only for `read` routes.

When no applicable mode passes on a non-`anon` route, the middleware SHALL respond:
- HTML page request (Accept: text/html or no Accept header on a non-`/api/*` path) → `302 Found` with `Location: /login?next=<encoded-path>`.
- API request (path starts with `/api/` or `Accept: application/json`) → `401 Unauthorized` with `WWW-Authenticate: Basic realm="memon"`.

The check SHALL apply to all routes EXCEPT those in the `anon` class (see "anon route class"). The login challenge SHALL go through the `/login` page in the browser; legacy clients calling with bad Basic credentials still get the 401 + `WWW-Authenticate` so they can prompt.

#### Scenario: Anonymous request to a page route
- **WHEN** a browser GETs `/p/project-a` with no cookies and no Authorization header (Accept: text/html)
- **THEN** the response is 302 to `/login?next=/p/project-a`
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

### Requirement: `/api/auth/check` endpoint as auth-validation ping

`GET /api/auth/check` SHALL accept the same `Authorization: Basic` header, validate it identically to the middleware, and return `200 { ok: true, username: "<u>" }` on success or `401 WWW-Authenticate: Basic realm="memon"` on failure. The route SHALL be cheap (one timing-safe compare per request) and SHALL NOT issue cookies or perform any side effects.

This endpoint exists primarily as an "is my Authorization still valid" ping for client tooling and dev agents — it lets a caller verify credentials without firing a heavier API call. It is **not** wired into Caddy's auth path: Caddy uses its native `basic_auth` directive (see "Caddy basic_auth integration"), which is incompatible with `forward_auth`-style probe endpoints for WebSocket upgrades. The endpoint remains in the rate-limiter's bucket (any caller can hit it).

#### Scenario: Auth ping with valid credentials
- **WHEN** any caller fires `GET /api/auth/check` with `Authorization: Basic <b64(admin:<right>)>`
- **THEN** the response is 200 with body `{ "ok": true, "username": "admin" }`

#### Scenario: Auth ping with bad credentials
- **WHEN** the same ping carries wrong credentials
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

### Requirement: Rate limit on auth-check and middleware basic-auth verification

The existing per-IP token-bucket rate limiter (default policy: **capacity 60, refill 60 tokens per 60 seconds** = 1 sustained req/s/IP with a 60-burst buffer) SHALL gate ALL THREE auth modes plus `/api/auth/check`, `/api/auth/login`, and `/api/auth/logout`. The shared bucket bounds an external attacker to O(1 credential-attempt/s) across the union of attack surfaces, which against a 144-bit random password OR a 144-bit random share token makes brute-force infeasible.

The limiter SHALL behave as **consume-on-attempt, refund-on-success**:

1. Every request that reaches the verification path consumes one token from the bucket BEFORE any cryptographic compare runs.
2. When the bucket is empty, the response SHALL be `429 Too Many Requests` with header `Retry-After: <seconds-until-next-token>`, and the server SHALL NOT perform the comparison.
3. When verification succeeds via ANY of the three modes (or via `/api/auth/login` POST), the previously-consumed token SHALL be refunded back to the bucket (capped at the bucket's capacity). Failed verifications SHALL NOT refund — that is the brute-force throttle.

The net effect is that legitimate, authenticated traffic is not throttled by the bucket, while an attacker submitting wrong passwords / wrong tokens / forged cookies drains at the spec's `1 attempt/s` ceiling.

Client IP SHALL be derived from the last entry of the `X-Forwarded-For` request header when present (Caddy is the only trusted upstream hop), falling back to the request's remote socket address. The limiter state SHALL be in-memory only and reset on process restart; this is acceptable for a single-user system. The limiter SHALL be shared between middleware, `/api/auth/check`, `/api/auth/login`, AND the custom server's WebSocket-upgrade auth, so a brute-force attempt against any of those paths is counted in one bucket.

#### Scenario: Within rate limit (mixed modes)
- **WHEN** the same IP makes a burst of bad-credential requests up to the bucket capacity, mixing Basic + cookie + share-cookie attempts
- **THEN** all receive 401 (after their respective verification fails)
- **AND** the bucket drops by exactly the number of attempts (one per attempt, no double-counting)

#### Scenario: Over rate limit
- **WHEN** an additional bad-credential request from the same IP arrives once the bucket is empty
- **THEN** the response is 429 with header `Retry-After: <int>` and the server skips the verification

#### Scenario: Successful verifications do not drain (cookie path)
- **GIVEN** an IP whose bucket starts at full capacity
- **WHEN** that IP makes 100 sequential requests with a VALID `memon-session` cookie (more than the bucket's capacity of 60)
- **THEN** every request returns 200 (no 429s)
- **AND** at the end the bucket is still effectively at capacity

#### Scenario: Failed verifications still drain (share cookie path)
- **GIVEN** an IP whose bucket starts at full capacity (60 tokens)
- **WHEN** the IP submits 61 requests with FORGED `memon-shares` cookies (bad signature) in tight succession
- **THEN** the first 60 receive 401 / fall-through (bucket drained one per failure)
- **AND** the 61st receives 429 (no refund happened on the prior failures)

#### Scenario: Mixed success (cookie) and failure (login attempts)
- **GIVEN** a bucket at full capacity
- **WHEN** the IP submits 30 wrong-password POSTs to `/api/auth/login` followed by 60 valid-cookie GETs
- **THEN** the 30 wrong attempts return 401 and drop the bucket from 60 to 30
- **AND** the subsequent 60 valid-cookie attempts each return 200 and net-zero the bucket
- **AND** no 429 is emitted

#### Scenario: Different IPs have independent buckets
- **WHEN** IP A is rate-limited and IP B has not made any requests
- **THEN** IP B's request is processed normally

#### Scenario: X-Forwarded-For respected
- **WHEN** a request arrives at `127.0.0.1:3737` (from Caddy) with `X-Forwarded-For: 203.0.113.5, 127.0.0.1`
- **THEN** the limiter keys on `203.0.113.5`, not the socket peer

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

### Requirement: Password change flow is operator-edits-config

There is no in-app password reset. To change the password, the operator SHALL stop `memon serve`, edit `auth.password` in `config.yml` to any new plaintext value, and restart the server. To regenerate a fresh random password, the operator SHALL delete the `auth` block entirely; the next start triggers first-run.

#### Scenario: Rotate by editing config.yml
- **WHEN** the operator changes `auth.password` from `"old"` to `"new"` in `config.yml` and restarts `memon serve`
- **THEN** subsequent requests with `Authorization: Basic <b64(admin:new)>` get 200
- **AND** subsequent requests with `Authorization: Basic <b64(admin:old)>` get 401

### Requirement: Caddy single-port reverse-proxy snippet documented in README

The repo SHALL document in `README.md` under "Production deployment" that the
Caddy site block requires only:

```caddyfile
<host> {
    reverse_proxy localhost:3737 {
        flush_interval -1
    }
}
```

The `flush_interval -1` option disables response-body buffering so SSE streams
in real time. Authentication remains inside memon. The README SHALL document
password rotation as editing `config.yml`'s plaintext `auth.password` and
restarting memon; Caddy reload is not part of password rotation.

#### Scenario: README Production section reflects the model
- **WHEN** a new operator reads the README's Production deployment section
- **THEN** they find the single-reverse-proxy Caddy snippet
- **AND** they find the memon-owned auth and password-rotation flow

### Requirement: HMAC signing key `cfg.auth.session_secret` auto-generated on first run

The config schema SHALL accept an optional `session_secret` field under the top-level `auth` block, a Base64URL-encoded 32-byte value (44 chars after encoding) used to HMAC-sign `memon-session` and `memon-shares` cookies. When `cfg.auth?.session_secret` is missing or empty at `memon serve` startup, the server SHALL generate `crypto.randomBytes(32)` and append `session_secret: <plaintext-b64url>` to the existing `auth:` block in `config.yml` via the SAME atomic temp-file + rename path used for first-run password generation. The new value SHALL be plaintext (consistent with `auth.password`).

Generation of `session_secret` SHALL be idempotent across the password-generation path: if both `password` and `session_secret` are missing on first start, BOTH SHALL be written in a single `config.yml` rewrite (one atomic rename). If only one is missing, that one SHALL be added.

#### Scenario: Fresh install — neither password nor session_secret in config
- **WHEN** `config.yml` exists with `projects:` but no `auth:` block, and `memon serve` starts
- **THEN** `config.yml` is rewritten to contain a new top-level `auth: { username: "admin", password: "<plaintext>", session_secret: "<plaintext>" }` block
- **AND** the server stdout contains the generated password block (NOT the session_secret; session_secret is not printed)

#### Scenario: Password exists but session_secret is missing
- **WHEN** `config.yml` has `auth: { password: "p" }` and the server starts
- **THEN** `config.yml` is rewritten with `auth: { password: "p", session_secret: "<plaintext>" }` (password preserved, session_secret added)
- **AND** stdout does NOT print the password block (it was already set)

#### Scenario: Both present
- **WHEN** `config.yml` already has both `password` and `session_secret`
- **THEN** `config.yml` is not modified at startup

#### Scenario: Concurrent edit collision
- **WHEN** `config.yml`'s mtime changes between the initial read and the temp-file rename
- **THEN** the rename is aborted, the temp file is deleted, and the server fails startup with: `config.yml was modified during first-run init; set auth.session_secret manually and restart`

### Requirement: Owner login page and endpoint

The server SHALL expose a `/login` HTML page (Next.js page route) that renders a credential form (username, password) using shadcn `<Card>` / `<Input>` / `<Button>`. The form SHALL POST to `/api/auth/login` with `application/x-www-form-urlencoded` body. The page SHALL be in the `anon` route class — accessible without identity.

`POST /api/auth/login` SHALL:

1. Consume one rate-limit token (same per-IP bucket as middleware).
2. Parse the body. If `username` and `password` match `cfg.auth.username` and `cfg.auth.password` (constant-time compare on equal-length UTF-8 buffers, with dummy compare on length mismatch), the request succeeds.
3. On success: HMAC-sign a payload `{ v: 1, role: "owner", iat: <unix-seconds>, exp: <iat + ttl> }` using `cfg.auth.session_secret`. Set the `memon-session` cookie: HTTPOnly, SameSite=Lax, Path=`/`, Max-Age=`30 days`, Secure when request scheme is `https`. The cookie value is Base64URL JSON `{ payload, sig }`. Refund the rate-limit token. Respond 302 to `?next=<path>` if present (validated to start with `/` and not `/api/auth/`), else `/`.
4. On failure: respond 401 (HTML page re-rendered with an `Invalid credentials` banner OR JSON `{ ok: false }` if `Accept: application/json`). NO refund.

The session SHALL be REFRESHED on every authenticated request: middleware re-signs the payload with a new `exp = now + 30 days` and updates the cookie on the response. Idle sessions expire after 30 days; active sessions effectively persist forever until logout or secret rotation.

#### Scenario: Browser opens /login
- **WHEN** any client (anon, viewer, or owner) GETs `/login`
- **THEN** the response is 200 with the login form HTML
- **AND** the page renders without requiring auth

#### Scenario: Valid login credentials
- **WHEN** an anon POST to `/api/auth/login` with form `username=admin&password=<correct>` arrives
- **THEN** the response is 302 to `/` (or `?next` if valid)
- **AND** the response sets the `memon-session` cookie with a signed `{role:"owner", iat, exp}` payload
- **AND** subsequent requests bearing that cookie are owner-scoped

#### Scenario: Invalid login credentials
- **WHEN** an anon POST submits a wrong password
- **THEN** the response is 401
- **AND** no cookie is set
- **AND** the rate-limit token is consumed without refund (brute-force throttle)

#### Scenario: Session refresh on each request
- **WHEN** an owner request bears a `memon-session` cookie whose `exp` is 25 days away
- **THEN** the response refreshes the cookie with `exp = now + 30 days`
- **AND** the cookie attributes are preserved (HttpOnly, SameSite=Lax)

#### Scenario: Expired session
- **WHEN** a request bears a `memon-session` cookie whose `exp` is in the past
- **THEN** middleware treats the cookie as absent (fall through to mode 2 or mode 3)
- **AND** for an HTML page request that ultimately fails all modes, the response is 302 to `/login?next=<requested-path>`

#### Scenario: Rotated secret invalidates all sessions
- **WHEN** the owner rotates `cfg.auth.session_secret` and restarts
- **THEN** every existing `memon-session` cookie fails signature verification
- **AND** affected clients are silently downgraded (cookie ignored), navigating to /login on next page load

### Requirement: Owner logout endpoint

`POST /api/auth/logout` SHALL clear the `memon-session` cookie by setting `Max-Age=0`. The endpoint SHALL be `mutating`-classed (requires owner identity to call). It SHALL NOT clear the `memon-shares` cookie — viewers who were upgraded to owner via login retain their share cookies and revert to viewer mode after logout.

#### Scenario: Logout while logged in
- **WHEN** an owner POSTs `/api/auth/logout`
- **THEN** the response sets `memon-session` to `Max-Age=0` (effectively clearing)
- **AND** the response status is 302 to `/login`
- **AND** the `memon-shares` cookie, if present, is unmodified

#### Scenario: Logout while not logged in
- **WHEN** an unauthenticated client (anon or viewer) POSTs `/api/auth/logout`
- **THEN** the response is 401 (Basic) for non-HTML or 302 to `/login` for HTML
- **AND** no cookies are modified

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

`/p/<project>` and `/api/projects/<project>` paths SHALL extract the project from the first path segment. `?project=<P>` query params SHALL extract from the query. `/api/runs/<id>`, `/api/experiments/<id>`, `/api/reports/<id>` SHALL extract via in-memory index lookup using the request's runtime cache; if the id is unknown to the cache, `projectFor` returns `null` (the handler will likely 404 anyway).

#### Scenario: Owner read across all projects
- **WHEN** an owner GETs `/p/project-b` (with valid session)
- **THEN** the response passes through to the handler (200)

#### Scenario: Viewer in-scope read
- **WHEN** a viewer with `scopeProjects = {"project-a"}` GETs `/p/project-a`
- **THEN** middleware extracts project "project-a", confirms in-scope, passes through

#### Scenario: Viewer cross-project read
- **WHEN** the same viewer GETs `/p/project-b`
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
- **THEN** the response is 302 to `/login?next=/p/foo`
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
- **WHEN** a viewer with `scopeProjects = {"project-a"}` GETs `/p/project-b` (Accept: text/html)
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
- `GET /share/<project>/<token>` — share-landing route
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
- **WHEN** an anonymous browser GETs a valid share URL
- **THEN** the share-landing handler runs (sets cookie, 302s to `/p/<project>`)

#### Scenario: Anonymous GET / (root)
- **WHEN** an anonymous browser GETs `/` (Accept: text/html)
- **THEN** the response is 302 to `/login?next=/` (root is `read` + `projectFor='global'` — owner-only)

### Requirement: Example configuration is template-only and runtime-immutable

The source-controlled file whose final path component is exactly
`config.example.yml` SHALL be treated as a documentation template maintained
only through intentional Agent or human source-authoring changes. Application
runtime code, including Next.js build/dev/start, web runtime initialization,
and authentication first-run initialization, SHALL NOT select that file as the
active runtime configuration and SHALL NOT write, append, truncate, replace, or
atomically rename content over it.

When `MEMON_CONFIG_PATH` is absent, direct web configuration resolution SHALL
search for the workspace instance `config.yml` only and SHALL NOT fall back to
`config.example.yml`. When `MEMON_CONFIG_PATH` explicitly resolves to a path
whose final component is `config.example.yml`, initialization SHALL fail before
configuration loading or persistence with an actionable message directing the
operator to copy the template to an instance file.

The authentication persistence boundary SHALL independently reject a protected
example path before any filesystem mutation, even if a caller bypasses normal
configuration resolution. In the existing first-run password and HMAC-key
requirements, references to writable `config.yml` mean an accepted instance
configuration path; an explicitly selected non-example filename is also an
instance and remains eligible for runtime persistence.

#### Scenario: Fresh checkout has only the example template

- **GIVEN** a workspace contains `config.example.yml` but no `config.yml`
- **AND** `MEMON_CONFIG_PATH` is unset
- **WHEN** the direct web runtime resolves configuration during build, dev, or start
- **THEN** it reports that no instance configuration is available and explains
  how to create or select one
- **AND** it does not load `config.example.yml` as the active configuration
- **AND** `config.example.yml` remains byte-for-byte unchanged with the same mtime

#### Scenario: Environment explicitly selects the protected template

- **GIVEN** `MEMON_CONFIG_PATH=/workspace/config.example.yml`
- **WHEN** the web runtime initializes
- **THEN** initialization fails with an error naming the protected example and
  directing the operator to an instance config
- **AND** authentication initialization is not invoked
- **AND** neither `config.example.yml` nor a temporary sibling is modified or created

#### Scenario: Persistence guard rejects a bypassing caller

- **GIVEN** a caller directly invokes authentication first-run initialization
  with `/workspace/config.example.yml`
- **WHEN** either a missing `auth` block or missing `auth.session_secret` would
  otherwise require persistence
- **THEN** the call fails before any stat/write/rename mutation sequence
- **AND** the example's bytes and mtime remain unchanged
- **AND** no `config.example.yml.tmp` file remains

#### Scenario: Custom-named instance remains writable

- **GIVEN** `MEMON_CONFIG_PATH=/etc/memon/cluster.yml`
- **AND** that instance has projects but no `auth` block
- **WHEN** the web runtime performs first-run authentication initialization
- **THEN** it atomically persists the generated password and session secret to
  `cluster.yml` under the existing first-run contract
- **AND** no `config.example.yml` is read or modified

#### Scenario: Production build cannot dirty the example

- **GIVEN** the repository starts with a clean, source-controlled
  `config.example.yml` and no instance config is selected
- **WHEN** the production web build completes or reports its expected missing-
  configuration state
- **THEN** `git diff --exit-code -- config.example.yml` succeeds
- **AND** no generated authentication credential or session secret appears in
  the example

### Requirement: Central is the only human authentication boundary
In central mode, the existing owner username/password, owner session cookie, session-signing secret, rate limit, and viewer authorization SHALL be evaluated only by central. A Backend SHALL use only its independent service Bearer token and SHALL NOT initialize or accept browser-facing credentials. Standalone SHALL retain the existing human authentication behavior.

#### Scenario: One owner login covers all configured Hosts
- **WHEN** the owner authenticates to central once
- **THEN** authorized central pages may route to multiple Backends without asking for any Backend credential

#### Scenario: Backend challenge is not exposed to browser
- **WHEN** Backend service authentication fails
- **THEN** central reports a Host authentication failure without relaying the Backend token challenge or secret context to the browser

### Requirement: Central viewer authorization uses Host-qualified scopes
Viewer identities SHALL carry a set of `{host, project}` scopes. A scope for one Host SHALL NOT grant access to an equal-name Project on another Host. Central SHALL authorize before proxying, and Backend SHALL enforce the forwarded viewer context against the exact tuple.

#### Scenario: Equal-name Project stays unauthorized
- **WHEN** a viewer has `{host-a, project-x}` and requests `{host-b, project-x}`
- **THEN** central returns 403 and does not forward protected data from Host B

### Requirement: Internal identity headers are never browser-controlled
Central SHALL remove all client-provided internal identity/scope headers and construct trusted actor context only from its resolved human session. Backend SHALL accept such context only on a valid service-authenticated request.

#### Scenario: Forged owner header fails
- **WHEN** an anonymous browser sends `X-Memon-Role: owner`
- **THEN** central ignores it and applies normal anonymous authentication

### Requirement: Service-bearing configurations are owner-only
On POSIX, central and Backend instance configurations containing service tokens SHALL be owner-only. Human first-run initialization SHALL preserve comments and keep the resulting file owner-only; startup SHALL fail before listen on unsafe permissions.

#### Scenario: First run does not weaken permissions
- **WHEN** first-run central auth is initialized in an owner-only registry file
- **THEN** the file remains owner-only and all existing Host/runbook comments remain intact

### Requirement: Experiment View authorization is scope-exact and read-only for viewers

The central authorization layer SHALL classify Experiment View collection reads as exact Project-scoped reads and all View lifecycle or definition mutations as owner-only. In central mode a viewer read SHALL require the exact Host+Project pair carried by its validated share scope; Project-name equality without Host equality SHALL NOT grant access. Route handlers SHALL repeat role and scope validation instead of relying only on disabled UI controls.

#### Scenario: Viewer collection read is allowed in exact scope

- **GIVEN** a validated viewer scope for Host A and Project X
- **WHEN** the viewer lists Views for an Experiment on Host A and Project X
- **THEN** the read succeeds

#### Scenario: Viewer View mutation is denied

- **GIVEN** a validated viewer scope for the target Experiment
- **WHEN** the viewer directly submits a create, update, rename, or delete request
- **THEN** the request is rejected as forbidden
- **AND** SQLite remains unchanged

### Requirement: Browser-facing authentication failures do not advertise Basic challenges
The Web/central server SHALL continue to accept an explicitly supplied owner
`Authorization: Basic` header using the existing constant-time comparison and
rate limit. A failed HTTP API or auth-check request SHALL return 401 without
`WWW-Authenticate`, so a browser never replaces the memon login/share
experience with a native HTTP Basic dialog. HTML navigations without a usable
identity SHALL continue to redirect to `/login?next=...`.

#### Scenario: Anonymous browser background API request
- **WHEN** the login page or another anonymous browser surface causes a same-origin API request without credentials
- **THEN** the response is 401 with `Cache-Control: no-store`
- **AND** `WWW-Authenticate` is absent

#### Scenario: Preemptive CLI Basic remains supported
- **WHEN** curl or CLI sends a valid `Authorization: Basic ...` header on its first request
- **THEN** it authenticates as owner without requiring a preceding challenge response

### Requirement: Anonymous pages do not open authenticated live-update streams
The root client provider SHALL subscribe to `/api/events` only for an injected `owner` or `viewer` session. An anonymous `/login` render SHALL not open or retry EventSource until a later authenticated navigation remounts the provider.

#### Scenario: Login page remains quiet
- **WHEN** an anonymous browser renders `/login`
- **THEN** no `/api/events` EventSource is created
- **AND** the login form remains the only authentication prompt

### Requirement: Server-rendered project pages hydrate only resources of the requested project

A server-rendered page under `/p/<project>/…` that resolves a resource by id (for example the Run detail page `/p/<project>/experiments/<id>`) SHALL verify that the resolved resource belongs to `<project>` before rendering, generating metadata, or dehydrating any of its data into the HTML. A resource that exists only in another project SHALL produce the same 404 as a missing id, and its title, README body or frontmatter SHALL NOT appear in the response. This applies to owners and viewers alike; for a viewer, route-level scope checks on `<project>` are therefore sufficient to keep another project's content out of the page.

#### Scenario: Viewer requests another project's Run through an in-scope URL

- **GIVEN** a viewer whose share scope covers `project-a` only
- **AND** a Run id that exists in `project-b` but not in `project-a`
- **WHEN** the viewer requests `/p/project-a/experiments/<that id>`
- **THEN** the response is a 404
- **AND** neither the HTML nor the page title contains that Run's README content or slug

#### Scenario: Matching project renders with a usable prefetch

- **GIVEN** a Run that belongs to `project-a`
- **WHEN** an authorized user requests `/p/project-a/experiments/<id>`
- **THEN** the page renders the Run detail
- **AND** the dehydrated query uses the same key the client detail component reads, so no duplicate fetch is required on mount
