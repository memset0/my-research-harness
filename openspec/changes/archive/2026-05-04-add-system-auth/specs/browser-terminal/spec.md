## MODIFIED Requirements

### Requirement: Caddy passthrough for ttyd proxy path

The deployment SHALL configure the reverse proxy (Caddy) to (1) gate the entire memon site (including `/api/terminal/proxy/*`) behind Caddy's native `basic_auth` directive (with a bcrypt of the plaintext stored in `config.yml`'s `auth.password`) so the WebSocket upgrade is rejected for unauthenticated clients before reaching ttyd, AND (2) route `/api/terminal/proxy/*` directly to `localhost:7682` with WebSocket upgrade enabled and `flush_interval -1` once auth passes. The Next.js layer SHALL NOT see the proxied WebSocket frames. The README SHALL document the exact Caddy snippet (defined in the `auth-system` capability).

The deployment SHALL NOT use Caddy's `forward_auth` directive for this site — `forward_auth`'s auth probe is implemented internally as a `reverse_proxy` that consumes the original request's `Upgrade` and `Connection` headers, so the subsequent ttyd `reverse_proxy` never sees the WS context and the handshake hangs (browser-side ttyd shows "press enter to reconnect"). `basic_auth` gates the request inline without reverse-proxying it first, so WS upgrades pass through transparently.

#### Scenario: Anonymous WebSocket upgrade is rejected by basic_auth
- **WHEN** an anonymous browser opens `wss://<host>/api/terminal/proxy/<sess>/ws`
- **THEN** Caddy's `basic_auth` directive returns 401 with `WWW-Authenticate: Basic realm="..."`
- **AND** ttyd receives no upgrade request

#### Scenario: WebSocket upgrade succeeds end-to-end with valid credentials
- **WHEN** the browser opens the iframe at `/api/terminal/proxy/memon-claude-<id>/` with cached `Authorization: Basic` credentials from the dashboard origin
- **THEN** Caddy's `basic_auth` directive validates the bcrypt against the supplied plaintext and accepts the request
- **AND** the request is forwarded to ttyd at `127.0.0.1:7682`
- **AND** the response is `HTTP/1.1 101 Switching Protocols` and bidirectional terminal IO works with <100ms typing latency

#### Scenario: Direct ttyd port from a localhost shell still works (loopback bypass for debugging)
- **WHEN** an operator on the host runs `curl -i http://127.0.0.1:7682/api/terminal/proxy/<sess>/`
- **THEN** ttyd serves its index page (no auth — `-c` is intentionally unused; loopback bind is the gate at this layer per `auth-system` rationale)
- **AND** this is acceptable because the host's shell perimeter is the same as the auth perimeter (single-user system)

### Requirement: Start a ttyd-backed terminal session bound to tmux

The web backend SHALL expose `POST /api/terminal/start` accepting body `{ experimentId, projectName }`. It SHALL spawn `ttyd -p 7682 -i 127.0.0.1 -b /api/terminal/proxy/memon-claude-<experimentId> --writable tmux new-session -A -s memon-claude-<experimentId> claude` and return `{ sessionName: "memon-claude-<experimentId>", url: "/api/terminal/proxy/memon-claude-<experimentId>/", port: 7682 }`. If a previous ttyd is still running, it SHALL be killed before the new one is spawned (v1 single-session constraint). The endpoint SHALL be classified as a `shell` route under the `auth-system` capability and therefore SHALL require valid `Authorization: Basic` credentials.

#### Scenario: Anonymous request rejected before spawn
- **WHEN** an anonymous client POSTs `/api/terminal/start`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** no ttyd process is spawned

#### Scenario: First session for an experiment with valid auth
- **WHEN** an authenticated user POSTs `{ experimentId: "foo-260501-100000", projectName: "project-a" }` and no ttyd is running
- **THEN** a `ttyd` child process is spawned that runs `tmux new-session -A -s memon-claude-foo-260501-100000 claude`
- **AND** the spawn argv contains `-i 127.0.0.1` AND does NOT contain `-c` (per the `auth-system` rationale documented there)
- **AND** the response is `{ sessionName: "memon-claude-foo-260501-100000", url: "/api/terminal/proxy/memon-claude-foo-260501-100000/", port: 7682 }`
- **AND** within 3 seconds, an authenticated HTTP GET to the returned `url` returns the ttyd index page

#### Scenario: Re-attaching to an existing tmux session
- **WHEN** a tmux session named `memon-claude-foo-260501-100000` already exists (e.g. user attached from a real terminal earlier)
- **AND** the authenticated user POSTs the same `{ experimentId, projectName }`
- **THEN** ttyd is started with `-A` flag → attaches to the existing session rather than creating a new one
- **AND** the in-browser terminal shows whatever scrollback / state already exists in that session

#### Scenario: Switching between experiments kills the previous ttyd
- **WHEN** ttyd is currently running for experiment A, and the authenticated user POSTs `start` for experiment B
- **THEN** the ttyd process for A is killed (SIGTERM, then SIGKILL after 2s)
- **AND** the tmux session for A remains alive in detached state (`tmux ls` still lists it)
- **AND** a new ttyd is spawned for experiment B

#### Scenario: experimentId fails sanity check
- **WHEN** the authenticated user POSTs an `experimentId` that doesn't match `^[a-zA-Z0-9._-]+$`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "..." } }` and no process is spawned

#### Scenario: ttyd is unavailable
- **WHEN** ttyd is not on PATH and the authenticated user POSTs `start`
- **THEN** the response is 503 with `{ error: { code: "TTYD_UNAVAILABLE", message: "<install hint>" } }` and no process is spawned
