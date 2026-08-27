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

`POST /api/terminal/install` SHALL download the pinned ttyd version's prebuilt static binary for the current architecture from `https://github.com/tsl0922/ttyd/releases/download/<version>/ttyd.<arch>`. It SHALL also download the same release's `SHA256SUMS`, require one exact checksum entry for the selected asset, bound both checksum and binary response sizes, and verify the binary before writing it to `~/.cache/memon/bin/ttyd-<version>-<arch>` via temp-file + rename and `chmod +x`. Missing, malformed, oversized, or mismatched checksum data SHALL fail closed. The endpoint SHALL NOT require root or any system package manager and browser/central responses SHALL NOT expose the internal executable path.

The pinned version SHALL be a string constant in source (for example `TTYD_VERSION = '1.7.7'`); upgrading is a code change.

#### Scenario: First install on linux x86_64
- **WHEN** ttyd is missing and the user POSTs `/api/terminal/install` on a Host where `process.arch === 'x64'`
- **THEN** the owning Backend downloads `https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64`
- **AND** verifies sha256 against the exact `ttyd.x86_64` entry in the same release's `SHA256SUMS`
- **AND** writes the binary to `~/.cache/memon/bin/ttyd-1.7.7-x86_64` with mode 0755
- **AND** `--version` on that file outputs `ttyd version 1.7.7…`
- **AND** the public response contains the version and duration but not the cache path

#### Scenario: Concurrent install calls
- **WHEN** two install requests fire simultaneously
- **THEN** memon serializes them so only one network download happens; the second observes the installed cache entry
- **AND** the on-disk file is never observed in a partial state

#### Scenario: Network failure during download
- **WHEN** the release asset is unreachable or returns an error
- **THEN** installation fails with a safe `DOWNLOAD_FAILED` result
- **AND** no partial executable remains in the cache directory

#### Scenario: Checksum unavailable or malformed
- **WHEN** `SHA256SUMS` is unreachable, missing the selected asset, malformed, or exceeds its bound
- **THEN** installation fails closed with `INTEGRITY_FAILED`
- **AND** no downloaded binary is executed

#### Scenario: SHA256 mismatch
- **WHEN** the downloaded binary's sha256 does not match the selected `SHA256SUMS` entry
- **THEN** the temp file is deleted and installation fails with `INTEGRITY_FAILED`

#### Scenario: Install on macOS
- **WHEN** install is requested on `process.platform === 'darwin'` with no supported upstream prebuilt
- **THEN** installation reports `NOT_AUTOFETCHABLE` with a safe manual suggestion

#### Scenario: Cache hit on subsequent call
- **WHEN** a valid cached binary already exists at the expected path
- **THEN** installation short-circuits without network access and returns a safe `alreadyPresent` result

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

For every value of `agent`, the spawned tmux argv tail SHALL be:

```
tmux new-session -A -s <sessionName> -c <cwd> <...terminal.commands[<agent>]> [<resume-tail> if resumable]
```

where `terminal.commands[<agent>]` is the resolved argv array from `runtime.config.terminal.commands` (per the "terminal config block in config.yml" requirement below). When the resolved argv is the empty array (only legal for `agent: 'none'`), no trailing command is pushed and tmux runs its default shell. The `<resume-tail>` is the output of the resume probe (per the "Conversation auto-resume for claude / codex / opencode agents" requirement) and SHALL be appended after the user's argv unchanged. The probe SHALL return `[]` for `agent: 'none'` so the resume tail is empty in that case.

The defaults applied by `loadConfig` reproduce the legacy hard-coded behaviour exactly:

| `agent` | default `terminal.commands[<agent>]` | effective tmux argv tail with defaults |
|---|---|---|
| `none` | `[]` | `tmux new-session -A -s <sessionName> -c <cwd>` (no trailing command) |
| `claude` | `["claude"]` | `tmux new-session -A -s <sessionName> -c <cwd> claude [--continue if resumable]` |
| `codex` | `["codex"]` | `tmux new-session -A -s <sessionName> -c <cwd> codex [resume-form if resumable]` |
| `opencode` | `["opencode"]` | `tmux new-session -A -s <sessionName> -c <cwd> opencode [resume-form if resumable]` |

The response shape SHALL be `{ sessionName, url, port, startedAt, warnings }`. The `url` SHALL be `/api/terminal/proxy/<sessionName>/`. The `port` SHALL be the dynamically allocated port for THIS session (per the Multi-port ttyd manager requirement below).

A subsequent `start` call for the same `sessionName` (i.e. same `(agent, project, scope, slug)`) whose entry is healthy in the manager SHALL return the existing entry's `(sessionName, url, port, startedAt, warnings)` rather than spawning a new ttyd. This is the dedup that lets drawer + popup share the same ttyd.

The endpoint SHALL be classified as a `shell` route under the `auth-system` capability and therefore SHALL require valid `Authorization: Basic` credentials.

If the requested `(project, slug, scope)` cannot be resolved to an on-disk target (project not in config, run dir missing, exp doc missing), the server SHALL still spawn ttyd + tmux at the project root or HOME (gracefully degrading) AND return a `warnings: string[]` entry like `target not found on disk`. This lets the management page's `Open in drawer` work for stale entries. For `scope: 'project'`, the only target check is project-in-config; slug is not validated.

