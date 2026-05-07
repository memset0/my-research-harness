# browser-terminal Specification

## Purpose

In-browser xterm terminal backed by `ttyd` + `tmux`, so the user can launch a Claude Code session straight from an experiment detail page and later re-attach to the same `tmux` session from SSH (browser close / crash / offline continuation are all non-destructive). The ttyd binary is self-fetched from upstream releases (no root, no system package manager required); only `tmux` is assumed on PATH.
## Requirements
### Requirement: Detect ttyd availability via cache + PATH probe

`GET /api/terminal/check` SHALL probe ttyd in this order: (1) check `~/.cache/memon/bin/ttyd-<version>-<arch>` is present, executable, and `--version` matches the pinned `TTYD_VERSION`; (2) fall back to `which ttyd` (user may have installed it themselves). The response shape SHALL be `{ available: boolean, version?: string, source?: 'cached' | 'path', downloadable?: boolean, suggestion?: string }`.

When `available: false`, the response SHALL include `downloadable: true` on Linux architectures with a published prebuilt binary (x86_64, aarch64, armhf, i686, mips, mipsel) so the UI can offer one-click install via `POST /api/terminal/install`. On other platforms (notably macOS) it SHALL include `downloadable: false` with `suggestion` set to a manual install hint (e.g. `brew install ttyd`).

#### Scenario: ttyd is in cache
- **WHEN** `~/.cache/memon/bin/ttyd-1.7.7-x86_64` exists, is executable, and runs `--version`
- **THEN** `GET /api/terminal/check` returns `{ available: true, version: "1.7.7", source: "cached" }`

#### Scenario: ttyd is on PATH but not in cache
- **WHEN** the cache file is missing but `which ttyd` resolves
- **THEN** `GET /api/terminal/check` returns `{ available: true, version: "<whatever>", source: "path" }`

#### Scenario: ttyd is missing on a downloadable Linux arch
- **WHEN** neither cache nor PATH has ttyd, and `process.platform === 'linux'` with `process.arch in {x64, arm64, arm, ia32, mips, mipsel}`
- **THEN** `GET /api/terminal/check` returns `{ available: false, downloadable: true, suggestion: "POST /api/terminal/install" }`

#### Scenario: ttyd is missing on macOS
- **WHEN** neither cache nor PATH has ttyd and `process.platform === 'darwin'`
- **THEN** `GET /api/terminal/check` returns `{ available: false, downloadable: false, suggestion: "brew install ttyd" }`

### Requirement: Self-fetch ttyd from upstream releases without root

`POST /api/terminal/install` SHALL download the pinned ttyd version's prebuilt static binary for the current architecture from `https://github.com/tsl0922/ttyd/releases/download/<version>/ttyd.<arch>`, verify its sha256 (when published) against the matching `.sha256` file from the same release, write to `~/.cache/memon/bin/ttyd-<version>-<arch>` via temp-file + rename, and `chmod +x` it. The endpoint SHALL NOT require root or any system package manager.

The pinned version SHALL be a string constant in source (e.g. `TTYD_VERSION = '1.7.7'`); upgrading is a code change.

#### Scenario: First install on linux x86_64
- **WHEN** ttyd is missing and the user POSTs `/api/terminal/install` on a host where `process.arch === 'x64'`
- **THEN** memon downloads `https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64`
- **AND** verifies sha256 against `ttyd.x86_64.sha256` from the same release
- **AND** writes the binary to `~/.cache/memon/bin/ttyd-1.7.7-x86_64` with mode 0755
- **AND** `--version` on that file outputs `ttyd version 1.7.7…`
- **AND** the response is `{ ok: true, version: "1.7.7", path: "<cache>/ttyd-1.7.7-x86_64", durationMs: <int> }`

#### Scenario: Concurrent install calls
- **WHEN** two install requests fire simultaneously
- **THEN** memon serializes them (in-process mutex) so only one network download happens; the second returns `{ ok: true, alreadyPresent: true }` after the first completes
- **AND** the on-disk file is never observed in a partial state (atomic rename)

#### Scenario: Network failure during download
- **WHEN** the GitHub release URL is unreachable (404, 5xx, or network error)
- **THEN** the response is 502 with `{ ok: false, error: { code: 'DOWNLOAD_FAILED', message, fallback: '<manual instructions>' } }`
- **AND** no partial file remains in the cache directory

