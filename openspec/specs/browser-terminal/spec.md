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

The web backend SHALL expose `POST /api/terminal/start` accepting body `{ project, scope, slug, agent? }` where:
- `project` is the project name (matching the project-name validation rule below).
- `scope` is `'exp' | 'run' | 'project'` (closed enum).
- `slug` is the run dir basename (for `scope: 'run'`), the exp doc id `E<NNNN>-<base>` (for `scope: 'exp'`), or the literal sentinel `'root'` (for `scope: 'project'`); SHALL match `^[A-Za-z0-9._-]+$` AND SHALL NOT contain the substring `--`.
- `agent` is `'none' | 'claude' | 'codex' | 'opencode'` (default `'claude'`).

The server SHALL compute the tmux session name as `memon-<agent>-<project>--<scope>--<slug>` and spawn ttyd with the agent-specific tmux argv. The cwd of the new tmux session (passed to tmux via `-c <cwd>`) SHALL be:
- For `scope: 'run'`: the absolute path of the run dir matched by `(project, slug)`.
- For `scope: 'exp'`: the absolute path of the matched project's root directory.
- For `scope: 'project'`: the absolute path of the matched project's root directory. The server SHALL NOT validate the slug against any on-disk artefact for project scope — the sentinel value `'root'` is by-contract and produces no warning.

| `agent` | tmux argv tail |
|---|---|
| `none` | `tmux new-session -A -s <sessionName> -c <cwd>` (no trailing command, just shell) |
| `claude` | `tmux new-session -A -s <sessionName> -c <cwd> claude [--continue if resumable]` |
| `codex` | `tmux new-session -A -s <sessionName> -c <cwd> codex [resume-form if resumable]` |
| `opencode` | `tmux new-session -A -s <sessionName> -c <cwd> opencode [resume-form if resumable]` |

The response shape SHALL be `{ sessionName, url, port, startedAt, warnings }`. The `url` SHALL be `/api/terminal/proxy/<sessionName>/`. The `port` SHALL be the dynamically allocated port for THIS session (per the Multi-port ttyd manager requirement below).

A subsequent `start` call for the same `sessionName` (i.e. same `(agent, project, scope, slug)`) whose entry is healthy in the manager SHALL return the existing entry's `(sessionName, url, port, startedAt, warnings)` rather than spawning a new ttyd. This is the dedup that lets drawer + popup share the same ttyd.

The endpoint SHALL be classified as a `shell` route under the `auth-system` capability and therefore SHALL require valid `Authorization: Basic` credentials.

If the requested `(project, slug, scope)` cannot be resolved to an on-disk target (project not in config, run dir missing, exp doc missing), the server SHALL still spawn ttyd + tmux at the project root or HOME (gracefully degrading) AND return a `warnings: string[]` entry like `target not found on disk`. This lets the management page's `Open in drawer` work for stale entries. For `scope: 'project'`, the only target check is project-in-config; slug is not validated.

If the chosen agent's CLI binary is not on PATH, the early-stderr capture SHALL surface a warning in `warnings`, and the ttyd session SHALL still be returned.

#### Scenario: Default agent is claude with run scope
- **WHEN** a caller POSTs `{ project: "project-a", scope: "run", slug: "foo-260507-103000" }` (no `agent` field)
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-claude-project-a--run--foo-260507-103000 -c <run-dir-abspath> claude` (with `--continue` appended only if a prior conversation in `<run-dir-abspath>` exists in claude's local store)
- **AND** the response `sessionName` is `"memon-claude-project-a--run--foo-260507-103000"`

#### Scenario: agent='none' opens a plain shell at run dir
- **WHEN** a caller POSTs `{ project: "project-a", scope: "run", slug: "foo-260507-103000", agent: "none" }`
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-terminal-project-a--run--foo-260507-103000 -c <run-dir-abspath>` (no trailing command)
- **AND** the response `sessionName` is `"memon-terminal-project-a--run--foo-260507-103000"`

#### Scenario: exp scope opens at project root
- **WHEN** a caller POSTs `{ project: "project-a", scope: "exp", slug: "E0042-bar", agent: "claude" }`
- **THEN** the cwd passed to tmux is the matched project's absolute root path, NOT a per-exp directory
- **AND** the session name is `"memon-claude-project-a--exp--E0042-bar"`