If the first element of the configured `terminal.commands[<agent>]` argv is not on PATH (or the user-supplied wrapper itself fails), the early-stderr capture SHALL surface a warning in `warnings`, and the ttyd session SHALL still be returned.

#### Scenario: Default agent is claude with run scope

- **WHEN** a caller POSTs `{ project: "project-a", scope: "run", slug: "foo-260507-103000" }` (no `agent` field) against a config where `terminal.commands` is absent or `commands.claude` is its default
- **THEN** the spawned tmux command is `tmux new-session -A -s memon-claude-project-a--run--foo-260507-103000 -c <run-dir-abspath> claude` (with `--continue` appended only if a prior conversation in `<run-dir-abspath>` exists in claude's local store)
- **AND** the response `sessionName` is `"memon-claude-project-a--run--foo-260507-103000"`

#### Scenario: agent='none' opens a plain shell at run dir

- **WHEN** a caller POSTs `{ project: "project-a", scope: "run", slug: "foo-260507-103000", agent: "none" }` against a config where `commands.none` is its default `[]`
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

- **GIVEN** the user posts `{ project, scope, slug, agent: "codex" }` on a host without `codex` on PATH (defaults in effect)
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

#### Scenario: Custom claude argv from terminal.commands overrides the default

- **GIVEN** `config.yml` sets `terminal.commands.claude: ["claude", "--dangerously-skip-permissions"]` and `commands.codex` / `commands.opencode` / `commands.none` are absent
- **WHEN** an authenticated caller POSTs `{ project: "project-a", scope: "run", slug: "foo-260507-103000", agent: "claude" }` AND no resumable conversation exists for that cwd
- **THEN** the spawned tmux command's argv tail after `-c <cwd>` is exactly `claude --dangerously-skip-permissions` (no `--continue`)
- **AND** for the same call with a resumable conversation present, the argv tail is `claude --dangerously-skip-permissions --continue`
- **AND** a parallel call with `agent: 'codex'` against the same config still produces the default `codex` argv

#### Scenario: Custom none-agent argv runs a non-shell command

- **GIVEN** `config.yml` sets `terminal.commands.none: ["zsh", "-l"]`
- **WHEN** an authenticated caller POSTs `{ project, scope: "run", slug, agent: "none" }`
- **THEN** the spawned tmux command's argv tail after `-c <cwd>` is exactly `zsh -l`
- **AND** no resume tail is appended (the probe returns `[]` for `agent: 'none'`)
- **AND** the session name is still prefixed `memon-terminal-` (the session-name format is unchanged by command overrides)

#### Scenario: Custom claude argv with missing binary surfaces a warning

- **GIVEN** `config.yml` sets `terminal.commands.claude: ["claude-dev"]` on a host where `claude-dev` is not on PATH
- **WHEN** the authenticated caller POSTs `{ project, scope, slug, agent: "claude" }`
- **THEN** ttyd is spawned, tmux exits early (`claude-dev: command not found`), and the early-stderr capture adds a `warnings` entry mentioning the missing command
- **AND** the response still returns the `sessionName` and `port` (200, not 5xx)

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

The browser-terminal drawer SHALL be opened and dismissed by a single `TerminalDrawerProvider` mounted in the ROOT layout (`apps/web/app/layout.tsx`), reachable from every page in the dashboard including `/manage/tmux`. The active terminal target and presentation surface SHALL persist across pathname changes — navigation alone SHALL NOT close the terminal or kill the underlying ttyd / tmux.

The target state SHALL be a discriminated union with these modes:
- **Standard mode** (`kind: 'standard'`): carries `(project, scope, slug, agent)` and starts or reattaches through the standard terminal API.
- **Raw mode** (`kind: 'raw'`): carries `sessionName` and attaches to an existing tmux session by name.
- **Herdr mode** (`kind: 'herdr'`): optionally carries `(project, scope, slug)` and starts or reattaches the shared Herdr ttyd client after target workspace setup when a target is present.

The provider SHALL expose existing drawer-open methods plus equivalent split-open methods for standard, raw, and Herdr targets. Existing callers of the drawer-open methods SHALL retain their behavior.

The panel header in raw mode SHALL show the sessionName as the title. Closing either the drawer or right split SHALL hide the browser client WITHOUT calling the terminal stop API. The underlying ttyd and backend-managed process SHALL remain alive. The panel SHALL NOT expose a `Close + stop session` button.

On desktop, the drawer SHALL open at the user's persisted drawer width. With no stored preference, its effective width SHALL remain the historical `min(80vw, 1280px)` default. A divider on its left edge SHALL allow pointer dragging and keyboard resizing. The effective width SHALL be clamped so the panel remains usable and a viewport gutter remains visible. The selected drawer width SHALL persist locally and SHALL be independent from the right-split width.

On a viewport below the 768-pixel breakpoint, the resize divider SHALL be hidden and the overlay drawer SHALL remain the only in-page terminal presentation.

#### Scenario: Closing the drawer leaves ttyd and tmux alive
- **GIVEN** the user opened the terminal drawer for `(claude, project-a, run, foo-...)` and ttyd is running
- **WHEN** the user clicks the drawer's close button
- **THEN** the drawer hides
- **AND** the terminal stop API is NOT called
- **AND** the terminal list still returns the same session

#### Scenario: Reopening the drawer reattaches to the live ttyd
- **GIVEN** the drawer was closed and the manager entry is still live
- **WHEN** the user opens the same target again
- **THEN** the drawer reopens using the existing manager-deduplicated ttyd entry

#### Scenario: Route change keeps the terminal visible
- **GIVEN** a drawer or right split is open with an active terminal
- **WHEN** the user navigates to a different dashboard route
- **THEN** the same surface remains open with the same target
- **AND** the ttyd and its managed process are unaffected

#### Scenario: Route change keeps the session alive
- **GIVEN** the drawer is open with an active ttyd session
- **WHEN** the user navigates to a different dashboard route
- **THEN** the drawer stays open showing the same terminal target
- **AND** ttyd and the backend-managed process remain unaffected

#### Scenario: Drawer is reachable from the management page
- **WHEN** the user is on `/manage/tmux` and opens a matchable row in the drawer
- **THEN** the root terminal provider opens above the management page
- **AND** the iframe loads the corresponding ttyd

#### Scenario: Manual row opens in raw mode
- **GIVEN** a manual tmux row named `memon-manual-foo`
- **WHEN** the owner opens it in the drawer or right split
- **THEN** the provider uses raw target state with that session name
- **AND** the terminal attaches by session name instead of starting a parsed target

#### Scenario: Manual row opens drawer in raw mode
- **GIVEN** the user selects a manual tmux row such as `memon-manual-foo`
- **WHEN** the drawer opens
- **THEN** the provider uses raw target state with that session name
- **AND** the terminal attaches through the raw attach API rather than starting a parsed target

#### Scenario: Drawer preserves its historical initial width
- **GIVEN** no drawer width preference exists and the viewport is 1920 pixels wide
- **WHEN** the drawer opens
- **THEN** its initial width is 1280 pixels

#### Scenario: Drawer width caps at 80vw on small screens
- **GIVEN** no stored drawer width and a 1024-pixel viewport
- **WHEN** the drawer opens
- **THEN** its initial width is approximately 819 pixels
- **AND** the resize bounds keep a visible viewport gutter

#### Scenario: Drawer width caps at 1280px on wide screens
- **GIVEN** no stored drawer width and a 1920-pixel viewport
- **WHEN** the drawer opens
- **THEN** its initial width is 1280 pixels
- **AND** the user can subsequently resize it within the viewport-aware limits

#### Scenario: Dragging the drawer divider persists width
- **GIVEN** the desktop drawer is open
- **WHEN** the user drags its left divider and releases it at a valid new width
- **THEN** the drawer immediately uses that width
- **AND** reopening or reloading restores that drawer width

#### Scenario: Keyboard resizes the drawer
- **GIVEN** the drawer divider is focused
- **WHEN** the user presses ArrowLeft or ArrowRight
- **THEN** the drawer grows or shrinks respectively within its limits
- **AND** Shift plus an arrow uses a larger adjustment step

#### Scenario: Mobile keeps the overlay behavior
- **GIVEN** the viewport is narrower than 768 pixels
- **WHEN** a caller requests the split surface
- **THEN** the target opens in the overlay drawer
- **AND** no draggable horizontal split is rendered

### Requirement: Popup-window mode opens the terminal in a separate browser window

The frontend SHALL provide TWO entry points to popup mode:

1. **Drawer header `Pop out` button**: opens the currently-shown drawer state in a popup window AND closes the drawer. Both views share the same ttyd via the manager's sessionName dedup. The button works for both standard and raw drawer modes.

2. **`/manage/tmux` row action `Open in popup`**: opens the row's session in a popup window. This action SHALL be hidden on viewports below the Tailwind `md` breakpoint (mobile browsers don't honor popup chrome).