#### Scenario: SHA256 mismatch
- **WHEN** the downloaded binary's sha256 does not match the published `.sha256` file
- **THEN** the temp file is deleted and the response is 502 with `{ ok: false, error: { code: 'INTEGRITY_FAILED', message } }`

#### Scenario: Install on macOS
- **WHEN** install is POSTed on `process.platform === 'darwin'` (no upstream prebuilt)
- **THEN** the response is 501 with `{ ok: false, error: { code: 'NOT_AUTOFETCHABLE', suggestion: 'brew install ttyd' } }`

#### Scenario: Cache hit on subsequent call
- **WHEN** a valid cached binary already exists at the expected path
- **THEN** `POST /api/terminal/install` short-circuits — no network — and returns `{ ok: true, alreadyPresent: true, version: "1.7.7" }`

### Requirement: Start a ttyd-backed terminal session bound to tmux

The web backend SHALL expose `POST /api/terminal/start` accepting body `{ runId, projectName, agent? }` where `agent` SHALL be one of `'none' | 'claude' | 'codex' | 'opencode'` (default `'claude'` to preserve existing callers). The server SHALL spawn ttyd → tmux with a tmux session-name prefix derived from the agent and a tmux command derived from the agent:

| `agent` | session-name prefix | tmux argv tail |
|---|---|---|
| `none` | `memon-term-` | `tmux new-session -A -s memon-term-<runId>` (no trailing command, just shell) |
| `claude` | `memon-claude-` | `tmux new-session -A -s memon-claude-<runId> claude` (existing behavior) |
| `codex` | `memon-codex-` | `tmux new-session -A -s memon-codex-<runId> codex` |
| `opencode` | `memon-opencode-` | `tmux new-session -A -s memon-opencode-<runId> opencode` |

The response shape stays the same: `{ sessionName, url, port, startedAt, warnings }`. The `url` SHALL be `/api/terminal/proxy/<sessionName>/` where `<sessionName>` carries the agent-prefix.

If a previous ttyd is still running, it SHALL be killed before the new one is spawned (the v1 single-port single-session constraint is unchanged). The `-A` flag means switching agents-on-the-same-run leaves the previous agent's tmux session alive in the background — `tmux ls` will list multiple `memon-*-<runId>` entries — but only one ttyd is bound at a time.

The endpoint SHALL be classified as a `shell` route under the `auth-system` capability and therefore SHALL require valid `Authorization: Basic` credentials.

The `runId` SHALL match `^[a-zA-Z0-9._-]+$`. The `agent` field, when provided, SHALL match the closed enum above; an invalid value SHALL be rejected with 400.

If the chosen agent's CLI binary is not on PATH (e.g. user picks `codex` without `codex` installed), the early-stderr capture SHALL surface a warning in the `warnings: string[]` array of the response, and the ttyd session SHALL still be returned (so the user sees the warning in the drawer header).

#### Scenario: Default agent is claude (back-compat)
- **WHEN** a caller POSTs `{ runId: "foo-260501-100000", projectName: "project-a" }` (no `agent` field)
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-claude-foo-260501-100000 claude`
- **AND** the response `sessionName` is `"memon-claude-foo-260501-100000"`

#### Scenario: agent='none' opens a plain shell
- **WHEN** a caller POSTs `{ runId: "foo-260501-100000", projectName: "project-a", agent: "none" }`
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-term-foo-260501-100000` (no trailing command)
- **AND** the response `sessionName` is `"memon-term-foo-260501-100000"`

#### Scenario: agent='codex' uses the codex CLI
- **WHEN** a caller POSTs `{ runId: "foo-260501-100000", projectName: "project-a", agent: "codex" }`
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-codex-foo-260501-100000 codex`
- **AND** the response `sessionName` is `"memon-codex-foo-260501-100000"`

#### Scenario: agent='opencode' uses the opencode CLI
- **WHEN** a caller POSTs `{ runId: "foo-260501-100000", projectName: "project-a", agent: "opencode" }`
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-opencode-foo-260501-100000 opencode`
- **AND** the response `sessionName` is `"memon-opencode-foo-260501-100000"`

#### Scenario: agent CLI binary missing surfaces a warning
- **GIVEN** the user posts `{ runId, projectName, agent: "codex" }` on a host without `codex` on PATH
- **WHEN** ttyd starts and tmux exits early (because `codex: command not found`)
- **THEN** the response's `warnings` array contains a string mentioning the missing command
- **AND** the response's `sessionName` is still returned (the user sees the warning in the drawer header)