#### Scenario: project scope opens at project root with sentinel slug
- **WHEN** a caller POSTs `{ project: "project-a", scope: "project", slug: "root", agent: "claude" }`
- **THEN** the cwd passed to tmux is the matched project's absolute root path
- **AND** the session name is `"memon-claude-project-a--project--root"`
- **AND** no `warnings` entry is emitted for missing slug-target (project scope does not validate slug)

#### Scenario: project scope with non-existent project still degrades
- **GIVEN** the project `does-not-exist` is not in `config.yml`
- **WHEN** an authenticated caller POSTs `{ project: "does-not-exist", scope: "project", slug: "root", agent: "claude" }`
- **THEN** the spawned tmux command uses `cwd = <HOME>` (the same fallback used for unknown-project run/exp scopes)
- **AND** `warnings` contains a string mentioning the project not in config
- **AND** the response is still 200 with `sessionName: "memon-claude-does-not-exist--project--root"`

#### Scenario: agent CLI binary missing surfaces a warning
- **GIVEN** the user posts `{ project, scope, slug, agent: "codex" }` on a host without `codex` on PATH
- **WHEN** ttyd starts and tmux exits early (`codex: command not found`)
- **THEN** `warnings` contains a string mentioning the missing command
- **AND** the response `sessionName` is still returned

#### Scenario: Anonymous request rejected before spawn
- **WHEN** an anonymous client POSTs `/api/terminal/start`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** no ttyd process is spawned

#### Scenario: Re-attaching to an existing tmux session after server restart
- **GIVEN** a tmux session `memon-claude-project-a--run--foo-260507-103000` exists from a prior `memon serve` lifetime, with a claude process still running inside it
- **WHEN** the authenticated user POSTs `{ project: "project-a", scope: "run", slug: "foo-260507-103000", agent: "claude" }` after the new `memon serve` started up
- **THEN** ttyd is started with `-A` flag → attaches to the existing session
- **AND** the in-browser terminal shows the prior scrollback and the running claude process

#### Scenario: Idempotent start returns existing entry
- **GIVEN** the manager already holds a healthy entry for sessionName `memon-claude-project-a--run--foo-260507-103000` on port `7683`
- **WHEN** the same caller POSTs the same `{ project, scope, slug, agent }`
- **THEN** the response is `{ sessionName, url, port: 7683, startedAt: <original>, warnings }` — no new ttyd is spawned
- **AND** the existing ttyd's `lastActiveAt` is bumped

#### Scenario: Switching agents on the same target keeps the previous tmux alive
- **WHEN** ttyd is currently running for `{ project, scope, slug, agent: "claude" }`, and the authenticated user POSTs the same `(project, scope, slug)` with `agent: "codex"`
- **THEN** a NEW ttyd is spawned on a NEW port for `memon-codex-...`
- **AND** the claude ttyd is unaffected — the user can have both open at once if drawer + popup are coordinated

#### Scenario: Invalid agent value rejected
- **WHEN** a caller POSTs `{ project, scope, slug, agent: "not-a-real-agent" }`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "..." } }` and no process is spawned

#### Scenario: Invalid scope value rejected
- **WHEN** a caller POSTs `{ project, scope: "not-a-real-scope", slug }`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "..." } }` and no process is spawned