The popup SHALL navigate to `/terminal-popup?...` opened via `window.open(url, target, features)` where:
- For **standard mode**: query is `project=<name>&scope=<exp|run>&slug=<slug>&agent=<kind>`.
- For **raw mode**: query is `sessionName=<full-tmux-session-name>`. When this query param is present, the popup route uses raw mode and ignores any standard-mode params.
- `target` SHALL be `memon-popup-<sessionName>` so repeated clicks for the same sessionName refocus the existing popup instead of duplicating.
- `features` SHALL be `popup,width=1200,height=800`.

The `/terminal-popup` route SHALL render a chrome-less page (no AppBar, no Sidebar) containing the same `TerminalView` body the drawer uses, sized to occupy the full popup viewport. The popup window inherits HTTP Basic auth from the same-origin browser auth cache.

#### Scenario: Pop out from drawer (standard mode)
- **GIVEN** the drawer is showing standard mode `(claude, project-a, run, foo-...)`
- **WHEN** the user clicks the `Pop out` button in the drawer header
- **THEN** `window.open('/terminal-popup?project=project-a&scope=run&slug=foo-...&agent=claude', 'memon-popup-memon-claude-project-a--run--foo-...', 'popup,width=1200,height=800')` is called
- **AND** the drawer closes immediately afterward
- **AND** when the popup mounts, its `startTerminal` call returns the same `(sessionName, url, port)` as the drawer was using

#### Scenario: Pop out from drawer (raw mode)
- **GIVEN** the drawer is showing raw mode `{ sessionName: 'memon-manual-foo' }`
- **WHEN** the user clicks `Pop out`
- **THEN** `window.open('/terminal-popup?sessionName=memon-manual-foo', 'memon-popup-memon-manual-foo', 'popup,width=1200,height=800')` is called
- **AND** the popup mounts in raw mode and calls `attachTerminal({ sessionName: 'memon-manual-foo' })`