#### Scenario: Anonymous request rejected before spawn
- **WHEN** an anonymous client POSTs `/api/terminal/start`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** no ttyd process is spawned

#### Scenario: Re-attaching to an existing tmux session
- **WHEN** a tmux session named `memon-<agent>-<runId>` already exists (e.g. user attached from a real terminal earlier)
- **AND** the authenticated user POSTs the same `{ runId, projectName, agent }`
- **THEN** ttyd is started with `-A` flag → attaches to the existing session rather than creating a new one
- **AND** the in-browser terminal shows whatever scrollback / state already exists in that session

#### Scenario: Switching agents on the same run kills the previous ttyd
- **WHEN** ttyd is currently running for `{ runId: "foo", agent: "claude" }`, and the authenticated user POSTs `{ runId: "foo", agent: "codex" }`
- **THEN** the ttyd process for the claude session is killed
- **AND** the tmux session `memon-claude-foo` remains alive in detached state
- **AND** a new ttyd is spawned for `memon-codex-foo`

#### Scenario: Invalid agent value rejected
- **WHEN** a caller POSTs `{ runId, projectName, agent: "not-a-real-agent" }`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "..." } }` and no process is spawned

#### Scenario: runId fails sanity check
- **WHEN** the authenticated user POSTs a `runId` that doesn't match `^[a-zA-Z0-9._-]+$`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "..." } }` and no process is spawned

#### Scenario: ttyd is unavailable
- **WHEN** ttyd is not on PATH and the authenticated user POSTs `start`
- **THEN** the response is 503 with `{ error: { code: "TTYD_UNAVAILABLE", message: "<install hint>" } }` and no process is spawned

### Requirement: Stop the active ttyd without killing the tmux session

The web backend SHALL expose `POST /api/terminal/stop` accepting body `{ sessionName }`. It SHALL kill the ttyd child process bound to that sessionName but SHALL NOT run `tmux kill-session`. The corresponding tmux session SHALL remain in detached state for re-attachment from a real terminal.

#### Scenario: Closing the in-browser panel
- **WHEN** the user closes the terminal sheet (or POSTs `stop` with the active sessionName)
- **THEN** the ttyd child process is killed
- **AND** `tmux ls | grep memon-claude-` still lists the session
- **AND** the user can run `tmux attach -t memon-claude-<id>` from a real terminal to take over

### Requirement: List active ttyd sessions for the UI

The web backend SHALL expose `GET /api/terminal/list` returning `{ sessions: [{ sessionName, port, startedAt, experimentId, projectName }] }`. v1 will return at most 1 entry.

#### Scenario: No active ttyd
- **WHEN** no ttyd has been started since boot
- **THEN** `GET /api/terminal/list` returns `{ sessions: [] }`

#### Scenario: One active ttyd
- **WHEN** ttyd is running for experiment foo-260501-100000
- **THEN** `GET /api/terminal/list` returns `{ sessions: [{ sessionName: "memon-claude-foo-260501-100000", port: 7682, startedAt: "<iso>", experimentId: "foo-260501-100000", projectName: "..." }] }`

### Requirement: Frontend "Open in browser" button beside Ask Claude Code

The experiment detail header SHALL render a new button labeled "Open in browser" adjacent to the existing "Ask Claude Code" button. Clicking it SHALL open a shadcn `<Sheet>` (or `<Dialog>` full-screen on small viewports) containing an `<iframe>` whose `src` is the `url` returned from `POST /api/terminal/start`. Closing the sheet SHALL POST `/api/terminal/stop` (best-effort; ignore failure).

#### Scenario: Click the button while ttyd is available
- **WHEN** `GET /api/terminal/check` returned `{ available: true }` and the user clicks "Open in browser"
- **THEN** the sheet slides in showing a "starting…" state
- **AND** within 3 seconds the iframe loads the ttyd UI
- **AND** the user sees claude's REPL prompt (or the existing tmux session's last screen state)

#### Scenario: Click the button while ttyd is unavailable
- **WHEN** `available: false` from the check endpoint
- **THEN** the button is disabled
- **AND** hovering shows a tooltip with the install command