#### Scenario: slug containing `--` rejected
- **WHEN** a caller POSTs `{ project, scope, slug: "foo--bar" }`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "slug must not contain '--'" } }` and no process is spawned

#### Scenario: project name with disallowed character rejected
- **WHEN** a caller POSTs `{ project: "bad name", scope: "run", slug: "foo-260507-103000" }`
- **THEN** the response is 400 (per the project-name validation requirement below) and no process is spawned

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

The web backend SHALL expose `GET /api/terminal/list` returning `{ sessions: [{ sessionName, port, startedAt, lastActiveAt, project, scope, slug, agent, warnings }] }`. The list SHALL contain one entry per ttyd in the manager's `Map<sessionName, Entry>` — there is no longer a single-entry constraint.

The list SHALL only enumerate ttyd entries the manager currently holds (i.e. sessions with a live ttyd process). It SHALL NOT enumerate tmux sessions on the host that have no ttyd bound — the management page (`tmux-session-management` capability) is the authoritative inventory for those.

#### Scenario: No active ttyd
- **WHEN** no ttyd has been started since boot
- **THEN** `GET /api/terminal/list` returns `{ sessions: [] }`

#### Scenario: Multiple active ttyds
- **WHEN** ttyds are running for `(claude, project-a, run, foo-...)` on port 7683 and `(codex, project-a, run, bar-...)` on port 7684
- **THEN** `GET /api/terminal/list` returns both entries as separate items in the `sessions` array, each with its own `port`

### Requirement: Frontend "Open in browser" button beside Ask Claude Code

The dashboard SHALL render the unified `OpenWithButton` split-button at THREE distinct call sites, all sourced from the SAME component (`apps/web/components/open-with-button.tsx`) so behaviour, agent-picker, drawer/popup affordance, and ttyd-install fallback are identical across placements:

1. **Project scope** — Rendered in the `AppBar` header (right side, after the tab list). Props: `{ project, scope: 'project', slug: 'root' }`. The button SHALL stay on the first row of the AppBar even when the tab list flex-wraps to a second row on narrow viewports.

2. **Exp scope** — Rendered in the experiment-page action bar (the same row that carries `EditMarkdownButton`). Props: `{ project, scope: 'exp', slug: <exp.id> }`.

3. **Run scope** — Rendered in each run panel's action bar on the experiment page. Props: `{ project, scope: 'run', slug: <runId> }`.

Clicking the main face of the split-button SHALL open the drawer with the user's last-picked agent (read from `localStorage['memon:terminal:default-agent']`). Clicking the chevron SHALL open a `DropdownMenu` listing `Terminal | Claude Code | Codex | OpenCode` plus a `Open in new window` action that fires `window.open` to `/terminal-popup`. The same drawer-or-popup pair from the existing run scope SHALL be used for exp and project scopes.

The split-button container SHALL use the `bg-card` Tailwind token (NOT `bg-background`). In light mode the `--card` token resolves to pure white (`oklch(100% 0 0)`) while `--background` is an off-white tint; pure white reads as a distinct affordance against the slightly tinted page background and AppBar. In dark mode `bg-card` continues to map to the dark-card token, so the rule is theme-aware. This applies to all three call sites (project / exp / run) since they all render through the same component.

The legacy clipboard-copy button `OpenClaudeCodeButton` (a placeholder that copied `cd <dir> && claude` to clipboard) SHALL be removed from the codebase. The matching `POST /api/open-claude-code` endpoint SHALL be removed too.

When `GET /api/terminal/check` returns `{ available: false }` AND ttyd is not auto-downloadable, the button at every call site SHALL render disabled with a tooltip showing the install suggestion (matching the existing run-scope behaviour). When ttyd IS auto-downloadable, the button SHALL switch to an inline `Install ttyd (~5MB)` form that installs in-place on click.

#### Scenario: Project-scope button in AppBar
- **GIVEN** the user is on `/p/project-a`
- **WHEN** the page renders
- **THEN** the AppBar shows an `Open with [Agent]` split-button on the right side of the tab list
- **AND** clicking the main face opens the drawer for `(claude, project-a, project, root)` (or whatever the user's stored default agent is)
- **AND** the drawer's tmux session is `memon-claude-project-a--project--root` running at `<project.root>`

#### Scenario: Exp-scope button replaces the clipboard placeholder
- **GIVEN** the user is on `/p/project-a/e/E0042-bar`
- **WHEN** the page renders
- **THEN** the action-bar slot that previously held `OpenClaudeCodeButton` now holds the `OpenWithButton`
- **AND** the legacy clipboard-copy button is absent from the DOM
- **AND** clicking the main face opens the drawer for `(claude, project-a, exp, E0042-bar)` at the project root cwd

#### Scenario: Run-scope button unchanged
- **GIVEN** the user expands a run panel on the experiment page
- **WHEN** the run-panel action bar renders
- **THEN** the `OpenWithButton` shown for that run continues to use `scope: 'run', slug: <runId>` exactly as before this change

#### Scenario: Three call sites share one component file
- **GIVEN** the diff for this change
- **WHEN** an auditor greps for `OpenWithButton` definition
- **THEN** there is exactly one component definition (`apps/web/components/open-with-button.tsx`)
- **AND** AppBar, experiment-page exp-header, and experiment-page run-panel all import and render that same component with different `(scope, slug)` props

#### Scenario: ttyd unavailable disables the button at every call site
- **WHEN** `GET /api/terminal/check` returns `{ available: false, downloadable: false }`
- **THEN** all three call sites render their button as disabled
- **AND** each shows the install hint tooltip on hover

#### Scenario: Split-button container uses bg-card, not bg-background
- **WHEN** the served HTML or compiled CSS is inspected for the split-button container at any of the three call sites
- **THEN** the container element carries the Tailwind class `bg-card` and does NOT carry `bg-background`
- **AND** in light mode the rendered background is pure white (the `--card` token resolves to `oklch(100% 0 0)`), distinct from the off-white page background

#### Scenario: Legacy /api/open-claude-code is gone
- **WHEN** any client POSTs `/api/open-claude-code` after this change ships
- **THEN** the route returns 404 (the route handler is deleted from the codebase)
- **AND** no `OpenClaudeCodeButton` import remains in `apps/web/components/` or `apps/web/app/`

### Requirement: Terminal manager cleans up on memon process exit

When the memon Node process receives SIGINT / SIGTERM / `beforeExit`, the terminal manager SHALL kill EVERY active ttyd child in its session map before exiting. The tmux sessions SHALL remain alive (since `tmux` daemon outlives the memon process group).

#### Scenario: memon receives SIGINT with multiple ttyds
- **GIVEN** the manager holds three entries on ports 7683, 7684, 7685
- **WHEN** the user presses Ctrl+C on memon
- **THEN** all three ttyd child processes are sent SIGTERM
- **AND** all three corresponding tmux sessions remain alive on the host (verifiable via `tmux ls`)

### Requirement: Next.js custom server proxies ttyd HTTP and WebSocket traffic

A custom Node entrypoint (`apps/web/server.ts`) SHALL replace the default `next start` / `next dev` runners as memon's process boot path. It SHALL wrap `next()` and attach two interceptors to its underlying `http.Server`:

1. On the `request` event, when `req.url` begins with `/api/terminal/proxy/`, the entry SHALL extract `<sessionName>` from the URL (the segment between `/api/terminal/proxy/` and the next `/`), look up the corresponding port in the terminal manager's session map, verify HTTP Basic credentials against the same shared `verifyBasic` / `runtime.auth` path used by `apps/web/middleware.ts`, then proxy the HTTP request and response stream to `127.0.0.1:<port>` preserving headers, status, and body. For all other paths, the entry SHALL delegate to Next's request handler unchanged. If `<sessionName>` does not resolve to a live entry, the proxy SHALL respond with `502 Bad Gateway` and a one-line message.

2. On the `upgrade` event, the same routing applies: extract `<sessionName>`, look up the port, verify auth, forward the WebSocket upgrade to `127.0.0.1:<port>`. The proxy SHALL bump the entry's `lastActiveAt` on successful WebSocket open and on close (these timestamps drive the Idle TTL killer below).

The proxy SHALL NOT alter ttyd's URL scheme — `/api/terminal/proxy/<sessionName>/...` continues to resolve, ttyd is still launched with `-b /api/terminal/proxy/<sessionName>`, and the `start` endpoint's response shape is unchanged.

#### Scenario: HTTP request to ttyd index streams through to the right port
- **GIVEN** the manager holds a session for `memon-claude-project-a--run--foo-...` on port 7683
- **WHEN** an authenticated client sends `GET /api/terminal/proxy/memon-claude-project-a--run--foo-.../`
- **THEN** the custom server forwards the request to `127.0.0.1:7683/api/terminal/proxy/memon-claude-project-a--run--foo-.../`
- **AND** ttyd's index HTML body is streamed back with the original status and content-type
- **AND** Next.js's request handler is NOT invoked

#### Scenario: WebSocket upgrade routes to the per-session port
- **GIVEN** the manager holds two sessions: `<sess-A>` on 7683 and `<sess-B>` on 7684
- **WHEN** an authenticated client opens `ws://<host>/api/terminal/proxy/<sess-A>/ws`
- **THEN** the upgrade is forwarded to `127.0.0.1:7683`, NOT 7684
- **AND** the entry for `<sess-A>` has its `lastActiveAt` bumped