#### Scenario: Open in popup from management page (matchable row)
- **WHEN** the user clicks `Open in popup` on a matchable row of `/manage/tmux`
- **THEN** the popup opens with the standard query shape derived from the row's parsed `(agent, project, scope, slug)`

#### Scenario: Open in popup from management page (manual row)
- **WHEN** the user clicks `Open in popup` on a manual row of `/manage/tmux`
- **THEN** the popup opens with `?sessionName=<row.sessionName>` (raw mode) and the popup mounts in raw mode

#### Scenario: Repeat-click refocuses the existing popup
- **GIVEN** a popup window is already open for `<sessionName-X>`
- **WHEN** the user clicks an action that pops out the same sessionName
- **THEN** `window.open` returns the existing window and that window is brought to focus, NOT a duplicate

#### Scenario: Mobile viewport hides the popup action on the management page
- **GIVEN** the viewport width is below the Tailwind `md` breakpoint
- **WHEN** the management page renders rows
- **THEN** every row's `Open in popup` button per row is `display: none` (Tailwind `hidden md:inline-flex`)

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

`packages/core/src/schemas.ts` SHALL define an optional `terminal:` config section accepting fields:
- `ttyd_max_concurrent` (positive integer; default `16` when absent or block absent).
- `ttyd_idle_ttl_minutes` (non-negative integer; default `30`; `0` disables the idle-TTL killer).
- `pane_info_active_poll_ms` (positive integer; default `5000`). The recommended client-side polling interval for tmux pane info when the named session has a live ttyd entry (`liveEntry !== null`). Consumed by `/manage/tmux` and the future per-target `OpenWithButton` indicator.
- `pane_info_idle_poll_ms` (positive integer; default `60000`). The recommended client-side polling interval when the named session has NO live ttyd entry (no ttyd bound, or the tmux session itself does not yet exist on the host). Must be `>= pane_info_active_poll_ms`.
- `commands` (optional map keyed by `AgentKind`). Per-agent override of the tmux argv tail. Values are `string[]` (each element a non-empty string). When the block or an individual key is absent, `loadConfig` SHALL fill in the per-agent default below. Unknown keys (i.e. agent names not in `AGENT_KINDS`) SHALL be rejected at load time.

  Per-agent default:
  - `commands.none`: `[]` (no trailing command; tmux runs its default shell).
  - `commands.claude`: `["claude"]`.
  - `commands.codex`: `["codex"]`.
  - `commands.opencode`: `["opencode"]`.

  Per-agent validation: for every agent OTHER than `none`, the resolved argv MUST be a non-empty array of non-empty strings. `commands.none` MAY be `[]` (the default) OR a non-empty array of non-empty strings. Violations SHALL be reported by `loadConfig` via `ConfigError` with a message naming the offending agent and the rule that fired.

`packages/core/src/config/load.ts` SHALL apply the defaults when the field or block is absent. The resolved config SHALL surface these to the runtime as `runtime.config.terminal: { ttydMaxConcurrent: number, ttydIdleTtlMinutes: number, paneInfoActivePollMs: number, paneInfoIdlePollMs: number, commands: Record<AgentKind, readonly string[]> }`.

`load.ts` SHALL also validate `paneInfoIdlePollMs >= paneInfoActivePollMs` and throw `ConfigError` otherwise — the tier ordering is load-bearing for the future per-button surface.

The committed `config.example.yml` (or the comment block in `config.yml` that serves as the example) SHALL include a commented-out example of the `terminal:` block listing every field with its default value AND a commented `commands:` sub-map listing every agent with its default argv, so users can copy-uncomment-edit without consulting the source. The comment SHALL note that any resume tail (e.g. `--continue` for claude) is appended after the user's argv, so wrapping forms like `["bash","-lc","exec claude"]` will receive the resume tail as bash args rather than claude args.

#### Scenario: Block absent uses defaults

- **GIVEN** `config.yml` has no `terminal:` block
- **THEN** `runtime.config.terminal` is `{ ttydMaxConcurrent: 16, ttydIdleTtlMinutes: 30, paneInfoActivePollMs: 5000, paneInfoIdlePollMs: 60000, commands: { none: [], claude: ["claude"], codex: ["codex"], opencode: ["opencode"] } }`

#### Scenario: Partial config fills in defaults

- **GIVEN** `config.yml` has `terminal: { ttyd_max_concurrent: 8 }` only
- **THEN** `runtime.config.terminal` is `{ ttydMaxConcurrent: 8, ttydIdleTtlMinutes: 30, paneInfoActivePollMs: 5000, paneInfoIdlePollMs: 60000, commands: { none: [], claude: ["claude"], codex: ["codex"], opencode: ["opencode"] } }`

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

#### Scenario: Per-agent commands partial override

- **GIVEN** `config.yml` has `terminal: { commands: { claude: ["claude", "--model", "claude-sonnet-4-6"] } }`
- **WHEN** `loadConfig` runs
- **THEN** `runtime.config.terminal.commands` is `{ none: [], claude: ["claude","--model","claude-sonnet-4-6"], codex: ["codex"], opencode: ["opencode"] }`

#### Scenario: Per-agent commands full override

