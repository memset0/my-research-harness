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