#### Scenario: Anonymous WebSocket upgrade is rejected before reaching ttyd
- **WHEN** an anonymous client opens `ws://<host>/api/terminal/proxy/<sess>/ws` (no `Authorization` header)
- **THEN** the custom server responds with `HTTP/1.1 401 Unauthorized` + `WWW-Authenticate: Basic realm="memon"` and closes the socket
- **AND** ttyd receives no upgrade request

#### Scenario: Unknown sessionName returns 502
- **WHEN** an authenticated client sends `GET /api/terminal/proxy/memon-claude-project-a--run--missing/`
- **AND** no manager entry exists for that sessionName
- **THEN** the custom server returns `502 Bad Gateway`

#### Scenario: Non-proxy path falls through to Next
- **WHEN** any request whose path does NOT begin with `/api/terminal/proxy/` arrives
- **THEN** the custom server delegates to Next's standard handler

### Requirement: Drawer state persists across panel close until route change

The browser-terminal drawer SHALL be opened and dismissed by a single `TerminalDrawerProvider` mounted in the ROOT layout (`apps/web/app/layout.tsx`), reachable from every page in the dashboard including `/manage/tmux`. The drawer state SHALL persist across pathname changes — navigation alone SHALL NOT close the drawer or kill the underlying ttyd / tmux.