- **GIVEN** `config.yml` has `terminal: { commands: { none: ["zsh","-l"], claude: ["bash","-lc","source ~/.envrc && exec claude"], codex: ["codex","--profile","local"], opencode: ["opencode"] } }`
- **WHEN** `loadConfig` runs
- **THEN** `runtime.config.terminal.commands` equals the input map exactly (no defaults are merged in, since every key is present)

#### Scenario: commands.claude empty array rejected

- **GIVEN** `config.yml` has `terminal: { commands: { claude: [] } }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError` with a message naming `terminal.commands.claude` and the non-empty-array rule

#### Scenario: commands.none empty array accepted

- **GIVEN** `config.yml` has `terminal: { commands: { none: [] } }`
- **WHEN** `loadConfig` runs
- **THEN** it succeeds and `runtime.config.terminal.commands.none` is `[]`

#### Scenario: commands argv element is the empty string rejected

- **GIVEN** `config.yml` has `terminal: { commands: { claude: ["", "--continue"] } }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError` with a message naming `terminal.commands.claude` and the non-empty-string rule for argv elements

#### Scenario: Unknown agent key rejected

- **GIVEN** `config.yml` has `terminal: { commands: { aider: ["aider"] } }`
- **WHEN** `loadConfig` runs
- **THEN** it throws `ConfigError` with a message naming `aider` as an unrecognised agent kind (the closed set is `none | claude | codex | opencode`)

### Requirement: TerminalView broadcasts a terminal-attached event for cache holders

Every `<TerminalView>` instance SHALL post a message on a same-origin
`BroadcastChannel` named `memon:terminal-attached` once per mount,
fired exactly when the iframe enters the `ready` phase (i.e. after
the underlying `start` or `attach` POST resolves and the
`sessionName` is known). The message shape SHALL be:

```ts
type AttachedMessage = {
  sessionName: string  // resolved sessionName from the start/attach response
  source: 'manage' | 'drawer' | 'popup' | 'unknown'
  attachedAt: number  // Date.now() millis since epoch at broadcast time
}
```

The `sessionName` SHALL be the value returned by the `start` /
`attach` endpoint, NOT a synthesised guess from the input
`(project, scope, slug, agent)` quartet — the server's response is
the source of truth (e.g. when `agent` defaults to `'claude'` the
synthesis would still match, but using the server's value is the
robust path).

The `source` SHALL be derived from a new `source?: 'manage' |
'drawer' | 'popup' | 'unknown'` prop on `<TerminalView>`. Default
when absent: `'unknown'`. Known call sites SHALL pass the matching
value:
- `apps/web/components/terminal-drawer-provider.tsx` SHALL pass
  `source="drawer"` to its `<TerminalView>`.
- `apps/web/app/terminal-popup/terminal-popup-client.tsx` SHALL
  pass `source="popup"` to its `<TerminalView>` (both `mode='raw'`
  and `mode='standard'` branches).
- `apps/web/app/manage/tmux/tmux-page.client.tsx` SHALL pass
  `source="manage"` to every cached `<TerminalView>` it mounts in
  the right pane (per the `Right-pane TerminalView cache on
  /manage/tmux` requirement in the `tmux-session-management`
  capability).

The broadcast SHALL fire exactly ONCE per mount. Re-renders that do
NOT cross from `starting` / `error` to `ready` SHALL NOT fire it; a
mode change (raw ↔ standard) that re-runs the underlying `useEffect`
SHALL fire it again the next time `ready` is reached. The
`onSessionReady` callback (if provided) SHALL continue to fire
alongside the broadcast — the two are independent surfaces and SHALL
NOT be merged.

If `BroadcastChannel` is unavailable in the current browser
(`typeof BroadcastChannel === 'undefined'`), the broadcast SHALL be
silently skipped — no error, no warning. The `<TerminalView>` SHALL
otherwise render normally.

The channel instance MAY be created on demand inside the
`<TerminalView>` component (one channel per mount) or shared across
all `<TerminalView>` mounts in the same tab (one channel module-
local). Either is permitted; the wire format and semantics are
identical.

The channel SHALL be closed when the `<TerminalView>` instance
unmounts (`channel.close()` in the effect cleanup if a per-mount
channel) or kept open for the tab's lifetime if module-local. Per-
mount channels are simpler; module-local channels reduce
construction cost. The choice is implementation-internal.

#### Scenario: Standard-mode mount broadcasts on ready

- **GIVEN** a `<TerminalView mode="standard" project="project-a" scope="run" slug="foo-260507-103000" agent="claude" source="drawer" />` is freshly mounted
- **AND** the underlying `POST /api/terminal/start` resolves with `{ sessionName: "memon-claude-project-a--run--foo-260507-103000", url, port, ... }`
- **WHEN** the component transitions from `phase: 'starting'` to `phase: 'ready'`
- **THEN** a `BroadcastChannel('memon:terminal-attached')` SHALL post a message `{ sessionName: "memon-claude-project-a--run--foo-260507-103000", source: "drawer", attachedAt: <now-millis> }`
- **AND** any other tab subscribed to the same channel SHALL receive that message

#### Scenario: Raw-mode mount broadcasts on ready

