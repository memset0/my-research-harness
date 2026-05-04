## ADDED Requirements

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

The web backend SHALL expose `POST /api/terminal/start` accepting body `{ experimentId, projectName }`. It SHALL spawn `ttyd -p 7682 -i 127.0.0.1 --writable tmux new-session -A -s memon-claude-<experimentId> claude` and return `{ sessionName: "memon-claude-<experimentId>", url: "/api/terminal/proxy/memon-claude-<experimentId>/", port: 7682 }`. If a previous ttyd is still running, it SHALL be killed before the new one is spawned (v1 single-session constraint).

#### Scenario: First session for an experiment
- **WHEN** the user POSTs `{ experimentId: "foo-260501-100000", projectName: "project-a" }` and no ttyd is running
- **THEN** a `ttyd` child process is spawned that runs `tmux new-session -A -s memon-claude-foo-260501-100000 claude`
- **AND** the response is `{ sessionName: "memon-claude-foo-260501-100000", url: "/api/terminal/proxy/memon-claude-foo-260501-100000/", port: 7682 }`
- **AND** within 3 seconds, an HTTP GET to the returned `url` returns the ttyd index page

#### Scenario: Re-attaching to an existing tmux session
- **WHEN** a tmux session named `memon-claude-foo-260501-100000` already exists (e.g. user attached from a real terminal earlier)
- **AND** the user POSTs the same `{ experimentId, projectName }`
- **THEN** ttyd is started with `-A` flag → attaches to the existing session rather than creating a new one
- **AND** the in-browser terminal shows whatever scrollback / state already exists in that session

#### Scenario: Switching between experiments kills the previous ttyd
- **WHEN** ttyd is currently running for experiment A, and the user POSTs `start` for experiment B
- **THEN** the ttyd process for A is killed (SIGTERM, then SIGKILL after 2s)
- **AND** the tmux session for A remains alive in detached state (`tmux ls` still lists it)
- **AND** a new ttyd is spawned for experiment B

#### Scenario: experimentId fails sanity check
- **WHEN** the user POSTs an `experimentId` that doesn't match `^[a-zA-Z0-9._-]+$`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "..." } }` and no process is spawned

#### Scenario: ttyd is unavailable
- **WHEN** ttyd is not on PATH and the user POSTs `start`
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

### Requirement: Caddy passthrough for ttyd proxy path

The deployment SHALL configure the reverse proxy (Caddy) to route `/api/terminal/proxy/*` directly to `localhost:7682` with WebSocket upgrade enabled and `flush_interval -1`. The Next.js layer SHALL NOT see this path. The README SHALL document the exact Caddy snippet.

#### Scenario: WebSocket upgrade succeeds end-to-end
- **WHEN** the browser opens the iframe at `/api/terminal/proxy/memon-claude-<id>/`
- **THEN** the request is handled entirely by Caddy + ttyd (Next.js receives nothing on this path)
- **AND** the WebSocket connection upgrades successfully and bidirectional terminal IO works with <100ms typing latency

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