Closing the drawer (the `X` button, escape key, or outside-click) SHALL hide the drawer WITHOUT calling `POST /api/terminal/stop`. The underlying ttyd + tmux session stays alive so the next open is an instant reattach.

The drawer SHALL NOT expose a `Close + stop session` button. The only path that kills tmux is the management page's `Kill` action (per the `tmux-session-management` capability). Killing ttyd (without killing tmux) is automatic via the LRU + Idle TTL machinery and does not need a per-drawer affordance.

The drawer's `<SheetContent>` SHALL size to `w-[min(80vw,1280px)] sm:max-w-[1280px]` — capped at 1280px on desktop and 80vw on small screens. Below the 1280px breakpoint the 80vw cap dominates so the underlying page always retains at least 20vw of visible width.

#### Scenario: Closing the drawer leaves ttyd and tmux alive
- **GIVEN** the user opened the terminal drawer for `(claude, project-a, run, foo-...)` and ttyd is running
- **WHEN** the user clicks the drawer's `X` close button
- **THEN** the drawer hides
- **AND** `POST /api/terminal/stop` is NOT called
- **AND** `GET /api/terminal/list` still returns the same session

#### Scenario: Reopening the drawer reattaches to the live ttyd
- **GIVEN** the drawer was closed (per scenario above) and the manager entry is still live
- **WHEN** the user clicks `Open with [claude code]` again from the same run panel
- **THEN** the drawer reopens with the same iframe URL — `startTerminal` returns the existing entry idempotently

#### Scenario: Route change keeps the session alive
- **GIVEN** the drawer is open with an active ttyd session for `(claude, project-a, run, foo-...)`
- **WHEN** the user navigates to a different route (e.g. clicks Hypotheses)
- **THEN** the drawer stays open showing the same iframe
- **AND** ttyd and tmux are unaffected
- **AND** the same drawer state survives navigation back to the original page

#### Scenario: Drawer is reachable from the management page
- **WHEN** the user is on `/manage/tmux` and clicks `Open in drawer` on a row
- **THEN** the same `TerminalDrawerProvider` (mounted at root) opens the drawer on top of the management page
- **AND** the iframe loads the corresponding ttyd

#### Scenario: Drawer width caps at 80vw on small screens
- **GIVEN** the viewport width is 1024px
- **WHEN** the drawer opens
- **THEN** the `<SheetContent>` is approximately 819px wide (80vw), NOT the 1280px desktop ceiling
- **AND** at least 205px (20vw) of the underlying page remains visible

#### Scenario: Drawer width caps at 1280px on wide screens
- **GIVEN** the viewport width is 1920px
- **WHEN** the drawer opens
- **THEN** the `<SheetContent>` is exactly 1280px wide (the absolute cap), NOT 1536px (80vw of 1920)

### Requirement: Popup-window mode opens the terminal in a separate browser window

The frontend SHALL provide TWO entry points to popup mode:

1. **Drawer header `Pop out` button**: opens the same `(agent, project, scope, slug)` currently shown in the drawer in a popup window AND closes the drawer. Both views share the same ttyd via the manager's sessionName dedup.

2. **`/manage/tmux` row action `Open in popup`**: opens the row's session in a popup window. This action SHALL be hidden on viewports below the Tailwind `md` breakpoint (mobile browsers don't honor popup chrome).

The popup SHALL navigate to `/terminal-popup?project=<name>&scope=<exp|run>&slug=<slug>&agent=<kind>` opened via `window.open(url, target, features)` where:
- `target` SHALL be `memon-popup-<sessionName>` so repeated clicks for the same sessionName refocus the existing popup instead of duplicating.
- `features` SHALL be `popup,width=1200,height=800`.

The `/terminal-popup` route SHALL render a chrome-less page (no AppBar, no Sidebar) containing the same `TerminalView` body the drawer uses, sized to occupy the full popup viewport. The popup window inherits HTTP Basic auth from the same-origin browser auth cache.

