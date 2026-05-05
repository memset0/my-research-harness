# auth-system Specification

## Purpose
TBD - created by archiving change add-system-auth. Update Purpose after archive.
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

Next.js `middleware.ts` SHALL inspect every incoming request and require a valid `Authorization: Basic <b64(username:password)>` header. The middleware SHALL extract `username:password` and compare against `cfg.auth.username` and `cfg.auth.password` using `crypto.timingSafeEqual` on equal-length UTF-8 byte buffers (with a dummy compare on length mismatch to avoid leaking length via timing). It SHALL either pass through (200-track) or short-circuit with `401 WWW-Authenticate: Basic realm="memon"`. The check SHALL apply to all routes under `/`, `/api/*`, `/p/*`, `/e/*`. The check SHALL NOT apply to:

- `/api/auth/check` (the forward-auth probe — its handler does its own check and returns 200/401 directly)
- Static asset paths emitted by Next.js (`/_next/static/*`, `/_next/image`, `/favicon.ico`)
- The login challenge SHALL go through the browser's native dialog; there is no `/login` page in this MVP.

#### Scenario: Anonymous request to a page route
- **WHEN** a browser GETs `/p/project-a` with no `Authorization` header
- **THEN** the response status is 401 with header `WWW-Authenticate: Basic realm="memon"`
- **AND** the response body is short (`Unauthorized`); no Next.js page rendering occurs

#### Scenario: Valid credentials
- **WHEN** the request carries `Authorization: Basic <b64(admin:<correct-password>)>`
- **THEN** the middleware passes through; the route handler runs normally

#### Scenario: Invalid password
- **WHEN** the request carries `Authorization: Basic <b64(admin:<wrong-password>)>`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** the comparison uses `timingSafeEqual` on equal-length byte buffers

#### Scenario: Wrong username
- **WHEN** the request carries `Authorization: Basic <b64(other:<correct-password>)>`
- **THEN** the response is 401 (username mismatch)

#### Scenario: Static asset is not gated
- **WHEN** an anonymous request hits `/_next/static/css/app/layout.css?v=...`
- **THEN** the middleware passes through and the asset is served with 200

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

The `/api/auth/check` endpoint AND the per-request `Authorization: Basic` verification done in middleware SHALL share an in-process token-bucket rate limiter keyed by client IP. Default policy: **capacity 60, refill 60 tokens per 60 seconds** (= 1 sustained req/s/IP with a 60-burst buffer). The limit bounds an external attacker to O(1 password/s) which, against a 144-bit random password, makes brute-force infeasible.

The limiter SHALL behave as **consume-on-attempt, refund-on-success**:

1. Every request that reaches the verification path consumes one token from the bucket BEFORE the timing-safe password compare runs (so a flood of failed attempts pays the bucket cost up-front and bounds CPU).
2. When the bucket is empty, the response SHALL be `429 Too Many Requests` with header `Retry-After: <seconds-until-next-token>`, and the server SHALL NOT perform the timing-safe password compare.
3. When verification succeeds (`verifyBasic` returns ok), the previously-consumed token SHALL be refunded back to the bucket (capped at the bucket's capacity). Failed verifications SHALL NOT refund — that is the brute-force throttle.

The net effect is that legitimate, authenticated traffic is not throttled by the bucket, while an attacker submitting wrong passwords drains at the spec's `1 password/s` ceiling.

Client IP SHALL be derived from the last entry of the `X-Forwarded-For` request header when present (Caddy is the only trusted upstream hop), falling back to the request's remote socket address. The limiter state SHALL be in-memory only and reset on process restart; this is acceptable for a single-user system. The limiter SHALL be shared between middleware and `/api/auth/check` so a brute-force attempt against either path is counted in one bucket.

#### Scenario: Within rate limit
- **WHEN** the same IP makes a burst of bad-credential requests up to the bucket capacity
- **THEN** all receive 401 (after timing-safe password compare fails)

#### Scenario: Over rate limit
- **WHEN** an additional bad-credential request from the same IP arrives once the bucket is empty
- **THEN** the response is 429 with header `Retry-After: <int>` and the server skips the password compare
- **AND** the body is short (`Too Many Requests`)

#### Scenario: Successful verifications do not drain the bucket
- **GIVEN** an IP whose bucket starts at full capacity
- **WHEN** that IP makes 100 sequential requests with VALID credentials (more than the bucket's capacity of 60)
- **THEN** every request returns 200 (no 429s)
- **AND** at the end the bucket is still effectively at capacity (each consume was matched by a refund-on-success)

#### Scenario: Failed verifications still drain
- **GIVEN** an IP whose bucket starts at full capacity (60 tokens)
- **WHEN** the IP submits 61 requests with WRONG credentials in tight succession
- **THEN** the first 60 receive 401 (bucket drained one per failure)
- **AND** the 61st receives 429 (no refund happened on the prior failures)

#### Scenario: Mixed success and failure
- **GIVEN** a bucket at full capacity
- **WHEN** the IP submits 30 wrong-credential requests followed by 60 correct-credential requests
- **THEN** the 30 wrong attempts return 401 and drop the bucket from 60 to 30
- **AND** the subsequent 60 correct attempts each return 200 and net-zero the bucket (each consume refunded)
- **AND** no 429 is emitted at any point in the sequence

#### Scenario: Different IPs have independent buckets
- **WHEN** IP A is rate-limited and IP B has not made any requests
- **THEN** IP B's request is processed normally and gets 401 / 200 per credential validity

#### Scenario: X-Forwarded-For respected
- **WHEN** a request arrives at `127.0.0.1:3737` (from Caddy) with `X-Forwarded-For: 203.0.113.5, 127.0.0.1`
- **THEN** the limiter keys on `203.0.113.5`, not the socket peer
- **AND** the test asserts that two requests from different `X-Forwarded-For` last-entries are tracked independently

### Requirement: Endpoint classification for future read-only public-share

Every HTTP route SHALL be classified as one of: `read`, `mutating`, or `shell`. The classification SHALL be encoded in code (a single source-of-truth map in `apps/web/lib/auth/route-classes.ts`) and SHALL be enforced by middleware. In this change, **all three classes require valid `Authorization`**. The contract SHALL state that future work MAY relax `read` routes to allow anonymous access via a share-link token; `mutating` and `shell` routes SHALL NEVER be relaxable to anonymous access.

The initial classification SHALL be:

- **read**: `GET /`, `GET /p/*`, `GET /e/*`, `GET /api/projects`, `GET /api/experiments/*` (any GET), `GET /api/log/*`, `GET /api/events`, `GET /api/log/stream*`, `GET /api/terminal/check`, `GET /api/terminal/list`
- **mutating**: any non-GET under `/api/` not classified as `shell`
- **shell**: every method under `/api/terminal/start`, `/api/terminal/stop`, `/api/terminal/install`, and `/api/terminal/proxy/*`

#### Scenario: Mutating route rejects anonymous
- **WHEN** an anonymous `PUT /api/experiments/foo/readme` is received
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

#### Scenario: Shell route rejects anonymous regardless of method
- **WHEN** an anonymous `GET /api/terminal/proxy/<sess>/` is received
- **THEN** the response is 401 (Caddy `forward_auth` short-circuits before the WS upgrade)

#### Scenario: Read route also rejects anonymous in this MVP
- **WHEN** an anonymous `GET /p/project-a` is received
- **THEN** the response is 401 (until a future change introduces public-share for `read` routes)

#### Scenario: Classification source-of-truth is enforced
- **WHEN** a new route is added to `apps/web/app/api/<thing>/route.ts` without being added to `route-classes.ts`
- **THEN** middleware SHALL default to treating it as `mutating` (fail-closed) — it still requires auth, but the `read`-vs-`mutating` distinction defaults to the stricter side

### Requirement: Password change flow is operator-edits-config

There is no in-app password reset. To change the password, the operator SHALL stop `memon serve`, edit `auth.password` in `config.yml` to any new plaintext value, and restart the server. To regenerate a fresh random password, the operator SHALL delete the `auth` block entirely; the next start triggers first-run.

#### Scenario: Rotate by editing config.yml
- **WHEN** the operator changes `auth.password` from `"old"` to `"new"` in `config.yml` and restarts `memon serve`
- **THEN** subsequent requests with `Authorization: Basic <b64(admin:new)>` get 200
- **AND** subsequent requests with `Authorization: Basic <b64(admin:old)>` get 401

### Requirement: ttyd binding remains loopback-only as last-line defense

The ttyd subprocess SHALL continue to bind to `127.0.0.1:7682` (existing behavior). The spec and `apps/web/lib/terminal/manager.ts` header SHALL document that this loopback bind is one of three independent gates protecting the writable terminal: **(1) loopback bind on ttyd; (2) the custom server's HTTP-Basic check on every `/api/terminal/proxy/*` HTTP request and WebSocket upgrade; (3) Next.js middleware's HTTP-Basic check on every other dashboard route.** ttyd's own `-c user:pass` flag SHALL NOT be used (operational reason: tying ttyd's basic-auth to memon's would couple ttyd argv to `config.yml`'s plaintext, and rotating the password would require an additional ttyd restart on top of the memon restart that already covers the rotation; the three gates above already protect the terminal without that coupling).

#### Scenario: Loopback bind verified at runtime
- **WHEN** `apps/web/lib/terminal/manager.ts` spawns ttyd
- **THEN** the argv contains `-i 127.0.0.1` (no `0.0.0.0` or external interface)
- **AND** the spawn does NOT include `-c`

#### Scenario: Documentation mentions the three gates
- **WHEN** a developer reads the design doc or the manager.ts file header comment
- **THEN** the three gates are explicitly named: loopback bind on ttyd, custom-server HTTP-Basic on `/api/terminal/proxy/*` (HTTP + WS), Next.js middleware HTTP-Basic on the rest of the site

### Requirement: Custom server enforces HTTP Basic on WebSocket upgrade for `/api/terminal/proxy/*`

The Node `http.Server` underlying memon's process SHALL gate every WebSocket upgrade whose path begins with `/api/terminal/proxy/` behind the same HTTP Basic credentials as the rest of the dashboard. The check SHALL share the same code path as `apps/web/middleware.ts` — i.e., parse the `Authorization` header, run scrypt-based `verifyBasic` against `runtime.auth`, and consume the same per-IP rate-limit bucket — so credential rotation, brute-force defense, and constant-time comparison do not have to be re-implemented for the upgrade case. The same **consume-on-attempt, refund-on-success** semantics apply: a successful upgrade refunds its token; a failed one does not.

If verification fails, the server SHALL write a raw `HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="memon"\r\n\r\n` to the socket and destroy it; ttyd SHALL receive no upgrade. If verification succeeds, the upgrade SHALL be forwarded to `127.0.0.1:7682` and the WebSocket SHALL be piped end-to-end.

#### Scenario: Anonymous WebSocket upgrade is rejected at the server entry
- **WHEN** an anonymous client opens `ws://<host>/api/terminal/proxy/<sess>/ws` with no `Authorization` header
- **THEN** the custom server writes `HTTP/1.1 401 Unauthorized` with `WWW-Authenticate: Basic realm="memon"` and destroys the socket
- **AND** the ttyd subprocess receives no upgrade

#### Scenario: Authenticated WebSocket upgrade reaches ttyd
- **WHEN** the client opens the upgrade with valid `Authorization: Basic` matching `runtime.auth`
- **THEN** the upgrade is forwarded to `127.0.0.1:7682`
- **AND** the response is `HTTP/1.1 101 Switching Protocols`
- **AND** the rate-limit token consumed for the attempt is refunded (the upgrade does not draw down the bucket)

#### Scenario: Brute-force on the upgrade endpoint is rate-limited
- **WHEN** a client sends ≥61 upgrade attempts with bad credentials in under 60 s from the same IP
- **THEN** the first 60 are rejected at the auth check (no refund happens) and the 61st upgrade attempt receives `HTTP/1.1 429 Too Many Requests` from the same shared rate-limit bucket used by `/api/auth/check` and middleware
- **AND** the bucket is consumed exactly once per upgrade attempt (no double-counting between middleware and the custom server)

### Requirement: Caddy single-port reverse-proxy snippet documented in README

The repo SHALL document — in `README.md` under "Production deployment" AND in `config.example.yml` comments — that the Caddy site block requires only:

```caddyfile
<host> {
    reverse_proxy localhost:3737 {
        flush_interval -1
    }
}
```

The `flush_interval -1` is the only `reverse_proxy` option needed: it disables Caddy's response-body buffering so SSE (`/api/events`, `/api/log/stream*`) streams in real time. It is harmless for ordinary HTTP and irrelevant for the WebSocket upgrade (raw socket).

The README SHALL state that no `basic_auth`, no `@terminal` path matcher, no separate ttyd upstream, and no `forward_auth` are required — auth and ttyd proxying both live in the memon process. The README SHALL document the password-rotation flow as: edit `config.yml`'s `auth.password` (plaintext) → restart memon. Caddy reload is no longer part of the rotation flow.

#### Scenario: README Production section reflects the new model
- **WHEN** a new operator reads the README's "Production deployment" section
- **THEN** they find a single-`reverse_proxy` Caddy snippet (with `flush_interval -1`) and an explicit note that auth + terminal proxy are handled by memon, not Caddy
- **AND** the rotation flow listed is "edit config.yml.auth.password → restart memon" — Caddy is not mentioned

#### Scenario: Single-directive Caddyfile is sufficient for terminal use
- **WHEN** an operator pastes the new snippet, runs `caddy reload`, and opens the in-browser terminal
- **THEN** anonymous requests to the host receive `401` from memon
- **AND** authenticated requests receive the dashboard, the terminal iframe loads, AND the WebSocket upgrade completes with `HTTP/1.1 101 Switching Protocols`
- **AND** no `@terminal` matcher, `basic_auth`, or `forward_auth` was needed in the Caddyfile