- **GIVEN** a `<TerminalView mode="raw" sessionName="memon-manual-foo" source="popup" />` is freshly mounted
- **AND** `POST /api/terminal/attach` resolves with `{ sessionName: "memon-manual-foo", url, port, ... }`
- **WHEN** the component transitions to `phase: 'ready'`
- **THEN** the channel posts `{ sessionName: "memon-manual-foo", source: "popup", attachedAt: <now> }`

#### Scenario: source prop default is "unknown"

- **GIVEN** a `<TerminalView mode="standard" project="..." scope="run" slug="..." agent="claude" />` mount that does NOT pass a `source` prop
- **WHEN** it broadcasts on `ready`
- **THEN** the message's `source` field SHALL be `"unknown"`

#### Scenario: Broadcast fires once per mount, not on every re-render

- **GIVEN** a `<TerminalView>` is mounted and has reached `ready`
- **WHEN** the parent re-renders without changing the props that drive the mount effect (e.g. wrapping container layout shifts)
- **THEN** NO additional broadcast SHALL fire (the broadcast is gated on the `starting → ready` transition, which only happens once per mount/effect-run)

#### Scenario: Failed start does not broadcast

- **GIVEN** a `<TerminalView>` is mounted and `startTerminal` rejects (e.g. ttyd unavailable, network error)
- **WHEN** the component transitions from `phase: 'starting'` to `phase: 'error'`
- **THEN** NO `terminal-attached` broadcast SHALL fire

#### Scenario: BroadcastChannel unavailable does not throw

- **GIVEN** the browser does not support `BroadcastChannel` (`typeof BroadcastChannel === 'undefined'`)
- **WHEN** a `<TerminalView>` reaches `phase: 'ready'`
- **THEN** the broadcast step SHALL be skipped (no `new BroadcastChannel(...)` call)
- **AND** the iframe SHALL render normally
- **AND** no console error or warning is emitted by the broadcast code path

#### Scenario: Channel subscriber receives messages from same-origin popup window

- **GIVEN** tab `T1` (the manage page) subscribes to `BroadcastChannel('memon:terminal-attached')`
- **AND** tab `T1` opens a `window.open('/terminal-popup?...', target, features)` popup `T2`
- **WHEN** `T2`'s `<TerminalView>` reaches `ready` and broadcasts
- **THEN** `T1`'s subscriber SHALL receive the message
- **AND** the message's `source` field SHALL be `"popup"`

#### Scenario: onSessionReady callback continues to fire alongside the broadcast

- **GIVEN** a `<TerminalView ... onSessionReady={cb} />` mount where `cb` is provided
- **WHEN** the component reaches `phase: 'ready'`
- **THEN** `cb(sessionName)` SHALL be invoked exactly as today (the existing callback contract is unchanged)
- **AND** the broadcast SHALL ALSO fire — neither replaces the other

### Requirement: POST /api/terminal/attach attaches ttyd to an existing tmux session by name

The web backend SHALL expose `POST /api/terminal/attach` accepting body `{ sessionName: string }` where `sessionName` matches `^memon-[A-Za-z0-9._-]+$`. The endpoint SHALL spawn ttyd with the tmux argv `tmux new-session -A -s <sessionName>` (no `-c`, no agent CLI tail) and register a manager entry the same way `POST /api/terminal/start` does, returning the same response shape:

```ts
{ sessionName: string; url: string; port: number; startedAt: string; warnings: string[] }
```

The `-A` flag means "attach if exists, else create". When the named tmux session is already running on the host, the spawned ttyd attaches to it and the user sees whatever process / shell / scrollback was already there. When the session does NOT exist, tmux creates it as a fresh bare-shell session at memon's `process.cwd()` (consistent with the `POST /api/tmux-sessions` create dialog's fallback behavior).

The endpoint SHALL be idempotent on the manager-side: a second `POST /api/terminal/attach` for a sessionName whose manager entry is already healthy returns the existing `{ sessionName, url, port, startedAt }` without spawning a new ttyd. This matches the `POST /api/terminal/start` dedup.

The endpoint SHALL be auth-gated (HTTP Basic) and classified as a `shell` route under `auth-system`.

The endpoint SHALL share the manager's per-sessionName promise serializer with `POST /api/terminal/start` so concurrent calls for the same sessionName from EITHER endpoint produce a single ttyd entry.

#### Scenario: Attach to an existing tmux session
- **GIVEN** a tmux session `memon-manual-foo` exists on the host (created via the New session dialog or externally)
- **WHEN** an authenticated client `POST`s `{ sessionName: "memon-manual-foo" }` to `/api/terminal/attach`
- **THEN** ttyd is spawned with `tmux new-session -A -s memon-manual-foo` (no `-c`, no agent)
- **AND** the response is 200 with `{ sessionName: "memon-manual-foo", url: "/api/terminal/proxy/memon-manual-foo/", port: <int>, startedAt: <iso>, warnings: [] }`

#### Scenario: Attach idempotently returns existing manager entry
- **GIVEN** the manager already holds a healthy entry for `memon-manual-foo` on port 7685
- **WHEN** the user `POST`s `{ sessionName: "memon-manual-foo" }` to `/api/terminal/attach`
- **THEN** the response carries `port: 7685, startedAt: <original>` (no new ttyd is spawned)

#### Scenario: Concurrent start + attach on the same name don't double-spawn
- **WHEN** `POST /api/terminal/start` (which would resolve to sessionName `memon-claude-project-a--run--foo`) and `POST /api/terminal/attach { sessionName: "memon-claude-project-a--run--foo" }` fire simultaneously
- **THEN** the per-sessionName serializer ensures exactly one ttyd is spawned and both responses return the same `(sessionName, url, port, startedAt)`

