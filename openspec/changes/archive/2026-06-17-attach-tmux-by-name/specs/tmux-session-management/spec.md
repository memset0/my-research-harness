## MODIFIED Requirements

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
  - A clickable link with arrow icon to `/p/<project>/r/<slug>` (for `scope: 'run'`) or `/p/<project>/e/<slug>` (for `scope: 'exp'`) when the row is matchable (parses to the standard format AND project + run/exp resolved on disk).
  - An inline `⚠ stale (<reason>)` indicator when the row parses to the standard format but the project or target lookup failed. Reasons are `unknown-project` or `unknown-target`.
  - An em-dash `—` when the row does NOT parse to the standard format (legacy `memon-<agent>-<runId>` or arbitrary user-created names like `memon-manual-foo`). These are the **manual** category — neither matchable nor stale.
- Action buttons that depend on row classification:
  - **Matchable** rows render `Open in drawer`, `Open in popup`, `Kill`. The drawer + popup use the **standard** path (parsed `(project, scope, slug, agent)` → `POST /api/terminal/start`). The `Open in popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint.
  - **Manual** rows render `Open in drawer`, `Open in popup`, `Kill`. The drawer + popup use the **raw-attach** path (just `sessionName` → `POST /api/terminal/attach`, per the `browser-terminal` capability). The `Open in popup` button SHALL be hidden on the mobile breakpoint, same as for matchable rows.
  - **Stale** rows render only `Kill`. `Open in drawer` and `Open in popup` SHALL be omitted (not rendered) — opening a stale session would surface a confusing "project not in config" warning since the parse succeeded but the lookup failed.

The page SHALL provide three filter tabs: `All`, `Active in memon`, `Stale`. The default filter is `All`. `Active in memon` shows only rows where the manager has a live ttyd entry. `Stale` shows only rows whose `staleReason` is non-null (manual rows do NOT appear under the `Stale` tab).

#### Scenario: Page lists sessions across projects
- **GIVEN** the host has tmux sessions `memon-claude-project-a--run--foo-...`, `memon-codex-project-b--exp--E0001-bar`, and `memon-claude-archived-proj--run--baz-...` (where `archived-proj` is not in the current `config.yml`)
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** all three rows appear by default (filter `All`)
- **AND** the first two have a clickable Target link
- **AND** the third has `⚠ stale (unknown-project)` and ttyd port `—` if no live entry

#### Scenario: Manual rows render with em-dash Target
- **GIVEN** the host has session `memon-manual-foo` (created via the new dialog)
- **WHEN** the page lists rows
- **THEN** the Target cell for that row renders `—` (no `⚠ stale`)

#### Scenario: Manual rows render Drawer + Popup + Kill actions
- **GIVEN** a manual row (e.g., `memon-manual-foo` or a legacy `memon-claude-foo-260507-103000`)
- **WHEN** the row is rendered
- **THEN** the actions cell contains `Open in drawer`, `Open in popup`, and `Kill`
- **AND** clicking `Open in drawer` calls the drawer provider's `openRaw({ sessionName })` (NOT the standard `open(...)`)
- **AND** clicking `Open in popup` opens `/terminal-popup?sessionName=<row.sessionName>` (raw query shape)

#### Scenario: Legacy-format rows render as Manual, not Stale
- **GIVEN** the host has session `memon-claude-foo-260507-103000` (legacy pre-tmux-session-rework format, no `--`)
- **WHEN** the page lists rows
- **THEN** the Target cell renders `—`, NOT `⚠ stale (old-format)`
- **AND** the row does NOT appear under the `Stale` filter tab
- **AND** the actions cell renders Drawer + Popup + Kill (per the manual-row rule above)

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
- **GIVEN** a matchable row in the table (the parsed name resolves to a real project + run/exp)
- **WHEN** the row is rendered
- **THEN** the actions cell contains `Open in drawer`, `Open in popup`, and `Kill`
- **AND** clicking `Open in drawer` calls the drawer provider's standard `open({ project, scope, slug, agent })`

#### Scenario: Open in popup hidden on mobile
- **GIVEN** the viewport width is below the Tailwind `md` breakpoint
- **WHEN** the page renders
- **THEN** every row's `Open in popup` button has class `hidden md:inline-flex` (not visible) — applies to both matchable and manual rows

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