#### Scenario: Pop out from drawer
- **GIVEN** the drawer is showing `(claude, project-a, run, foo-...)`
- **WHEN** the user clicks the `Pop out` button in the drawer header
- **THEN** `window.open('/terminal-popup?project=project-a&scope=run&slug=foo-...&agent=claude', 'memon-popup-memon-claude-project-a--run--foo-...', 'popup,width=1200,height=800')` is called
- **AND** the drawer closes immediately afterward
- **AND** when the popup mounts, its `startTerminal` call returns the same `(sessionName, url, port)` as the drawer was using — the same ttyd serves both clients during the brief overlap

#### Scenario: Open in popup from management page
- **WHEN** the user clicks `Open in popup` on a row of `/manage/tmux`
- **THEN** the popup opens identically to the drawer's `Pop out` flow, with parameters derived from that row's parsed `(agent, project, scope, slug)`

#### Scenario: Repeat-click refocuses the existing popup
- **GIVEN** a popup window is already open for `<sessionName-X>`
- **WHEN** the user clicks an action that pops out the same sessionName
- **THEN** `window.open` returns the existing window and that window is brought to focus, NOT a duplicate

#### Scenario: Mobile viewport hides the popup action on the management page
- **GIVEN** the viewport width is below the Tailwind `md` breakpoint
- **WHEN** the management page renders rows
- **THEN** the `Open in popup` button per row is `display: none` (Tailwind `hidden md:inline-flex`)

### Requirement: Session-name format with project, scope, and double-hyphen scope delimiter

Every memon-managed tmux session name SHALL match the format `memon-<agent>-<project>--<scope>--<slug>` where:
- `<agent>` is one of `terminal | claude | codex | opencode`.
- `<project>` matches the project-name validation rule.
- `<scope>` is one of `exp | run | project`.
- `<slug>` matches `^[A-Za-z0-9._-]+$` AND does NOT contain the substring `--`. For `<scope> = project`, the slug SHALL be the literal `root`.

The double-hyphen `--` is RESERVED as the scope delimiter. The parser SHALL split a session name on `--` into exactly three segments: `[<memon-agent-project>, <scope>, <slug>]`.

For listing on `/manage/tmux`, the parser SHALL ALSO recognize the legacy format `memon-<agent>-<runId>` (no `--`) and classify those rows as `stale (old format)`. New ttyd spawns SHALL NOT use the legacy format.

#### Scenario: Parse a new-format session name
- **GIVEN** a session name `memon-claude-project-a--run--foo-260507-103000`
- **WHEN** the parser is invoked
- **THEN** the parsed parts are `{ agent: 'claude', project: 'project-a', scope: 'run', slug: 'foo-260507-103000' }`

#### Scenario: Parse with multi-hyphen project
- **GIVEN** a session name `memon-claude-sparse-fsdp--exp--E0042-bar`
- **WHEN** the parser is invoked
- **THEN** the parsed parts are `{ agent: 'claude', project: 'sparse-fsdp', scope: 'exp', slug: 'E0042-bar' }`

#### Scenario: Parse a project-scope session name
- **GIVEN** a session name `memon-claude-project-a--project--root`
- **WHEN** the parser is invoked
- **THEN** the parsed parts are `{ agent: 'claude', project: 'project-a', scope: 'project', slug: 'root' }`

#### Scenario: Recognize legacy format as stale
- **GIVEN** a session name `memon-claude-foo-260507-103000` (no `--`)
- **WHEN** the parser is invoked from the management-page list endpoint
- **THEN** the row is classified as `stale (old format)` and the parsed parts are `{ agent: 'claude', legacy: true, raw: '<full name>' }` (project / scope / slug are unset)

### Requirement: Multi-port ttyd manager with LRU eviction and idle-TTL killer

The terminal manager SHALL maintain `Map<sessionName, Entry>` where each Entry holds `{ child: ChildProcess, port: number, startedAt, lastActiveAt, agent, project, scope, slug, warnings }`. There is NO single-port constraint.

A port allocator SHALL assign each new entry the first free port found by scanning from `7682` upward (with a per-port listen-then-close probe to detect external occupants). The allocator SHALL cap the scan at 256 ports above the start; if exhausted, `startSession` SHALL throw `TTYD_UNAVAILABLE` with a message indicating port exhaustion.

