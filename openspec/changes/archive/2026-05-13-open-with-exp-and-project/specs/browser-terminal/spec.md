## MODIFIED Requirements

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
