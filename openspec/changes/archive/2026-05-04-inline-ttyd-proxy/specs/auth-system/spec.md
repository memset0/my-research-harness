## ADDED Requirements

### Requirement: Custom server enforces HTTP Basic on WebSocket upgrade for `/api/terminal/proxy/*`

The Node `http.Server` underlying memon's process SHALL gate every WebSocket upgrade whose path begins with `/api/terminal/proxy/` behind the same HTTP Basic credentials as the rest of the dashboard. The check SHALL share the same code path as `apps/web/middleware.ts` — i.e., parse the `Authorization` header, run scrypt-based `verifyBasic` against `runtime.auth`, and consume the same per-IP rate-limit bucket — so credential rotation, brute-force defense, and constant-time comparison do not have to be re-implemented for the upgrade case.

If verification fails, the server SHALL write a raw `HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="memon"\r\n\r\n` to the socket and destroy it; ttyd SHALL receive no upgrade. If verification succeeds, the upgrade SHALL be forwarded to `127.0.0.1:7682` and the WebSocket SHALL be piped end-to-end.

#### Scenario: Anonymous WebSocket upgrade is rejected at the server entry
- **WHEN** an anonymous client opens `ws://<host>/api/terminal/proxy/<sess>/ws` with no `Authorization` header
- **THEN** the custom server writes `HTTP/1.1 401 Unauthorized` with `WWW-Authenticate: Basic realm="memon"` and destroys the socket
- **AND** the ttyd subprocess receives no upgrade

#### Scenario: Authenticated WebSocket upgrade reaches ttyd
- **WHEN** the client opens the upgrade with valid `Authorization: Basic` matching `runtime.auth`
- **THEN** the upgrade is forwarded to `127.0.0.1:7682`
- **AND** the response is `HTTP/1.1 101 Switching Protocols`

#### Scenario: Brute-force on the upgrade endpoint is rate-limited
- **WHEN** a client sends ≥6 upgrade attempts with bad credentials in under 60 s from the same IP
- **THEN** subsequent upgrades from that IP receive `HTTP/1.1 429 Too Many Requests` from the same shared rate-limit bucket used by `/api/auth/check` and middleware
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

## MODIFIED Requirements

### Requirement: ttyd binding remains loopback-only as last-line defense

The ttyd subprocess SHALL continue to bind to `127.0.0.1:7682` (existing behavior). The spec and `apps/web/lib/terminal/manager.ts` header SHALL document that this loopback bind is one of three independent gates protecting the writable terminal: **(1) loopback bind on ttyd; (2) the custom server's HTTP-Basic check on every `/api/terminal/proxy/*` HTTP request and WebSocket upgrade; (3) Next.js middleware's HTTP-Basic check on every other dashboard route.** ttyd's own `-c user:pass` flag SHALL NOT be used (operational reason: tying ttyd's basic-auth to memon's would couple ttyd argv to `config.yml`'s plaintext, and rotating the password would require an additional ttyd restart on top of the memon restart that already covers the rotation; the three gates above already protect the terminal without that coupling).

#### Scenario: Loopback bind verified at runtime
- **WHEN** `apps/web/lib/terminal/manager.ts` spawns ttyd
- **THEN** the argv contains `-i 127.0.0.1` (no `0.0.0.0` or external interface)
- **AND** the spawn does NOT include `-c`

#### Scenario: Documentation mentions the three gates
- **WHEN** a developer reads the design doc or the manager.ts file header comment
- **THEN** the three gates are explicitly named: loopback bind on ttyd, custom-server HTTP-Basic on `/api/terminal/proxy/*` (HTTP + WS), Next.js middleware HTTP-Basic on the rest of the site

## REMOVED Requirements

### Requirement: Caddy `basic_auth` integration documented in README and Caddyfile snippet

**Reason**: With ttyd proxying moved into memon's custom server, Caddy no longer needs to authenticate the WebSocket upgrade for `/api/terminal/proxy/*` — that gate lives in `apps/web/server.ts`. Putting `basic_auth` in Caddy on top of the custom-server check would only add a second password store (the bcrypt in the Caddyfile) that has to be kept in sync with `config.yml`'s plaintext. Removing the Caddy auth layer collapses the deployment story to a single directive and a single source of truth for credentials.

**Migration**: After upgrading memon, operators SHOULD remove the `basic_auth { ... }` block, the `@terminal` matcher, and the separate ttyd `reverse_proxy` from their Caddyfile. The replacement snippet is documented in the new "Caddy single-port reverse-proxy snippet documented in README" requirement above. Existing Caddyfiles continue to function (Caddy gating with `basic_auth` remains valid; memon now also gates the same paths in process — both checks pass, no regression).