#### Scenario: Closing the sheet
- **WHEN** the user closes the sheet via the X button or escape key
- **THEN** `POST /api/terminal/stop` is fired with the sessionName
- **AND** the tmux session remains alive (verifiable with `tmux ls`)

### Requirement: Terminal manager cleans up on memon process exit

When the memon Node process receives SIGINT / SIGTERM, the terminal manager SHALL kill any active ttyd child before exiting. The tmux session SHALL remain alive (since `tmux` is its own process group, independent of memon).

#### Scenario: memon receives SIGINT
- **WHEN** the user presses Ctrl+C on memon
- **THEN** the ttyd child is sent SIGTERM
- **AND** the tmux session for memon-claude-* is still attachable from another shell

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

### Requirement: Drawer state persists across panel close until route change

The browser-terminal drawer SHALL be opened and dismissed by a layout-scoped state holder (a React context provider mounted in the per-project layout), NOT by per-button local state. Closing the drawer (the `X` button, escape key, or outside-click) SHALL hide the drawer WITHOUT calling `POST /api/terminal/stop` — the underlying ttyd + tmux session stays alive so the next open is an instant reattach.

The drawer's tmux session SHALL be torn down (via `POST /api/terminal/stop`) when ANY of the following occur:
- The browser navigates to a different route (`pathname` changes), OR
- The user clicks an explicit `Close + stop session` button in the drawer header (a NEW affordance distinct from the standard close), OR
- A different `Open with` invocation is made for a different agent or run (the existing single-port constraint).

#### Scenario: Closing the drawer leaves the session alive
- **GIVEN** the user opened the terminal drawer for `{runId: "foo", agent: "claude"}` and ttyd is running
- **WHEN** the user clicks the drawer's `X` close button
- **THEN** the drawer hides (no longer in the DOM)
- **AND** `POST /api/terminal/stop` is NOT called
- **AND** the ttyd child process is still alive (`/api/terminal/list` returns the same session)

#### Scenario: Reopening the drawer reattaches to the live session
- **GIVEN** the drawer was closed (per scenario above) and the ttyd session is still alive
- **WHEN** the user clicks `Open with [claude code]` again from the same run panel
- **THEN** the drawer reopens with the same iframe URL
- **AND** the iframe content shows the existing scrollback (no re-bootstrap)

#### Scenario: Route change tears down the session
- **GIVEN** the drawer is open with an active ttyd session
- **WHEN** the user navigates to a different route (e.g. clicks Hypotheses in the AppBar)
- **THEN** the provider observes the pathname change and calls `POST /api/terminal/stop` with the active sessionName
- **AND** the drawer state clears

#### Scenario: Close + stop session button kills the session
- **GIVEN** the drawer is open with an active ttyd session
- **WHEN** the user clicks the `Close + stop session` button in the drawer header
- **THEN** `POST /api/terminal/stop` is called and the drawer hides

### Requirement: Popup-window mode opens the terminal in a separate browser window

The frontend SHALL provide an "Open in new window" affordance (alongside the agent picker) that opens the same terminal in a chrome-less browser popup window instead of the side drawer. The popup SHALL navigate to `/terminal-popup?runId=<id>&projectName=<name>&agent=<kind>` opened via `window.open(url, target, features)` where:

- `target` SHALL be `memon-terminal-<sessionName>` so repeated clicks for the same combo refocus the existing popup instead of creating duplicates.
- `features` SHALL be `popup,width=1200,height=800` (chrome-less).

The `/terminal-popup` route SHALL render a chrome-less page (no AppBar, no Sidebar) containing the same `TerminalView` body the drawer uses, sized to occupy the full popup viewport.

The popup window inherits HTTP Basic auth from the same-origin browser auth cache; no auth-handoff dance is required.

#### Scenario: Open in new window opens a popup
- **WHEN** the user clicks "Open in new window" from the `Open with` picker
- **THEN** `window.open` is called with target `memon-terminal-<sessionName>` and features `popup,width=1200,height=800`
- **AND** the popup loads `/terminal-popup?runId=…&projectName=…&agent=<kind>`
- **AND** the popup renders a full-window terminal (no AppBar, no Sidebar)

#### Scenario: Repeat-click refocuses the existing popup
- **GIVEN** a popup window is already open for `{runId: "foo", agent: "claude"}`
- **WHEN** the user clicks "Open in new window" again for the same combo
- **THEN** `window.open` returns the existing window (because target name matches) and that window is brought to focus, NOT a duplicate