The number of concurrent live entries SHALL NOT exceed `terminal.ttyd_max_concurrent` (default 16). When `startSession` is invoked while at the cap, the manager SHALL evict the least-recently-active entry whose WebSocket is currently disconnected (LRU). If all entries are connected, the LRU rule still applies and the displaced client gets a "Disconnected" iframe. Eviction SHALL kill the ttyd child but SHALL NOT call `tmux kill-session` — the tmux session is preserved.

A 60-second polling loop SHALL kill any entry whose WebSocket has had no connected client for longer than `terminal.ttyd_idle_ttl_minutes` (default 30; `0` disables the killer). Idle-TTL kills SHALL kill ttyd but SHALL NOT call `tmux kill-session`.

A per-sessionName promise serializer SHALL prevent concurrent `startSession` calls on the same sessionName from spawning duplicate ttyds. Different sessionNames proceed in parallel.

#### Scenario: Multiple ttyds coexist on different ports
- **WHEN** the user opens drawer for `(claude, project-a, run, foo-...)` then opens popup for `(codex, project-b, exp, E0042-bar)`
- **THEN** both ttyds are running concurrently, each on its own port from the allocator
- **AND** both have entries in the manager's session map

#### Scenario: LRU evicts the oldest disconnected entry at cap
- **GIVEN** `ttyd_max_concurrent = 4` and four entries `A, B, C, D` exist with `lastActiveAt` ordered `A < B < C < D`, and `A`'s WebSocket is currently disconnected
- **WHEN** `startSession` is called for a new sessionName `E`
- **THEN** the manager kills `A`'s ttyd child and inserts `E`
- **AND** `A`'s tmux session is still alive on the host

#### Scenario: Idle TTL kills a long-idle ttyd
- **GIVEN** `ttyd_idle_ttl_minutes = 30` and entry `A`'s WebSocket has had no connected client for 31 minutes
- **WHEN** the polling loop ticks
- **THEN** the manager kills `A`'s ttyd child but leaves `A`'s tmux session alive
- **AND** `A` is removed from the session map

#### Scenario: Idle TTL = 0 disables the killer
- **GIVEN** `ttyd_idle_ttl_minutes = 0`
- **THEN** the polling loop is not started (or is a no-op) and idle entries are kept indefinitely

#### Scenario: Concurrent startSession calls on same sessionName don't double-spawn
- **WHEN** two simultaneous POSTs to `/api/terminal/start` for the same `(agent, project, scope, slug)` arrive
- **THEN** the second call awaits the first via the per-sessionName serializer and both responses return the same `(sessionName, url, port, startedAt)` from the single resulting entry

### Requirement: Conversation auto-resume for claude / codex / opencode agents

On `startSession` where the request specifies `agent: 'claude' | 'codex' | 'opencode'` AND no manager entry exists yet for the computed `sessionName`, the manager SHALL probe the corresponding CLI's local conversation storage for a resumable id keyed by the absolute path of the target directory (run dir for `scope: 'run'`; project root for `scope: 'exp'`).

When a resumable id is found, the manager SHALL append the CLI's resume-form to the agent's argv such that the agent reattaches to the prior conversation:
- `claude --continue` (continues the most recent conversation in `cwd`).
- `codex resume --last`.
- `opencode` resume form (specific subcommand TBD at implementation time).

When no resumable conversation is found OR the probe errors, the manager SHALL spawn the agent fresh with no resume flag.

The probe SHALL be best-effort: any filesystem error during the probe is silently treated as `no resumable session`, never blocking the spawn.

#### Scenario: Claude with resumable conversation in run dir
- **GIVEN** `~/.claude/projects/<encoded-run-dir>/` exists and contains at least one jsonl session file
- **WHEN** `startSession({ project, scope: 'run', slug, agent: 'claude' })` is called for the first time for that combo
- **THEN** the spawned tmux command's argv tail is `claude --continue`

#### Scenario: Claude with no prior conversation falls back to fresh
- **GIVEN** `~/.claude/projects/<encoded-run-dir>/` does not exist
- **WHEN** `startSession({ ..., agent: 'claude' })` is called
- **THEN** the spawned argv tail is plain `claude` (no `--continue`)

#### Scenario: agent='none' is unaffected
- **WHEN** `startSession({ ..., agent: 'none' })` is called
- **THEN** the manager SHALL NOT probe any conversation store; `none` has no conversation concept

