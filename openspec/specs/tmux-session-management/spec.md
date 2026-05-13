# tmux-session-management Specification

## Purpose

Machine-level inventory and lifecycle UI for `memon-*` tmux sessions on
the host. Enumerates every memon-prefixed tmux session across all
configured projects (plus orphans whose project is no longer in the
config), classifies each as matchable or stale, and lets the user open
a session in the drawer / popup or kill it explicitly. This is the only
UI path that ends a tmux session — drawer close and `memon serve`
restart leave tmux alive.

## Requirements

### Requirement: tmux session inventory page at /manage/tmux

The dashboard SHALL render a page at `/manage/tmux` that lists every tmux session on the host whose name starts with `memon-`. The page SHALL be top-level (NOT scoped under `/p/<project>/`) so it can show sessions across all configured projects, plus sessions whose `<project>` cannot be matched in the current config.

The page SHALL fetch the session list from `GET /api/tmux-sessions` (defined below). The list SHALL be auto-refreshed every 5 seconds while the page is visible, with a manual refresh button to force an immediate refetch.

The page SHALL also expose a `New session` button at the top that opens a Dialog with a text input for the session name. Submitting the dialog SHALL `POST /api/tmux-sessions { name }` and, on success, invalidate the list query so the row appears immediately. A toast SHALL communicate the outcome ("created `memon-manual-<name>`" vs "joined existing `memon-manual-<name>`" based on `alreadyExisted`).

Each row SHALL display:
- The full tmux session name.
- The parsed `(agent, scope, project, slug)` derived from the session name.
- The bound ttyd port if the manager currently holds a live entry for this sessionName, otherwise an em-dash `—`.
- The session's `last activity` (parsed from `tmux ls`'s `#{session_activity}`).
- A **Target** cell that is one of THREE forms:
  - A clickable link with arrow icon to:
    - `/p/<project>/r/<slug>` for `scope: 'run'`,
    - `/p/<project>/e/<slug>` for `scope: 'exp'`, or
    - `/p/<project>` for `scope: 'project'` (slug is always `'root'` and is not embedded in the link)
    when the row is matchable (parses to the standard format AND project + run/exp resolved on disk; project-scope rows require only project-in-config).
  - An inline `⚠ stale (<reason>)` indicator when the row parses to the standard format but the project or target lookup failed. Reasons are `unknown-project` or `unknown-target`. Project-scope rows can only ever be `unknown-project` (slug `root` is always valid by contract).
  - An em-dash `—` when the row does NOT parse to the standard format (legacy `memon-<agent>-<runId>` or arbitrary user-created names like `memon-manual-foo`). These are the **manual** category — neither matchable nor stale.