#### Scenario: Invalid sessionName rejected
- **WHEN** the body is `{ sessionName: "not-memon" }` (does not start with `memon-`)
- **THEN** the response is 400 with code `BAD_REQUEST`
- **AND** no ttyd is spawned

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client `POST`s to `/api/terminal/attach`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

### Requirement: Terminal backends are independently enabled

The resolved terminal config SHALL expose `tmuxEnabled` and an optional Herdr
CLI alongside the existing ttyd tuning and tmux agent commands. Tmux SHALL
default to enabled when `terminal.tmux_enabled` is absent, preserving every
existing tmux terminal behavior. Herdr SHALL be enabled only when
`terminal.herdr` is present. A client with no enabled backend SHALL not issue
the ttyd availability probe for an Open-with control that will not render.

#### Scenario: Legacy config preserves tmux

- **GIVEN** a valid config written before this change with no `tmux_enabled` or `herdr` field
- **WHEN** it is loaded
- **THEN** `tmuxEnabled` is `true` and Herdr is disabled
- **AND** existing Terminal, Claude Code, Codex, and OpenCode behavior is unchanged

#### Scenario: Only Herdr is enabled

- **GIVEN** `terminal.tmux_enabled` is `false` and `terminal.herdr.cli` is configured
- **WHEN** the Open-with control renders
- **THEN** it offers Herdr and no tmux-backed agent choices
- **AND** its primary action opens Herdr even if local storage names a previous tmux agent

#### Scenario: Every backend disabled

- **GIVEN** `terminal.tmux_enabled` is `false` and `terminal.herdr` is absent
- **WHEN** a project, experiment, or run action bar renders
- **THEN** it renders no Open-with control and performs no ttyd probe

### Requirement: Shared ttyd manager supports tmux and Herdr entries

The ttyd manager SHALL apply the same loopback binding, authenticated proxy,
dynamic port allocation, per-key request serialization, LRU cap, idle TTL, and
process-exit cleanup to both backend kinds. Cleanup SHALL kill only the ttyd
client child; backend-owned durable processes SHALL remain alive.

#### Scenario: LRU evicts a Herdr ttyd client

- **GIVEN** the Herdr ttyd entry is the disconnected least-recently-used entry at the configured cap
- **WHEN** a new ttyd entry starts
- **THEN** the Herdr ttyd child is stopped
- **AND** no `herdr server stop` or tmux command is invoked

### Requirement: Open-with lists only enabled integrations

The unified Open-with picker SHALL preserve the existing tmux agent ordering
when tmux is enabled and append `Herdr` when Herdr is enabled. The stored
default MAY be either a tmux agent or Herdr; if it is no longer enabled, the
control SHALL select the first enabled backend deterministically. The popup
action SHALL open the currently selected backend.

#### Scenario: Both integrations enabled

- **GIVEN** tmux and Herdr are enabled
- **WHEN** the owner opens the picker
- **THEN** it lists `Terminal`, `Claude Code`, `Codex`, `OpenCode`, then `Herdr`, followed by the popup action
- **AND** all pre-existing tmux selections use their unchanged API and session naming

### Requirement: Terminal can be docked in a resizable right split

The terminal surface provider SHALL support a `split` presentation in addition to the overlay drawer and popup window. In split presentation, the existing page content SHALL remain interactive in a left region and the active terminal SHALL occupy the shared right-side workspace slot without an overlay or modal backdrop. The project AppBar, or the manage-page header, SHALL remain outside and above both regions so it spans the complete workspace width. A vertical divider SHALL resize the right region by pointer drag or keyboard, and its width SHALL persist independently from the drawer width.

The split SHALL preserve the page React subtree when opened or closed. Moving the terminal between drawer and split SHALL keep the same target state and SHALL reconnect only the browser client to the manager-deduplicated ttyd entry. The split header SHALL provide controls to move the target back to the drawer, pop it out, or close it. Terminal and Report content SHALL be mutually exclusive occupants of the shared right-side slot; replacing a visible terminal with a Report SHALL hide the browser client without stopping its backend session.

#### Scenario: Open target directly in split
- **GIVEN** a desktop viewport and an enabled terminal integration
- **WHEN** the owner selects `Open in split view`
- **THEN** the page content is visible on the left and the target's ttyd terminal is visible on the right below the shared header
- **AND** no modal overlay covers the page

#### Scenario: Split divider resizes both regions
- **GIVEN** the right split is open
- **WHEN** the user drags the divider to the left
- **THEN** the terminal becomes wider and the left page-content region becomes narrower
- **AND** the shared header and project sidebar are not divided or compressed by that divider
- **AND** both content regions remain within their minimum usable widths

#### Scenario: Split width is restored independently
- **GIVEN** the owner has chosen different widths for drawer and split presentations
- **WHEN** each presentation is reopened
- **THEN** each restores its own last committed width

#### Scenario: Move drawer to split without restarting backend process
- **GIVEN** a drawer is attached to a live ttyd entry
- **WHEN** the owner chooses `Split right`
- **THEN** the drawer closes and the same target appears in the right split below the shared header
- **AND** no new tmux session, Herdr workspace, or duplicate ttyd entry is created

