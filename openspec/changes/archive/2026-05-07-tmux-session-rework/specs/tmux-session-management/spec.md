## ADDED Requirements

### Requirement: tmux session inventory page at /manage/tmux

The dashboard SHALL render a page at `/manage/tmux` that lists every tmux session on the host whose name starts with `memon-`. The page SHALL be top-level (NOT scoped under `/p/<project>/`) so it can show sessions across all configured projects, plus sessions whose `<project>` cannot be matched in the current config.

The page SHALL fetch the session list from `GET /api/tmux-sessions` (defined below). The list SHALL be auto-refreshed every 5 seconds while the page is visible, with a manual refresh button to force an immediate refetch.

Each row SHALL display:
- The full tmux session name.
- The parsed `(agent, scope, project, slug)` derived from the session name.
- The bound ttyd port if the manager currently holds a live entry for this sessionName, otherwise an em-dash `—`.
- The session's `last activity` (parsed from `tmux ls`'s `#{session_activity}`).
- A **Target** cell that is EITHER:
  - A clickable link with arrow icon to `/p/<project>/r/<slug>` (for `scope: 'run'`) or `/p/<project>/e/<slug>` (for `scope: 'exp'`) when the row's `(project, slug)` matches a configured project AND a real on-disk run dir / exp doc, OR
  - An inline `⚠ stale (<reason>)` indicator when the row cannot be matched. Reasons include `unknown-project`, `unknown-target`, `old-format`, `unparseable`.