#### Scenario: Probe error is silent
- **WHEN** the resume probe throws (e.g. permission denied on the CLI's storage dir)
- **THEN** the spawn proceeds with no resume flag, and the error is NOT surfaced to the user

### Requirement: Project name format constraint at config load

`packages/core/src/schemas.ts` `ProjectConfigRawSchema` SHALL constrain `name` to `^[A-Za-z0-9-]+$`. `config/load.ts` SHALL surface a clear error when this regex fails: `invalid config: projects[i].name must match [A-Za-z0-9-]+ (got "<bad>")`. Project names containing other characters (spaces, dots, slashes, etc.) SHALL be rejected at config load.

This rule is necessary because project names appear in tmux session names (per the session-name format requirement) and in URL paths.

#### Scenario: Valid project name passes
- **GIVEN** `config.yml` lists `projects: [{ name: "project-a", root: "..." }]`
- **WHEN** `loadConfig` runs
- **THEN** the config loads without error

#### Scenario: Project name with space rejected
- **GIVEN** `config.yml` lists `projects: [{ name: "bad name", root: "..." }]`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError` with message including `projects[0].name must match [A-Za-z0-9-]+`

#### Scenario: Project name with dot rejected
- **GIVEN** `config.yml` lists `projects: [{ name: "v1.0", root: "..." }]`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError`

### Requirement: terminal config block in config.yml

`packages/core/src/schemas.ts` SHALL add an optional `terminal:` config section accepting fields:
- `ttyd_max_concurrent` (positive integer; default `16` when absent or block absent).
- `ttyd_idle_ttl_minutes` (non-negative integer; default `30`; `0` disables the idle-TTL killer).
- `pane_info_active_poll_ms` (positive integer; default `5000`). The recommended client-side polling interval for tmux pane info when the named session has a live ttyd entry (`liveEntry !== null`). Consumed by `/manage/tmux` and the future per-target `OpenWithButton` indicator.
- `pane_info_idle_poll_ms` (positive integer; default `60000`). The recommended client-side polling interval when the named session has NO live ttyd entry (no ttyd bound, or the tmux session itself does not yet exist on the host). Must be `>= pane_info_active_poll_ms`.

`packages/core/src/config/load.ts` SHALL apply the defaults when the field or block is absent. The resolved config SHALL surface these to the runtime as `runtime.config.terminal: { ttydMaxConcurrent: number, ttydIdleTtlMinutes: number, paneInfoActivePollMs: number, paneInfoIdlePollMs: number }`.

`load.ts` SHALL also validate `paneInfoIdlePollMs >= paneInfoActivePollMs` and throw `ConfigError` otherwise — the tier ordering is load-bearing for the future per-button surface.

The committed `config.example.yml` SHALL include a commented-out example of the `terminal:` block listing every field with its default value, so users can copy-uncomment-edit without consulting the source.

#### Scenario: Block absent uses defaults

- **GIVEN** `config.yml` has no `terminal:` block
- **THEN** `runtime.config.terminal` is `{ ttydMaxConcurrent: 16, ttydIdleTtlMinutes: 30, paneInfoActivePollMs: 5000, paneInfoIdlePollMs: 60000 }`

#### Scenario: Partial config fills in defaults

- **GIVEN** `config.yml` has `terminal: { ttyd_max_concurrent: 8 }` only
- **THEN** `runtime.config.terminal` is `{ ttydMaxConcurrent: 8, ttydIdleTtlMinutes: 30, paneInfoActivePollMs: 5000, paneInfoIdlePollMs: 60000 }`

#### Scenario: Pane-info polling values override defaults

- **GIVEN** `config.yml` has `terminal: { pane_info_active_poll_ms: 3000, pane_info_idle_poll_ms: 120000 }`
- **THEN** `runtime.config.terminal.paneInfoActivePollMs` is `3000` and `runtime.config.terminal.paneInfoIdlePollMs` is `120000`

#### Scenario: Negative max_concurrent rejected

- **GIVEN** `config.yml` has `terminal: { ttyd_max_concurrent: -1 }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError`

#### Scenario: Zero or negative pane_info_active_poll_ms rejected

- **GIVEN** `config.yml` has `terminal: { pane_info_active_poll_ms: 0 }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError`

#### Scenario: pane_info_idle_poll_ms below active rejected

- **GIVEN** `config.yml` has `terminal: { pane_info_active_poll_ms: 5000, pane_info_idle_poll_ms: 2000 }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError` with a message indicating that idle must be >= active