- Action buttons that depend on matchability:
  - **Matchable** rows render `Open in drawer`, `Open in popup`, `Kill`. The `Open in popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint.
  - **Stale and Manual** rows render only `Kill`. `Open in drawer` and `Open in popup` SHALL be omitted (not rendered) since both lack a parsed `(agent, project, scope, slug)` to construct a startTerminal call.

The page SHALL provide three filter tabs: `All`, `Active in memon`, `Stale`. The default filter is `All`. `Active in memon` shows only rows where the manager has a live ttyd entry. `Stale` shows only rows whose `staleReason` is non-null (manual rows do NOT appear under the `Stale` tab).

#### Scenario: Page lists sessions across projects
- **GIVEN** the host has tmux sessions `memon-claude-project-a--run--foo-...`, `memon-codex-project-b--exp--E0001-bar`, and `memon-claude-archived-proj--run--baz-...` (where `archived-proj` is not in the current `config.yml`)
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** all three rows appear by default (filter `All`)
- **AND** the first two have a clickable Target link
- **AND** the third has `⚠ stale (unknown-project)` and ttyd port `—` if no live entry

#### Scenario: Project-scope row links to project overview
- **GIVEN** the host has session `memon-claude-project-a--project--root` and `project-a` is in config
- **WHEN** the page lists rows
- **THEN** the Target cell renders a clickable link with arrow icon pointing to `/p/project-a`
- **AND** the row is `matchable` so `Open in drawer`, `Open in popup`, `Kill` all render

#### Scenario: Project-scope row with unknown project is stale
- **GIVEN** the host has session `memon-claude-archived-proj--project--root` and `archived-proj` is NOT in config
- **WHEN** the page lists rows
- **THEN** the Target cell renders `⚠ stale (unknown-project)`
- **AND** the row's actions cell contains exactly one button: `Kill`

#### Scenario: Manual rows render with em-dash Target
- **GIVEN** the host has session `memon-manual-foo` (created via the new dialog)
- **WHEN** the page lists rows
- **THEN** the Target cell for that row renders `—` (no `⚠ stale`)
- **AND** the row's actions cell contains exactly one button: `Kill`

#### Scenario: Legacy-format rows render as Manual, not Stale
- **GIVEN** the host has session `memon-claude-foo-260507-103000` (legacy pre-tmux-session-rework format, no `--`)
- **WHEN** the page lists rows
- **THEN** the Target cell renders `—`, NOT `⚠ stale (old-format)`
- **AND** the row does NOT appear under the `Stale` filter tab

#### Scenario: Filter tabs narrow the list
- **GIVEN** there are 5 total `memon-*` sessions, 2 of which have live ttyd entries, 1 of which is stale
- **WHEN** the user clicks the `Active in memon` tab
- **THEN** only the 2 rows with live entries are visible
- **WHEN** the user clicks `Stale`
- **THEN** only the 1 stale row is visible (manual rows excluded)

#### Scenario: Stale rows show only Kill
- **GIVEN** a stale row in the table (`staleReason` is `unknown-project` or `unknown-target`)
- **WHEN** the row is rendered
- **THEN** the actions cell contains exactly one button: `Kill`
- **AND** no `Open in drawer` or `Open in popup` button is present in the DOM for that row

#### Scenario: Matchable rows show all three actions
- **GIVEN** a matchable row in the table (the parsed name resolves to a real project + run/exp/project)
- **WHEN** the row is rendered
- **THEN** the actions cell contains `Open in drawer`, `Open in popup`, and `Kill`

#### Scenario: Open in popup hidden on mobile
- **GIVEN** the viewport width is below the Tailwind `md` breakpoint
- **WHEN** the page renders
- **THEN** every matchable row's `Open in popup` button has class `hidden md:inline-flex` (not visible)

#### Scenario: Kill removes the session
- **GIVEN** a row for sessionName `memon-claude-project-a--run--foo-...`
- **WHEN** the user clicks `Kill` and confirms
- **THEN** `DELETE /api/tmux-sessions/memon-claude-project-a--run--foo-...` fires
- **AND** on success the row disappears (next refetch / immediate invalidation)
- **AND** the host no longer has the tmux session (`tmux has-session -t <name>` exits non-zero)

#### Scenario: New session button creates a manual session
- **WHEN** the user clicks `New session`, types `foo` in the dialog, and submits
- **THEN** `POST /api/tmux-sessions { name: "foo" }` fires
- **AND** on 200 response, the dialog closes and the list refetches showing the new `memon-manual-foo` row in the manual category

### Requirement: POST /api/tmux-sessions creates a new manual tmux session

The web backend SHALL expose `POST /api/tmux-sessions` with body `{ name: string }` that creates (or attaches to) a tmux session named `memon-manual-<name>` with `cwd = process.cwd()` of the running `memon serve` process.

The `name` field SHALL be validated:
- non-empty,
- matches `^[A-Za-z0-9._-]+$`,
- does NOT contain the substring `--` (reserved scope delimiter),
- does NOT start with the substring `memon-` (avoid double-prefix names).

The endpoint SHALL run `tmux new-session -A -d -s memon-manual-<name> -c <cwd>` (idempotent: `-A` attach-if-exists, `-d` detached). To distinguish "already existed" from "freshly created" for the response and downstream toast, the endpoint SHALL run `tmux has-session -t memon-manual-<name>` BEFORE the create call and use the boolean result as `alreadyExisted`.

Response shape:
- 200: `{ ok: true, sessionName: "memon-manual-<name>", alreadyExisted: boolean }`
- 400: `{ error: { code: "BAD_REQUEST", message } }` for validation failures
- 500: `{ error: { message } }` for tmux exec failures

The endpoint SHALL be auth-gated (HTTP Basic) and classified as a `shell` route under `auth-system`.

#### Scenario: Create a new manual session
- **GIVEN** no tmux session named `memon-manual-foo` exists on the host
- **WHEN** an authenticated client `POST`s `{ name: "foo" }` to `/api/tmux-sessions`
- **THEN** `tmux new-session -A -d -s memon-manual-foo -c <process.cwd()>` runs and exits 0
- **AND** the response is 200 with `{ ok: true, sessionName: "memon-manual-foo", alreadyExisted: false }`

#### Scenario: Idempotent on existing name
- **GIVEN** a tmux session named `memon-manual-foo` already exists
- **WHEN** an authenticated client `POST`s `{ name: "foo" }`
- **THEN** the response is 200 with `{ ok: true, sessionName: "memon-manual-foo", alreadyExisted: true }`
- **AND** no error from `tmux new-session` (the `-A` flag absorbs the conflict)

#### Scenario: Empty name rejected
- **WHEN** the body is `{ name: "" }`
- **THEN** the response is 400 with code `BAD_REQUEST`

#### Scenario: Name with double-hyphen rejected
- **WHEN** the body is `{ name: "foo--bar" }`
- **THEN** the response is 400 with a message mentioning `--`

#### Scenario: Name starting with memon- rejected
- **WHEN** the body is `{ name: "memon-claude" }`
- **THEN** the response is 400 with a message mentioning the `memon-` prefix collision

#### Scenario: Name with disallowed character rejected
- **WHEN** the body is `{ name: "foo bar" }` (space)
- **THEN** the response is 400

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client `POST`s to `/api/tmux-sessions`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** no `tmux new-session` is run

### Requirement: GET /api/tmux-sessions enumerates all memon-prefix tmux sessions

The web backend SHALL expose `GET /api/tmux-sessions` returning `{ sessions: TmuxSessionRow[] }` where each row has shape:

```ts
{
  sessionName: string
  parsed: {
    agent: 'terminal' | 'claude' | 'codex' | 'opencode' | null
    project: string | null
    scope: 'exp' | 'run' | 'project' | null
    slug: string | null
    legacy: boolean   // true when the name matches the old format
  }
  liveEntry: { port: number; lastActiveAt: string } | null
  tmuxCreatedAt: string
  tmuxLastActivity: string
  matchable: boolean
  staleReason: 'unknown-project' | 'unknown-target' | null
}
```

The endpoint SHALL implement the following:
1. Run `tmux ls -F "#{session_name}|#{session_created}|#{session_activity}"` and parse each line.
2. Filter to lines whose session_name starts with `memon-`.
3. For each filtered line: parse the name (per `browser-terminal` Session-name format), look up `liveEntry` from the terminal manager's session map, and classify `matchable` / `staleReason`.
4. Sort the response by `tmuxLastActivity` descending.

For `scope: 'project'` rows, `matchable` is `true` IFF the parsed `project` resolves in the current config; the slug is `'root'` by contract and is not validated against an on-disk artefact. `staleReason` for project-scope rows is `'unknown-project'` or `null` — `'unknown-target'` never applies.

#### Scenario: Project-scope row classifies on project lookup only
- **GIVEN** the host has session `memon-claude-project-a--project--root` and `project-a` is in config
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row has `parsed.scope === 'project'`, `parsed.slug === 'root'`, `matchable === true`, and `staleReason === null`

#### Scenario: Project-scope row with unknown project is unknown-project stale
- **GIVEN** the host has session `memon-claude-archived-proj--project--root` and `archived-proj` is NOT in config
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row has `matchable === false` and `staleReason === 'unknown-project'`

#### Scenario: Empty when host has no memon sessions
- **GIVEN** `tmux ls` returns no sessions starting with `memon-`
- **WHEN** the endpoint is called
- **THEN** the response is `{ sessions: [] }`

#### Scenario: Mixed matchable, stale, and manual rows
- **GIVEN** the host has 4 `memon-*` sessions: 2 matchable, 1 stale (unknown-project), 1 manual (`memon-manual-foo`)
- **WHEN** the endpoint is called
- **THEN** all 4 rows are returned
- **AND** the 2 matchable rows have `matchable: true, staleReason: null`
- **AND** the stale row has `matchable: false, staleReason: 'unknown-project'`
- **AND** the manual row has `matchable: false, staleReason: null`

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

When condition 1 fails (legacy `memon-<agent>-<runId>` or arbitrary `memon-<...>`), the row SHALL be classified as **manual** (`matchable: false, staleReason: null`). The classifier SHALL NOT emit `staleReason: 'old-format'` or `staleReason: 'unparseable'` — those values are removed from the enum.

When condition 1 holds but 2 or 3 or 4 fails, the row SHALL be classified as **stale** with one of:
- `unknown-project` — condition 2 fails.
- `unknown-target` — condition 2 holds but 3 or 4 fails.

Stale classification SHALL NOT prevent the `Kill` action from working — `Kill` remains available on every row regardless of matchability. Manual classification SHALL NOT prevent `Kill` either. `Open in drawer` and `Open in popup` are intentionally NOT exposed on stale or manual rows because both lack a parsed target to construct a startTerminal call.

#### Scenario: Removed project marks rows stale
- **GIVEN** the host has session `memon-claude-old-proj--run--foo-...` AND `old-proj` is not in `runtime.config.projects`
- **THEN** the row's `staleReason` is `unknown-project`
- **AND** the Target cell renders `⚠ stale (unknown-project)`

#### Scenario: Old session for archived run
- **GIVEN** the host has session `memon-claude-project-a--run--archived-...` AND `project-a` is configured but no run dir with basename `archived-...` exists
- **THEN** the row's `staleReason` is `unknown-target`

#### Scenario: Legacy-format name is manual, not stale
- **GIVEN** the host has session `memon-claude-foo-260507-103000` (no `--`, pre-tmux-session-rework)
- **THEN** the row has `matchable: false, staleReason: null` (manual)
- **AND** the Target cell renders `—`, NOT `⚠ stale`

#### Scenario: Arbitrary manual name is manual, not stale
- **GIVEN** the host has session `memon-manual-foo`
- **THEN** the row has `matchable: false, staleReason: null` (manual)
- **AND** the Target cell renders `—`

#### Scenario: Kill works on a stale row
- **GIVEN** a stale row (`staleReason` non-null)
- **WHEN** the user clicks `Kill` and confirms
- **THEN** `DELETE /api/tmux-sessions/<name>` fires and on success the row disappears

#### Scenario: Kill works on a manual row
- **GIVEN** a manual row (`staleReason: null`, not matchable)
- **WHEN** the user clicks `Kill` and confirms
- **THEN** `DELETE /api/tmux-sessions/<name>` fires and on success the row disappears