#### Scenario: Report replaces visible terminal without stopping it
- **GIVEN** a terminal browser client occupies the right split
- **WHEN** a Report is opened in the shared right-side slot
- **THEN** the terminal client is hidden and the Report becomes visible
- **AND** the terminal backend remains available for later attachment

### Requirement: Unified Open With picker exposes split presentation

The shared project, experiment, and run Open With picker SHALL include an `Open in split view` action for the current default integration in addition to its integration choices and popup action. Selecting it SHALL use the same target identity and backend-specific setup as opening the default integration in the drawer.

#### Scenario: Open With launches current default in split
- **GIVEN** the owner's current default integration is Herdr for an experiment target
- **WHEN** the owner selects `Open in split view`
- **THEN** the Herdr target is created or focused using the experiment identity
- **AND** its ttyd client opens in the right split

#### Scenario: Existing main action remains a drawer action
- **WHEN** the owner clicks the main face of Open With
- **THEN** it continues to open the current default integration in the drawer

### Requirement: Embedded ttyd terminals support reliable text copying

Every shared `TerminalView` SHALL preserve ttyd/xterm's native auto-copy-on-selection behavior in tmux-backed and Herdr-backed sessions across drawer, right split, popup, and management surfaces. The ttyd iframe SHALL declare clipboard permission. Plain `Ctrl+C` SHALL remain terminal input, while `Ctrl+Shift+C` and `Cmd+C` SHALL copy the current selection again without forwarding the copy shortcut to the terminal process.

The view SHALL use xterm's native selection behavior and SHALL NOT expose a separate Copy mode. Ordinary drag SHALL select and auto-copy through ttyd when terminal mouse reporting is inactive. When a tmux or Herdr TUI enables mouse reporting, ordinary drag SHALL remain available to the TUI and xterm's standard `Shift+drag` gesture SHALL force local text selection that ttyd auto-copies on selection change.

#### Scenario: Copy shortcut does not interrupt the process
- **GIVEN** a ttyd terminal has a text selection
- **WHEN** the user presses `Ctrl+Shift+C` or `Cmd+C`
- **THEN** the selection is offered to the browser clipboard
- **AND** the shortcut is not forwarded to tmux, Herdr, or the foreground process

#### Scenario: Plain Ctrl+C remains terminal input
- **WHEN** the user presses plain `Ctrl+C`
- **THEN** the shared iframe bridge does not intercept it
- **AND** xterm can continue sending ETX to the foreground process

#### Scenario: Native Shift-drag selects from a mouse-reporting TUI
- **GIVEN** tmux or Herdr has enabled terminal mouse reporting
- **WHEN** the user holds Shift and drags with the primary mouse button
- **THEN** xterm performs its native forced text selection
- **AND** ttyd automatically copies the resulting selection without requiring another shortcut
- **AND** no memon-specific mouse mode is required

#### Scenario: Ordinary TUI mouse input remains unchanged
- **GIVEN** terminal mouse reporting is active
- **WHEN** the user drags without Shift
- **THEN** the event remains available to the TUI
- **AND** memon does not transform or intercept the mouse event

#### Scenario: Clipboard capability applies to every backend and surface
- **WHEN** any standard, raw tmux-attach, or Herdr `TerminalView` renders in drawer, split, popup, or management presentation
- **THEN** its ttyd iframe declares clipboard read/write permission
- **AND** the same native xterm selection and copy shortcut behavior is available

### Requirement: Central terminal targets are Host-qualified
In central mode, terminal check/install/start/attach/list/stop, drawer/split/popup state, and proxy URLs SHALL identify one Host plus terminal target/session. Standalone behavior SHALL retain its existing local target shape.

#### Scenario: Drawer navigation preserves Host
- **WHEN** a terminal drawer is open for Host A and page navigation changes
- **THEN** it remains attached only to Host A unless the user explicitly opens another target

### Requirement: Central and Backend relay both ttyd HTTP and WebSocket
Central SHALL relay authenticated Host-qualified terminal HTTP and WebSocket traffic to the selected Backend's static relay. Backend SHALL resolve the opaque route to its local ttyd loopback port and perform the final hop. The browser SHALL never learn or address that dynamic port.

#### Scenario: Browser terminal works through public central endpoint
- **WHEN** an owner starts and opens a remote ttyd terminal
- **THEN** its assets and interactive WebSocket traverse central and Backend relays with working bidirectional I/O

### Requirement: Terminal credentials stop at their boundary
Central SHALL reject viewer terminal access, remove browser auth before the Backend hop, and inject only the Host's service token and trusted owner context. Backend SHALL reject browser cookies/Basic auth and a token for any other Host.

#### Scenario: Browser Authorization is not forwarded
- **WHEN** an owner uses HTTP Basic at central to open a terminal
- **THEN** the Basic header is consumed by central and the Backend sees only service authentication

### Requirement: Remote relay preserves ttyd semantics and cleanup
The two-hop relay SHALL preserve binary frames, allowed subprotocol, base-path asset resolution, backpressure, close propagation, copy/mouse behavior, and the existing manager's LRU/TTL/lifecycle semantics. Removed routes SHALL fail without retargeting.

#### Scenario: Idle eviction closes the exact remote route
- **WHEN** Backend evicts an idle ttyd entry
- **THEN** central can no longer attach that `{host, route}` and no other Host route is affected
