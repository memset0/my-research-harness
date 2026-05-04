## ADDED Requirements

### Requirement: Next.js custom server proxies ttyd HTTP and WebSocket traffic

A custom Node entrypoint (`apps/web/server.ts`) SHALL replace the default `next start` / `next dev` runners as memon's process boot path. It SHALL wrap `next()` and attach two interceptors to its underlying `http.Server`:

1. On the `request` event, when `req.url` begins with `/api/terminal/proxy/`, the entry SHALL verify HTTP Basic credentials against the same shared `verifyBasic`/`runtime.auth` path used by `apps/web/middleware.ts`, then proxy the HTTP request and response stream to `127.0.0.1:7682` (ttyd) preserving headers, status, and body. For all other paths, the entry SHALL delegate to Next's request handler unchanged.

2. On the `upgrade` event, when `req.url` begins with `/api/terminal/proxy/`, the entry SHALL likewise verify HTTP Basic on the upgrade request and, if valid, forward the WebSocket upgrade to `127.0.0.1:7682`. For non-prefixed upgrades (e.g. Next dev's HMR socket), the entry SHALL delegate to Next's own upgrade dispatcher.

The proxy SHALL NOT alter ttyd's URL scheme — `/api/terminal/proxy/<sessionName>/...` continues to resolve, ttyd is still launched with `-b /api/terminal/proxy/<sessionName>`, and the `start` endpoint's response shape is unchanged.

#### Scenario: HTTP request to ttyd index streams through
- **WHEN** an authenticated client sends `GET /api/terminal/proxy/memon-claude-foo-260501-100000/`
- **THEN** the custom server forwards the request to `127.0.0.1:7682/api/terminal/proxy/memon-claude-foo-260501-100000/`
- **AND** ttyd's index HTML body is streamed back to the client with the original status and content-type
- **AND** Next.js's request handler is NOT invoked

#### Scenario: WebSocket upgrade to ttyd succeeds
- **WHEN** an authenticated client opens `ws://<host>/api/terminal/proxy/memon-claude-foo-260501-100000/ws`
- **THEN** the custom server's `upgrade` listener verifies HTTP Basic, forwards the upgrade to `127.0.0.1:7682`, and the response is `HTTP/1.1 101 Switching Protocols`
- **AND** typing in the in-browser xterm produces output with <100 ms round-trip latency

#### Scenario: Anonymous WebSocket upgrade is rejected before reaching ttyd
- **WHEN** an anonymous client opens `ws://<host>/api/terminal/proxy/<sess>/ws` (no `Authorization` header)
- **THEN** the custom server responds with `HTTP/1.1 401 Unauthorized` + `WWW-Authenticate: Basic realm="memon"` and closes the socket
- **AND** ttyd receives no upgrade request

#### Scenario: Non-proxy path falls through to Next
- **WHEN** any request whose path does NOT begin with `/api/terminal/proxy/` arrives
- **THEN** the custom server delegates the request to Next's standard request handler (or, for upgrade events, Next's own upgrade dispatcher) without inspecting the body or headers

#### Scenario: ttyd not reachable
- **WHEN** the proxy attempts to forward to `127.0.0.1:7682` and ttyd is not running (or has crashed)
- **THEN** the custom server returns `502 Bad Gateway` with a one-line message; the WebSocket case ends with the socket being destroyed cleanly

#### Scenario: Caddy is now a single-purpose reverse proxy
- **WHEN** an operator deploys memon publicly behind Caddy
- **THEN** the Caddyfile site block requires only one directive — `reverse_proxy localhost:3737` — to route both ordinary dashboard traffic AND `/api/terminal/proxy/*` HTTP+WebSocket traffic
- **AND** the operator does NOT need a `@terminal` matcher, a separate ttyd upstream, or any auth-related Caddy directive for the terminal to work

## REMOVED Requirements

### Requirement: Caddy passthrough for ttyd proxy path

**Reason**: The whole point of this change is to move ttyd proxying out of Caddy and into memon's process. The "two upstreams + basic_auth" Caddy snippet is replaced by a single `reverse_proxy localhost:3737` line; the auth gate that Caddy used to provide is replaced by the custom server's own Basic-auth check on the upgrade handshake (covered by the new "Custom server proxies ttyd HTTP and WebSocket traffic" requirement above and by the new auth-system requirement covering WebSocket upgrade auth).

**Migration**: Existing operators do NOT need to change their Caddyfile for the new memon to keep working — the old `@terminal path /api/terminal/proxy/*` matcher just becomes a no-op forwarding to a path memon now answers natively. After upgrading, operators SHOULD trim the `@terminal` matcher and the `basic_auth` block from their Caddyfile (instructions in README "Production deployment").
