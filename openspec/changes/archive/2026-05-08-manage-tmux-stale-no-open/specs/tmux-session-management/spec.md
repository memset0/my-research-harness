## MODIFIED Requirements

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
- Action buttons that depend on matchability:
  - **Matchable** rows render `Open in drawer`, `Open in popup`, `Kill`. The `Open in popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint.
  - **Stale** rows render only `Kill`. `Open in drawer` and `Open in popup` SHALL be omitted (not rendered) since opening an unmatched session loads ttyd against a fallback cwd and confuses the UI more than it helps.

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

#### Scenario: Stale rows show only Kill
- **GIVEN** a stale row in the table (any `staleReason`)
- **WHEN** the row is rendered
- **THEN** the actions cell contains exactly one button: `Kill`
- **AND** no `Open in drawer` or `Open in popup` button is present in the DOM for that row

#### Scenario: Matchable rows show all three actions
- **GIVEN** a matchable row in the table (the parsed name resolves to a real project + run/exp)
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

Stale classification SHALL NOT prevent the `Kill` action from working — `Kill` remains available on every row regardless of matchability. `Open in drawer` and `Open in popup` are intentionally NOT exposed on stale rows (per the row-actions requirement above) because opening a stale session loads ttyd against an unmatched project and confuses the UI more than it helps.

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

#### Scenario: Kill works on a stale row
- **GIVEN** a stale row (any reason)
- **WHEN** the user clicks `Kill` and confirms
- **THEN** `DELETE /api/tmux-sessions/<name>` fires and on success the row disappears
