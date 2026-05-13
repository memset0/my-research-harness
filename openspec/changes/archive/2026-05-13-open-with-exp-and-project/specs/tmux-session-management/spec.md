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
