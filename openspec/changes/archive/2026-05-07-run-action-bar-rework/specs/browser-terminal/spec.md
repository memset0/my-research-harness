## MODIFIED Requirements

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

## ADDED Requirements

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