- Action buttons: `Open in drawer`, `Open in popup`, `Kill`. The `Open in popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint.

The page SHALL provide three filter tabs: `All`, `Active in memon`, `Stale`. The default filter is `All`. `Active in memon` shows only rows where the manager has a live ttyd entry. `Stale` shows only rows whose Target cell is the stale indicator.

#### Scenario: Page lists sessions across projects
- **GIVEN** the host has tmux sessions `memon-claude-project-a--run--foo-...`, `memon-codex-project-b--exp--E0001-bar`, and `memon-claude-archived-proj--run--baz-...` (where `archived-proj` is not in the current `config.yml`)
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** all three rows appear by default (filter `All`)
- **AND** the first two have a clickable Target link
- **AND** the third has `⚠ stale (unknown-project)` and ttyd port `—` if no live entry

#### Scenario: Filter tabs narrow the list
- **GIVEN** there are 5 total `memon-*` sessions, 2 of which have live ttyd entries, 1 of which is stale
- **WHEN** the user clicks the `Active in memon` tab
- **THEN** only the 2 rows with live entries are visible
- **WHEN** the user clicks `Stale`
- **THEN** only the 1 stale row is visible

#### Scenario: Open in drawer works for stale rows too
- **WHEN** the user clicks `Open in drawer` on a row whose Target is stale
- **THEN** the drawer opens (because `TerminalDrawerProvider` is mounted at root, reachable from `/manage/tmux`)
- **AND** the iframe loads the corresponding ttyd; the user can see and interact with the tmux session contents

#### Scenario: Open in popup hidden on mobile
- **GIVEN** the viewport width is below the Tailwind `md` breakpoint
- **WHEN** the page renders
- **THEN** every row's `Open in popup` button has class `hidden md:inline-flex` (not visible)

#### Scenario: Kill removes the session
- **GIVEN** a row for sessionName `memon-claude-project-a--run--foo-...`
- **WHEN** the user clicks `Kill` and confirms
- **THEN** `DELETE /api/tmux-sessions/memon-claude-project-a--run--foo-...` fires
- **AND** on success the row disappears (next refetch / immediate invalidation)
- **AND** the host no longer has the tmux session (`tmux has-session -t <name>` exits non-zero)

### Requirement: GET /api/tmux-sessions enumerates all memon-prefix tmux sessions

The web backend SHALL expose `GET /api/tmux-sessions` returning `{ sessions: TmuxSessionRow[] }` where each row has shape:

```ts
{
  sessionName: string
  parsed: {
    agent: 'terminal' | 'claude' | 'codex' | 'opencode' | null
    project: string | null
    scope: 'exp' | 'run' | null
    slug: string | null
    legacy: boolean   // true when the name matches the old format
  }
  liveEntry: { port: number; lastActiveAt: string } | null
  tmuxCreatedAt: string
  tmuxLastActivity: string
  matchable: boolean
  staleReason: 'unknown-project' | 'unknown-target' | 'old-format' | 'unparseable' | null
}
```

The endpoint SHALL implement the following:
1. Run `tmux ls -F "#{session_name}|#{session_created}|#{session_activity}"` and parse each line.
2. Filter to lines whose session_name starts with `memon-`.
3. For each filtered line: parse the name (per `browser-terminal` Session-name format), look up `liveEntry` from the terminal manager's session map, and classify `matchable` / `staleReason` against `runtime.config.projects` and the existing run / exp indexes.
4. Sort the response by `tmuxLastActivity` descending.

The endpoint SHALL be auth-gated (HTTP Basic) and SHALL be classified as a `read` route under `auth-system`.

#### Scenario: Empty when host has no memon sessions
- **GIVEN** `tmux ls` returns no sessions starting with `memon-`
- **WHEN** the endpoint is called
- **THEN** the response is `{ sessions: [] }`

#### Scenario: Mixed matchable and stale rows
- **GIVEN** the host has 3 `memon-*` sessions: 2 matchable, 1 stale
- **WHEN** the endpoint is called
- **THEN** all 3 rows are returned
- **AND** the matchable rows have `matchable: true, staleReason: null`
- **AND** the stale row has `matchable: false` with a non-null `staleReason`

#### Scenario: Live entry surfaces port
- **GIVEN** the manager holds a live entry for sessionName `<X>` on port 7683
- **WHEN** the endpoint returns the row for `<X>`
- **THEN** `liveEntry: { port: 7683, lastActiveAt: <iso> }`

#### Scenario: tmux not running
- **WHEN** `tmux ls` exits with code != 0 because the tmux daemon hasn't started yet
- **THEN** the endpoint SHALL return `{ sessions: [] }` (graceful — no daemon means no sessions)

### Requirement: DELETE /api/tmux-sessions/:name kills a tmux session

The web backend SHALL expose `DELETE /api/tmux-sessions/:name` that runs `tmux kill-session -t <name>` after URL-decoding `:name`. On success it SHALL also remove the corresponding entry from the terminal manager's session map (the ttyd child will exit naturally because its tmux client process exits when the session ends, but the manager SHALL also send SIGTERM to ensure prompt cleanup).

The `:name` SHALL be validated against the session-name format (new or legacy) before invoking `tmux kill-session`. Names that don't match either format SHALL be rejected with 400.

The endpoint SHALL be auth-gated (HTTP Basic) and SHALL be classified as a `shell` route under `auth-system` (it executes a process).

#### Scenario: Kill removes session and live entry
- **GIVEN** a tmux session `memon-claude-project-a--run--foo-...` exists AND the manager holds a live entry for it
- **WHEN** an authenticated client `DELETE`s `/api/tmux-sessions/memon-claude-project-a--run--foo-...`
- **THEN** `tmux kill-session -t memon-claude-project-a--run--foo-...` runs successfully
- **AND** the manager's entry for that sessionName is removed
- **AND** the response is 200 with `{ ok: true }`

#### Scenario: Kill nonexistent session
- **GIVEN** a sessionName not on the host
- **WHEN** the user `DELETE`s that name
- **THEN** the response is 404 with `{ error: { code: 'NOT_FOUND', message } }`

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client `DELETE`s `/api/tmux-sessions/<name>`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** no `tmux kill-session` is run

#### Scenario: Malformed name rejected
- **WHEN** the user `DELETE`s `/api/tmux-sessions/not-a-memon-prefix`
- **THEN** the response is 400 (the name doesn't start with `memon-`)
- **AND** no `tmux kill-session` is run

### Requirement: Stale classification cross-references the project, run, and exp indexes

A row SHALL be classified `matchable` if and only if all of the following hold:
1. The session name parses into the new format `memon-<agent>-<project>--<scope>--<slug>`.
2. `<project>` matches the `name` of some entry in `runtime.config.projects`.
3. For `<scope> = run`: the matched project's run index has a run dir whose basename equals `<slug>`.
4. For `<scope> = exp`: the matched project's exp index has an exp doc with id equal to `<slug>`.

Otherwise the row SHALL be classified `stale` with one of the following `staleReason` values:
- `unparseable` — condition 1 fails AND the name doesn't match the legacy format either.
- `old-format` — the name matches the legacy `memon-<agent>-<runId>` format.
- `unknown-project` — condition 2 fails.
- `unknown-target` — condition 2 holds but 3 or 4 fails.

Stale classification SHALL NOT prevent the kill / open actions from working — it affects only the Target column display.

#### Scenario: Removed project marks rows stale
- **GIVEN** the host has session `memon-claude-old-proj--run--foo-...` AND `old-proj` is not in `runtime.config.projects`
- **THEN** the row's `staleReason` is `unknown-project`
- **AND** the Target cell renders `⚠ stale (unknown-project)`

#### Scenario: Old session for archived run
- **GIVEN** the host has session `memon-claude-project-a--run--archived-...` AND `project-a` is configured but no run dir with basename `archived-...` exists
- **THEN** the row's `staleReason` is `unknown-target`

#### Scenario: Legacy-format name
- **GIVEN** the host has session `memon-claude-foo-260507-103000` (no `--`, pre-tmux-session-rework)
- **THEN** the row's `staleReason` is `old-format`
