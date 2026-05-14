## MODIFIED Requirements

### Requirement: tmux session inventory page at /manage/tmux

The dashboard SHALL render a page at `/manage/tmux` that lists every tmux session on the host whose name starts with `memon-`. The page SHALL be top-level (NOT scoped under `/p/<project>/`) so it can show sessions across all configured projects, plus sessions whose `<project>` cannot be matched in the current config.

The page SHALL fetch the session list from `GET /api/tmux-sessions`. The list SHALL be auto-refreshed every 5 seconds while the page is visible, with a manual refresh button to force an immediate refetch. Auto-refetch SHALL update per-row content (live ttyd port, last-activity timestamp, status badges, footer state tint) but SHALL NOT reorder the list — see the **Stable client-side ordering** requirement.

The page SHALL expose a `New session` button at the top of the left pane that opens a Dialog with a text input for the session name. Submitting the dialog SHALL `POST /api/tmux-sessions { name }` and, on success, invalidate the list query so the row appears immediately. A toast SHALL communicate the outcome ("created `memon-manual-<name>`" vs "joined existing `memon-manual-<name>`" based on `alreadyExisted`).

The page SHALL render as a two-pane resizable layout (not a table):
- A **left pane** containing the session list and the header controls (filter tabs, `New session`, `Refresh`).
- A **right pane** showing the inline terminal for the currently-selected session, or an empty-state placeholder when none is selected.
- A draggable **divider** between the panes. The user SHALL be able to resize the split by mouse drag, touch drag, or keyboard (arrow keys when the handle is focused), per the underlying `react-resizable-panels` primitive.

On viewports `>= 768px` (the Tailwind `md` breakpoint) the panel orientation SHALL be horizontal (list left, terminal right). On viewports `< 768px` the orientation SHALL be vertical (list top, terminal bottom). The same `ResizablePanelGroup` SHALL be reused with `direction` switched based on the viewport; no separate component tree per orientation.

The list pane SHALL provide three filter tabs: `All`, `Active in memon`, `Stale`. The default filter is `All`. `Active in memon` shows only rows where the manager has a live ttyd entry. `Stale` shows only rows whose `staleReason` is non-null (manual rows do NOT appear under the `Stale` tab).

Each row SHALL render as a clickable card (NOT a table cell). The card SHALL be split into two visually distinct zones — a **content** zone above and an optional **footer** zone below — separated by a thin horizontal border (`border-t border-border/40`) that extends to the card's left and right padded edges. The footer zone is described in the separate `/manage/tmux cards render a pane info line under the badge row` requirement; the content zone is described here.

The **content** zone SHALL contain:

- **Row 1 — Title + time + actions** (a single horizontal `flex` row, items vertically centered):
  - A **title** that is the session name with the universal `memon-` prefix stripped AND any of `manual-` / `project-` / `exp-` / `run-` stripped if present immediately after `memon-`. Examples:
    - `memon-manual-foo` renders as title `foo`.
    - `memon-claude-project-a--run--foo-260507-103000` renders as title `claude-project-a--run--foo-260507-103000`.
    - `memon-claude-foo-260507-103000` (legacy format) renders as title `claude-foo-260507-103000`.
    - The title SHALL render in `font-mono text-[11px] font-semibold` with `min-w-0 flex-1 truncate` so it fills available width and truncates with ellipsis. The semibold weight differentiates the title from the surrounding regular-weight content + ellipsis-truncated badge values.
  - A **last activity** label (relative time, e.g. `5m ago`). The timestamp the label renders is the more recent of `row.tmuxLastActivity` and `row.lastStateChangeAt` — so a state transition (running ↔ idle ↔ attention ↔ done) refreshes the displayed clock back to "just now" alongside tmux's own input/output activity. The label SHALL be `text-[10px] text-muted-foreground` in the default sans-serif font (NOT monospace — relative-time strings like `5m ago` are prose, not code, and the sans rendering reads more naturally next to the title and buttons). It SHALL render when EITHER timestamp is parseable; when BOTH are absent/unparseable, the label is omitted entirely. It sits to the IMMEDIATE LEFT of the action buttons on row 1 (NOT in the badge row).
  - An **actions** group, right-aligned. Action buttons depend on row classification:
    - **Matchable** and **Manual** rows render exactly two actions: a `Popup` button and a `Kill` button. The `Popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint (`hidden md:inline-flex`).
    - **Stale** rows render only the `Kill` button. The `Popup` button is omitted.
    - The `Open in drawer` button is REMOVED for every row category. Its function is replaced by clicking the card body to select the row.
    - Both buttons SHALL render as **icon-only** — the leading lucide icon stays (`ExternalLink` for Popup, `Trash2` for Kill) but the visible text labels `"Popup"` and `"Kill"` SHALL NOT be rendered. The buttons MUST continue to carry their `aria-label` (`"Open in popup"` / `"Kill session"`) for accessibility.

- **Row 2 — Inline metadata badges** (conditional): A row of badges SHALL be rendered ONLY when AT LEAST ONE badge would otherwise appear. When no badge applies (e.g. a `memon-manual-foo` row with no live ttyd and no parsed agent/project), row 2 SHALL be absent from the DOM (no empty `<div>`, no reserved vertical space). When at least one badge applies, the row renders all applicable badges flex-wrapping if needed.

Each badge in row 2 SHALL include a `lucide-react` icon at its leading edge (size class `size-3`), and each badge type SHALL carry a category-specific color treatment. The render order, when all are present, is: ttyd port → agent → project → scope/target. Per-badge rules:

  - **ttyd port badge** (when `row.liveEntry !== null`):
    - leading glyph: a small emerald dot (a `size-1.5` round span with `bg-emerald-500`). No icon font.
    - content: `:<port>` (e.g. `:7683`). No prefix label.
    - style: muted background, NO border. Text in emerald (`text-emerald-700` / `dark:text-emerald-300`). The dot is the only visual signal that a ttyd is bound; removing the badge entirely communicates "no ttyd".

  - **Agent badge** (when `parsed.agent !== null` AND `parsed.agent !== 'none'`):
    - icon: `Bot` (lucide).
    - content: just the agent value (e.g. `claude`, `codex`) in `font-mono`. NO prefix label word — the icon carries the category signal.
    - style: orange color family (bg/text/border in the orange palette, with a `dark:` variant for the dark theme).

  - **Project badge** (when `parsed.project !== null` AND `parsed.scope !== 'project'`):
    - icon: `FolderTree` (lucide).
    - content: just the project name (e.g. `project-a`) in `font-mono`. NO prefix label word.
    - style: violet color family (bg/text/border in the violet palette, with a `dark:` variant). This visual SHALL be identical to the project-scope `ScopeBadge` variant — the two badges are visually unified.
    - The badge SHALL be rendered as a `<Link>` to `/p/<project>` with `target="_blank"` and `rel="noopener noreferrer"`. Clicking the badge SHALL NOT bubble up to the card's row-selection handler — the anchor SHALL call `event.stopPropagation()`.
    - Suppressed for `parsed.scope === 'project'` rows because the scope/target badge already names the project.

  - **Scope/target badge** — one of five variants (the previous `Manual` variant is REMOVED):
    - For `scope: 'run'` matchable rows: icon `Zap`, content `<slug>` (e.g. `foo-260507-103000`) in `font-mono`, emerald color, rendered as a `<Link>` to `/p/<project>/r/<slug>`. NO prefix label word.
    - For `scope: 'exp'` matchable rows: icon `FlaskConical`, content `<slug>` (e.g. `E0042-bar`) in `font-mono`, sky color, rendered as a `<Link>` to `/p/<project>/e/<slug>`. NO prefix label word.
    - For `scope: 'project'` matchable rows: icon `FolderTree`, content `<project>` (e.g. `project-a`) in `font-mono`, violet color, rendered as a `<Link>` to `/p/<project>`. NO prefix label word.
    - For **legacy** rows (`parsed.legacy === true` AND none of the matchable variants match): icon `Archive`, content `Legacy`, muted color. NOT a link.
    - For **stale** rows (`row.staleReason !== null`): icon `AlertTriangle`, content `Stale (<reason>)`, amber color (or `destructive` if dark). NOT a link.
    - For **manual** rows (sessionName matches `^memon-manual-` AND none of the above apply): the scope/target badge SHALL be ABSENT. (Previously a `Wrench`/`Manual` amber chip; that variant is dropped.) This combined with manual rows usually having no liveEntry/agent/project means row 2 itself collapses.
    - For any other row that falls through all the above conditions (e.g. parseable-but-unclassified): icon `Archive`, content `Other`, muted color. NOT a link.

    All clickable scope/target variants (run / exp / project) SHALL be rendered with `target="_blank"` and `rel="noopener noreferrer"`. Clicking the badge SHALL NOT bubble up to the card's row-selection handler — the badge anchor SHALL call `event.stopPropagation()` to keep the right pane attached to the currently-selected session.

  - Across the Agent / Project / Run / Exp / Project-scope badges, NO prefix label word (e.g. `Agent`, `Project`, `Run`, `Exp`) SHALL be rendered. The leading lucide icon carries the category signal and the colored chip + value is the only content. The category-fallback badges (Legacy / Stale / Other) keep their fixed text content as defined above — those are full-word labels by necessity, not prefixes followed by a value.

  - A standalone uppercase category chip (e.g. a leading `RUN` / `EXP` / `MANUAL` chip) SHALL NOT be rendered either. The scope/target badge above carries the category signal via its icon + color.

Click handling on each row card:
- For **Matchable** and **Manual** rows, clicking the card BODY (anywhere except the action buttons or any badge link) SHALL select that row. Action buttons SHALL stop propagation so clicking the icon-only `Popup` or `Kill` does NOT change the selection. The scope/target badge link AND the project-badge link SHALL also stop propagation.
- For **Stale** rows, clicking the card body SHALL be a no-op — stale rows cannot be selected and cannot mount a terminal. The card SHALL render with reduced opacity (`opacity-75`) and SHALL NOT be a focusable interactive region (`role` is not `button`, `tabIndex` is `-1`).

The currently-selected row SHALL be visually distinguished by a **full border in the primary theme color** (e.g. `border-primary` on all four sides), NOT by a leading-edge accent bar or background fill. The selected card's background SHALL remain the same `bg-card` (white in light mode) as the unselected card.

The unselected card SHALL render on the `bg-card` surface color (white in light mode). The previous transparent-background look is removed so cards read as distinct elements against the SidebarInset's `bg-background`.

The page SHALL be auth-gated per the existing `auth-system` rules.

#### Scenario: Page renders as a resizable split-pane on desktop
- **GIVEN** the viewport width is `>= 768px` and the host has at least one `memon-*` tmux session
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** a horizontal split is rendered with the session list in the left pane and an empty terminal pane on the right
- **AND** a draggable handle SHALL appear between the two panes
- **AND** dragging the handle horizontally SHALL resize the panes

#### Scenario: Page renders as a vertical split on mobile
- **GIVEN** the viewport width is `< 768px`
- **WHEN** the user navigates to `/manage/tmux`
- **THEN** the layout SHALL be a vertical split with the list on top and the terminal pane on the bottom
- **AND** the draggable handle SHALL be the horizontal bar between them

#### Scenario: memon- prefix is stripped from row titles
- **GIVEN** the host has session `memon-claude-project-a--run--foo-260507-103000`
- **WHEN** the row renders
- **THEN** the card title text SHALL be `claude-project-a--run--foo-260507-103000` (no leading `memon-`)

#### Scenario: Manual rows render without a scope/target badge
- **GIVEN** the host has session `memon-manual-foo`
- **WHEN** the row renders
- **THEN** the card title text SHALL be `foo` (both `memon-` and `manual-` stripped)
- **AND** no scope/target badge SHALL be present in the DOM (no `Wrench`/`Manual` amber chip)
- **AND** if there is also no live ttyd entry, no parsed agent, and no parsed project, row 2 itself SHALL NOT render

#### Scenario: Run target badge renders with icon, value (no prefix), color, and new-tab link
- **GIVEN** the host has session `memon-claude-project-a--run--foo-260507-103000` and `project-a` resolves on disk
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL contain the `Zap` icon and the value `foo-260507-103000` in `font-mono`
- **AND** the badge SHALL NOT contain a `Run` prefix label word
- **AND** the badge SHALL be rendered with the emerald color family (e.g. `bg-emerald-100` light / `dark:bg-emerald-900/40` dark)
- **AND** the badge SHALL be an anchor with `href="/p/project-a/r/foo-260507-103000"`, `target="_blank"`, and `rel="noopener noreferrer"`

#### Scenario: Exp target badge renders with icon, value (no prefix), color, and new-tab link
- **GIVEN** the host has session `memon-claude-project-a--exp--E0042-bar` and the exp doc exists
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL contain the `FlaskConical` icon and the value `E0042-bar` in `font-mono`
- **AND** the badge SHALL NOT contain an `Exp` prefix label word
- **AND** the badge SHALL be rendered in the sky color family
- **AND** the badge SHALL be an anchor with `href="/p/project-a/e/E0042-bar"`, `target="_blank"`, `rel="noopener noreferrer"`

#### Scenario: Project-scope target badge renders with icon, value (no prefix), color, and new-tab link
- **GIVEN** the host has session `memon-claude-project-a--project--root` and `project-a` is in config
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL contain the `FolderTree` icon and the value `project-a` in `font-mono`
- **AND** the badge SHALL NOT contain a `Project` prefix label word
- **AND** the badge SHALL be rendered in the violet color family
- **AND** the badge SHALL be an anchor with `href="/p/project-a"`, `target="_blank"`, `rel="noopener noreferrer"`
- **AND** no separate Project badge SHALL appear in the badge row (the scope/target badge IS the project on project-scope rows)

#### Scenario: ttyd port badge renders with an emerald dot and no icon font
- **GIVEN** the host has session `memon-claude-project-a--run--foo-...` with a live ttyd on port 7683
- **WHEN** the row renders
- **THEN** the row SHALL contain a port badge whose leading glyph is a small emerald-filled circle (e.g. `bg-emerald-500` on a `size-1.5 rounded-full` span)
- **AND** the badge's content SHALL read `:7683` in monospace, in an emerald foreground color
- **AND** the badge SHALL NOT carry any colored border
- **AND** the badge's background SHALL be the muted color used by neutral chips

#### Scenario: Agent badge renders with bot icon and value only (no prefix)
- **GIVEN** the host has session `memon-claude-project-a--run--foo-...` where the parsed agent is `claude`
- **WHEN** the row renders
- **THEN** the agent badge SHALL contain the `Bot` icon and the value `claude` in `font-mono`
- **AND** the badge SHALL NOT contain an `Agent` prefix label word
- **AND** the badge SHALL be rendered in the orange color family

#### Scenario: Project badge unified with project-scope visual on run/exp rows
- **GIVEN** a matchable row with `scope: 'run'` and `parsed.project === 'project-a'`
- **WHEN** the row renders
- **THEN** the project badge SHALL contain the `FolderTree` icon and the value `project-a` in `font-mono`
- **AND** the badge SHALL NOT contain a `Project` prefix label word
- **AND** the badge SHALL be rendered in the violet color family (matching the project-scope scope/target badge)
- **AND** the badge SHALL be an anchor with `href="/p/project-a"`, `target="_blank"`, `rel="noopener noreferrer"`
- **AND** clicking the badge SHALL open the project page in a new tab and SHALL NOT change the selected session in the current tab
- **AND** no muted-Folder badge variant SHALL be rendered (the previous Folder/no-prefix/muted treatment is removed)

#### Scenario: Legacy rows render with archive icon and Legacy variant
- **GIVEN** the host has session `memon-claude-foo-260507-103000` (pre-rework format)
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL be the `Legacy` variant: icon `Archive`, content `Legacy`, muted color
- **AND** the badge SHALL NOT be rendered as a link

#### Scenario: Stale rows render with alert icon and Stale variant
- **GIVEN** a stale row (e.g. `memon-claude-archived-proj--run--baz-...` where `archived-proj` is not in config)
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL be the `Stale` variant: icon `AlertTriangle`, content `Stale (unknown-project)`, amber color
- **AND** the badge SHALL NOT be rendered as a link

#### Scenario: Row 2 is absent when no badges apply
- **GIVEN** the host has session `memon-manual-foo` with NO live ttyd entry
- **WHEN** the row renders
- **THEN** no port badge SHALL be present (no `liveEntry`)
- **AND** no agent badge SHALL be present (manual row has no parsed agent)
- **AND** no project badge SHALL be present (manual row has no parsed project)
- **AND** no scope/target badge SHALL be present (the Manual variant is removed)
- **AND** row 2 itself SHALL NOT be in the DOM — the card content collapses to row 1 only (title + time + buttons)

#### Scenario: Inline badges render fully for an active matchable row
- **GIVEN** the host has session `memon-claude-project-a--run--foo-260507-103000`, the manager holds a live ttyd entry on port 7683 for it, and `project-a` resolves on disk
- **WHEN** the row renders
- **THEN** the card SHALL contain badges in row 2 in this order: port (`:7683` with emerald dot, no icon font), agent (just `claude` in `font-mono` with `Bot` icon in orange — no `Agent` prefix word), project (just `project-a` in `font-mono` with `FolderTree` icon in violet, anchor to `/p/project-a` — no `Project` prefix word), and scope/target (just `foo-260507-103000` in `font-mono` with `Zap` icon in emerald, anchor to `/p/project-a/r/foo-260507-103000` opening in a new tab — no `Run` prefix word)
- **AND** the project badge SHALL share the same visual class as the project-scope scope/target badge (both violet, both `FolderTree`, both `Project <name>` form)
- **AND** no standalone uppercase category chip (e.g. `[RUN]` alone) SHALL be rendered
- **AND** the relative time label (e.g. `5m ago`) SHALL be in row 1 immediately to the left of the action buttons, NOT in row 2

#### Scenario: Clicking a target-badge link opens a new tab and does not change selection
- **GIVEN** a matchable row for `memon-claude-project-a--run--foo-...` and an unrelated session `Y` is currently selected (right pane shows Y's terminal)
- **WHEN** the user clicks the `Run foo-...` target badge on the matchable row
- **THEN** a new browser tab opens at `/p/project-a/r/foo-...`
- **AND** the current `/manage/tmux` tab stays on the page
- **AND** session `Y` remains selected (the right pane stays on Y's terminal — clicking the badge does NOT propagate to the card's select handler)

#### Scenario: Clicking a project-badge link opens a new tab and does not change selection
- **GIVEN** a matchable run row for `memon-claude-project-a--run--foo-...` whose project badge links to `/p/project-a`
- **WHEN** the user clicks the project badge
- **THEN** a new browser tab opens at `/p/project-a`
- **AND** the current row's selected state in `/manage/tmux` is unchanged

#### Scenario: Action buttons render icon-only with no text label
- **GIVEN** any matchable, manual, or stale row
- **WHEN** the row renders
- **THEN** the `Popup` button (when present) SHALL contain ONLY the `ExternalLink` lucide icon — no `Popup` text child
- **AND** the `Kill` button SHALL contain ONLY the `Trash2` lucide icon — no `Kill` text child
- **AND** both buttons SHALL carry an `aria-label` attribute (`"Open in popup"` and `"Kill session"` respectively)

#### Scenario: Manual rows render Popup + Kill only (no Drawer)
- **GIVEN** a manual row (e.g. `memon-manual-foo`)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly two icon-only buttons: `Popup` and `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open `/terminal-popup?sessionName=memon-manual-foo`

#### Scenario: Matchable rows render Popup + Kill only (no Drawer)
- **GIVEN** a matchable row (`memon-claude-project-a--run--foo-260507-103000`)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly two icon-only buttons: `Popup` and `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open the standard popup URL with `project / scope / slug / agent` query params

#### Scenario: Stale rows render Kill only and are non-selectable
- **GIVEN** a stale row (e.g. `memon-claude-archived-proj--run--baz-...` where `archived-proj` is not in config)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly one icon-only button: `Kill`
- **AND** no `Popup` or `Drawer` button SHALL be present in the DOM
- **AND** clicking the card body SHALL NOT change the selected session

#### Scenario: Popup button on mobile is hidden for matchable and manual rows
- **GIVEN** the viewport is below the Tailwind `md` breakpoint
- **WHEN** any matchable or manual row renders
- **THEN** the `Popup` button SHALL carry class `hidden md:inline-flex` and not be visible

#### Scenario: Clicking a matchable row card selects that session
- **GIVEN** a matchable row in the left pane and no session currently selected
- **WHEN** the user clicks the card body (not an action button, target badge link, or project badge link)
- **THEN** the row's outer card SHALL gain a primary-colored border on all four sides (`border-primary`)
- **AND** the card background SHALL remain the same `bg-card` as before selection (no background fill change)
- **AND** the right pane SHALL mount `<TerminalView>` in `standard` mode wired to that row's `(project, scope, slug, agent)`

#### Scenario: Clicking a manual row card selects that session in raw mode
- **GIVEN** a manual row (e.g. `memon-manual-foo`)
- **WHEN** the user clicks the card body
- **THEN** the right pane SHALL mount `<TerminalView>` in `raw` mode wired to that row's `sessionName`

#### Scenario: Action button clicks do not change selection
- **GIVEN** session `A` is currently selected and session `B` is also visible
- **WHEN** the user clicks the `Popup` button on row `B`
- **THEN** session `A` SHALL remain selected (right pane stays on A's terminal)
- **AND** a popup window opens for `B`

#### Scenario: Kill removes the session and clears selection if it was selected
- **GIVEN** session `X` is currently selected
- **WHEN** the user clicks `Kill` on row `X` and confirms
- **THEN** `DELETE /api/tmux-sessions/<X>` fires
- **AND** on success the row disappears and the right pane returns to the empty-state placeholder
- **AND** the `?session=` URL param SHALL be removed

#### Scenario: Filter tabs narrow the list (unchanged from prior behavior)
- **GIVEN** there are 5 total `memon-*` sessions, 2 with live ttyd entries, 1 of which is stale
- **WHEN** the user clicks `Active in memon`
- **THEN** only the 2 rows with live entries are visible in the left pane
- **WHEN** the user clicks `Stale`
- **THEN** only the 1 stale row is visible (manual rows excluded)
- **AND** the right pane SHALL remain unchanged (filter does NOT clear the selected session unless that session's row is filtered out, in which case it stays selected — the user just can't see the source row until they switch the filter back)

#### Scenario: New session button creates a manual session (unchanged)
- **WHEN** the user clicks `New session`, types `foo` in the dialog, and submits
- **THEN** `POST /api/tmux-sessions { name: "foo" }` fires
- **AND** on 200 response the dialog closes and the list refetches showing the new `memon-manual-foo` row

### Requirement: TmuxSessionRow carries pane info on the wire

The shape of each row returned by `GET /api/tmux-sessions` SHALL be extended with three fields — the existing `pane` payload from the prior change, a top-level `state` field derived from `pane.title` plus a per-sessionName server-side memo, AND a `lastStateChangeAt` timestamp surfacing the most recent server-observed transition for the same memo:

```ts
pane: {
  /** PTY-protocol window title set by the foreground program. Truncated to ≤256+1 chars. */
  title: string | null
  /** Basename of the foreground process (e.g. `claude`, `bash`, `node`). */
  currentCommand: string | null
  /** Absolute cwd of the foreground process. */
  currentPath: string | null
} | null

/** Liveness state derived from pane.title plus the server-side
 *  unacknowledged-running memo. */
state: 'idle' | 'running' | 'attention' | 'done'

/** ISO8601 of the most recent state transition for this sessionName,
 *  or `null` when the memo entry is fresh (first observation) or has
 *  been cleared (right after the user opened the ttyd). */
lastStateChangeAt: string | null
```

A row's `pane` field SHALL be `null` when:
- tmux returned no active pane for that session, OR
- the `list-panes` shell-out failed, OR
- the enrichment helper was unable to identify which pane is active.

A row's `state` field SHALL always be present and always be one of the four enum values. When `pane` is `null` (no title to evaluate), `state` SHALL be either `'idle'` (no prior unacknowledged running) or `'done'` (prior unacknowledged running in the memo).

#### Scenario: Active session surfaces full pane payload
- **GIVEN** a memon-* tmux session whose active pane has command `claude`, path `/path/to/run-dir`, and title `✻ Claude — Building digest…`
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row carries `pane: { currentCommand: 'claude', currentPath: '/path/to/run-dir', title: '✻ Claude — Building digest…' }`
- **AND** the row carries a `state` field with one of the four enum values

#### Scenario: Manual session with bare shell surfaces shell as command
- **GIVEN** a memon-manual-foo session whose active pane is running `bash` with no OSC title set
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row carries `pane: { currentCommand: 'bash', currentPath: <some-path>, title: <hostname-or-similar> }`
- **AND** `state` is `'idle'` (bare shell title doesn't match any rule and there's no memo)

#### Scenario: Session with no pane info surfaces null
- **GIVEN** the host's tmux is reachable for `tmux ls` but `tmux list-panes -a` fails (e.g. permissions race)
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** every row's `pane` field is `null` and the response still returns 200
- **AND** every row's `state` is `'idle'` (no title to evaluate; no memo can be set without a running title)

#### Scenario: State field appears alongside the pane payload for older clients
- **GIVEN** an older client that does not read the `state` field
- **WHEN** the client deserializes the API response
- **THEN** the existing top-level fields (`sessionName`, `parsed`, `liveEntry`, `tmuxCreatedAt`, `tmuxLastActivity`, `matchable`, `staleReason`, `pane`) remain present and have the same shape and types
- **AND** the new `state` and `lastStateChangeAt` fields are present on every row

#### Scenario: lastStateChangeAt is null on a freshly observed row
- **GIVEN** a `memon-*` session that has not been seen by the enrichment helper before
- **WHEN** the first `GET /api/tmux-sessions` returns that row
- **THEN** `row.lastStateChangeAt` is `null`
- **AND** `row.state` reflects the live evaluation of `pane.title` plus a fresh memo (no prior unacknowledged-running flag)

### Requirement: /manage/tmux cards render a pane info line under the badge row

Each session card on `/manage/tmux` SHALL render a **card footer** zone beneath the content zone, visually separated by a thin horizontal border (`border-t border-border/40`) that extends to the card's left and right padded edges. The footer SHALL render at `text-foreground/85` (NOT muted-foreground) so its text is legible against the card's bg-card surface AND against the state-tint backgrounds.

The footer SHALL contain (in order, on a single horizontal `flex` row with `text-[10px] font-mono`):

1. **Command segment** — one of two variants:
   - **Claude variant**: when `pane.currentCommand === 'claude'`, render `<span><span aria-hidden>✻</span> Claude</span>` styled with `font-semibold text-orange-600 dark:text-orange-400`. The `orange-600` light-mode shade matches Anthropic's Claude brand color (the deeper "Sandstone"-style orange) more closely than the previously-used `orange-500`. The `font-semibold` weight + the orange tone make the Claude segment the most prominent element of the footer line. No `Activity` lucide icon is rendered for this variant — the `✻` glyph plays the icon role.
   - **Generic variant**: for every other `pane.currentCommand` value (including null), render an `Activity` lucide icon (`size-3 text-foreground/60 shrink-0`) followed (when applicable) by the command basename in monospace and `font-semibold`. The "uninformative shell" deny-list `[bash, zsh, sh, fish, tmux]` SHALL still suppress the trailing command basename when `pane.title` is non-null (so the footer reads as just the icon + title for idle shells).

2. **Separator dot** (`·`) with horizontal spacing — rendered ONLY when BOTH the command segment and the title segment would render content.

3. **Title segment** — `pane.title` truncated to fit the remaining width with CSS ellipsis (`min-w-0 truncate`). The full untruncated title SHALL be the card's `title` HTML attribute (browser hover tooltip) so the user can hover anywhere on the card to read the full text.

The footer SHALL NOT be rendered when:
- `row.pane === null`, OR
- both `row.pane.currentCommand` would be suppressed (deny-listed AND a title exists) AND `row.pane.title === null`.

When the footer is omitted, the content/footer separator border SHALL ALSO be absent. The card collapses to just its content zone with the usual outer border.

The footer SHALL surface `row.state` via a small pill badge in the
**bottom-right corner of the card** (right-aligned at the end of the footer
row via `ml-auto`). When `row.state === 'idle'` no badge SHALL be rendered —
idle is encoded by the badge's ABSENCE so idle cards stay visually quiet.
When `row.state !== 'idle'`, the badge SHALL contain a small colored dot
(`size-1.5 rounded-full`) followed by the state label in ALL CAPS
(`RUNNING` / `ATTENTION` / `DONE`). The label SHALL render in the
default sans-serif font (NOT the surrounding footer's monospace font);
the badge SHALL carry `font-sans font-semibold tracking-wide` so the
all-caps label reads as a proper status pill. Per-state palette:

| `row.state` | Badge chip background | Dot color | Badge label |
|---|---|---|---|
| `'idle'` | (no badge rendered) | — | — |
| `'running'` | `bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200` | `bg-blue-500` | `RUNNING` |
| `'attention'` | `bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200` | `bg-amber-500` | `ATTENTION` |
| `'done'` | `bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200` | `bg-emerald-500` | `DONE` |

When `row.state !== 'idle'` AND the row has no displayable pane content
(both command and title would render as null), the footer SHALL still
render — containing ONLY the state badge right-aligned. The content/footer
separator border SHALL render in that case too, so the badge is visually
attached to the card's bottom edge.

The footer SHALL NOT carry any state-based background tint on its
container. The card's text content (Claude glyph vs `Activity` icon,
command text, separator, title) SHALL be IDENTICAL across all four
states. The card's hover `title` HTML attribute SHALL be the raw
`pane.title`, unchanged across states. The page's `document.title` /
browser-tab label is OUT OF SCOPE and is NOT affected by this
requirement.

The pane info line SHALL NOT affect card click-to-select behaviour; it is non-interactive. Mouse events on the line SHALL propagate up to the card body's existing select handler (no `stopPropagation` here).

#### Scenario: Card footer shows Claude variant for a Claude session
- **GIVEN** a card whose `row.pane` has `currentCommand: 'claude'` and `title: '✻ Claude — Building digest…'`
- **WHEN** the card renders
- **THEN** the footer's leading segment is a single `<span>` containing `✻ Claude` (the `✻` character followed by a space and the word `Claude`), styled with `text-orange-600` (light) / `text-orange-400` (dark) and `font-semibold`
- **AND** no `Activity` lucide icon is in the footer DOM
- **AND** the footer continues with a `·` separator and the truncated title `✻ Claude — Building digest…`
- **AND** hovering the card surfaces the full untruncated title via the card's `title` HTML attribute

#### Scenario: Card footer shows generic variant for a non-Claude session
- **GIVEN** a card whose `row.pane` has `currentCommand: 'node'` and `title: '[ . ] Action Required | project-x'`
- **WHEN** the card renders
- **THEN** the footer's leading segment is the `Activity` lucide icon followed by the text `node`
- **AND** the orange Claude glyph is NOT rendered

#### Scenario: Card footer suppresses deny-listed shell command when a title is present
- **GIVEN** a card whose `row.pane` has `currentCommand: 'bash'` and `title: 'hostname:/path'`
- **WHEN** the card renders
- **THEN** the footer shows the `Activity` icon + the title `hostname:/path` (no `bash` text segment)
- **AND** no `·` separator is in the DOM (since only the title segment renders)

#### Scenario: Card footer shows deny-listed shell when no title is available
- **GIVEN** a card whose `row.pane` has `currentCommand: 'bash'` and `title: null`
- **WHEN** the card renders
- **THEN** the footer shows the `Activity` icon + the text `bash` (deny-list suppression bypassed because no title is available — without the command the footer would be blank)

#### Scenario: Card footer omitted when pane is null
- **GIVEN** a card whose `row.pane === null`
- **WHEN** the card renders
- **THEN** no footer is in the DOM
- **AND** no content/footer separator border is in the DOM
- **AND** the card collapses to just its content zone

#### Scenario: Footer background tint matches row.state
- **GIVEN** a card whose `row.state === 'running'`
- **WHEN** the card renders
- **THEN** the footer carries the Tailwind classes `bg-blue-50 dark:bg-blue-950/40`
- **AND** the footer's text content is unchanged from an otherwise-identical `'idle'` card
- **WHEN** `row.state` is `'attention'`, the footer carries `bg-amber-50 dark:bg-amber-950/40`
- **WHEN** `row.state` is `'done'`, the footer carries `bg-emerald-50 dark:bg-emerald-950/40`
- **WHEN** `row.state` is `'idle'`, the footer carries no state-specific background class

#### Scenario: Footer text is legible against every state tint
- **GIVEN** any card with a non-null pane
- **WHEN** the card renders in any of the four states
- **THEN** the footer text uses the `text-foreground/85` color class (NOT `text-muted-foreground`)
- **AND** the Claude glyph segment (when present) uses `text-orange-600` / `text-orange-400` regardless of state

#### Scenario: Pane info line does not eat card click
- **GIVEN** an unselected matchable card with a non-null footer
- **WHEN** the user clicks anywhere on the footer (text or background)
- **THEN** the card's select handler fires and the session becomes selected (the card gains the `border-primary` outline)

#### Scenario: Page tab title is unaffected by row state
- **GIVEN** the user is on `/manage/tmux` and at least one row has `state === 'attention'`
- **WHEN** the browser tab label is inspected
- **THEN** the `document.title` is the existing per-route title from the `page-titles` capability (no state markers appended)

## ADDED Requirements

### Requirement: Card footer liveness state computed server-side from pane title

The web backend SHALL compute `row.state` for every `TmuxSessionRow` returned by `GET /api/tmux-sessions` and `GET /api/tmux-sessions/:name`. The state is a four-value enum: `'idle' | 'running' | 'attention' | 'done'`.

State precedence per evaluation tick (first match wins):

1. **`attention`** — `pane.title` (when non-null) matches the attention rule (defined below). Reactive: the state exits `attention` the moment the rule no longer matches; no user-acknowledgement is required to clear.
2. **`running`** — `pane.title` (when non-null) matches the running rule (defined below). Reactive.
3. **`done`** — the per-sessionName memo flag `hadUnacknowledgedRunning[sessionName]` is `true`.
4. **`idle`** — default fall-through.

Alongside the unacknowledged-running flag, the per-sessionName memo SHALL also track the most recent state transition. On every enrichment tick the server computes `newState` (per the precedence above), compares it to the memo's `lastState`, and:

- If the memo entry does not yet exist (first observation for this sessionName), create it with `lastState = newState` and `lastStateChangeAt = null`. First observation is NOT a transition.
- If `newState !== existing.lastState`, set `lastStateChangeAt = new Date().toISOString()` and update `lastState = newState`. This applies to every transition (idle ↔ running, running ↔ attention, running → done, attention → idle, etc.).
- If `newState === existing.lastState`, leave `lastStateChangeAt` unchanged.

`clearPaneStateMemo` (invoked by manager.startSession / attachExistingSession) deletes the memo entry entirely — `lastStateChangeAt` resets to `null` on the next tick, alongside the unacknowledged-running flag. Stop / idle-TTL / LRU paths SHALL NOT clear `lastStateChangeAt`.

The memo flag's lifecycle:

- **Set to `true`** every tick where the row's current evaluation is `running` (precedence step 2 matched). Idempotent — already-true stays true.
- **Cleared to `false`** when the terminal manager registers a ttyd entry for this sessionName: specifically, at the end of `manager.startSession()` and `manager.attachExistingSession()` after the new `Entry` is committed to the manager's session map. Both fresh-spawn and idempotent-reattach paths SHALL clear the flag — the user's open-the-ttyd action signal is present in both.
- **NOT cleared** by `manager.stopSession()`, idle-TTL kills, or LRU evictions — those are automatic cleanups, not user acknowledgements.
- **Pruned** at the end of each enrichment pass: any memo key whose sessionName is no longer in the observed inventory SHALL be removed. This prevents the memo from leaking memory across long-running processes.
- **Lifecycle storage**: the memo SHALL be pinned on `globalThis.__memonPaneStateMemo` (mirroring the existing `__memonTerminalState` and `__memonTmuxPaneCache` patterns) so Next.js HMR reloads do not lose the flag. The memo resets on Node process restart — acceptable, same lifecycle as the manager's session map.

Detection rules:

- **Running rule**: `pane.title` is non-null AND the FIRST Unicode code point of `pane.title` falls in any of the ranges in `RUNNING_PREFIX_RANGES` OR is a member of the extras set `RUNNING_PREFIX_CHARS`. The initial range list is exactly `[[0x2800, 0x28FF]]` — the entire Unicode **Braille Patterns** block, 256 code points. The initial extras set is empty (the two characters the user originally singled out, `⠐` U+2810 and `⠂` U+2802, both live inside the Braille Patterns block and are covered by the range). Additional ranges MAY be added to `RUNNING_PREFIX_RANGES`, and additional single characters MAY be added to `RUNNING_PREFIX_CHARS`, in future changes without other code edits. The check uses `title.codePointAt(0)` to handle potential future ranges that include code points above the BMP. No fuzzy match, no substring inside the title, no case folding.
- **Attention rule**: `pane.title` is non-null AND `pane.title.toLowerCase()` contains the substring `'action required'`. The initial pattern list is exactly `['action required']`. Additional substrings MAY be added in future changes.

Both rules SHALL be implemented as small, named pure functions (`matchesRunning(title)` and `matchesAttention(title)`) in a new module `apps/web/lib/terminal/pane-state.ts`. The constants `RUNNING_PREFIX_RANGES`, `RUNNING_PREFIX_CHARS`, and `ATTENTION_PATTERNS` SHALL be named exports of the same module.

The rules SHALL only consider `pane.title`. They SHALL NOT consider `pane.currentCommand` or `pane.currentPath`.

#### Scenario: Title starting with U+2810 (one of the originally-named glyphs) produces running state
- **GIVEN** a session whose `pane.title` is `'⠐ ttyd-title-fetch'`
- **WHEN** the row is enriched
- **THEN** `row.state` is `'running'`

#### Scenario: Title starting with U+2802 (one of the originally-named glyphs) produces running state
- **GIVEN** a session whose `pane.title` is `'⠂ working on something'`
- **WHEN** the row is enriched
- **THEN** `row.state` is `'running'`

#### Scenario: Title starting with any other character in the Braille Patterns block produces running state
- **GIVEN** a session whose `pane.title` is `'⠁ other-spinner'` (U+2801, inside U+2800..U+28FF but NOT one of the originally-named glyphs)
- **WHEN** the row is enriched
- **THEN** `row.state` is `'running'`
- **AND** the same outcome SHALL hold for titles starting with `'⠿'` (U+283F), `'⣿'` (U+28FF, the last code point in the block), or `'⠀'` (U+2800, the first code point in the block) — every code point in the inclusive range U+2800..U+28FF matches

#### Scenario: Title starting with a character outside the Braille Patterns block and not in the extras set is not running
- **GIVEN** a session whose `pane.title` is `'✻ Claude — idle'` (starts with U+273B, outside U+2800..U+28FF)
- **WHEN** the row is enriched
- **THEN** `row.state` is NOT `'running'` (it is `'idle'` absent a memo flag and absent any attention match)

#### Scenario: Title containing 'Action Required' produces attention state
- **GIVEN** a session whose `pane.title` is `'[ . ] Action Required | project-x'`
- **WHEN** the row is enriched
- **THEN** `row.state` is `'attention'`

#### Scenario: Title containing 'action required' case-insensitive produces attention state
- **GIVEN** a session whose `pane.title` is `'something — action required'`
- **WHEN** the row is enriched
- **THEN** `row.state` is `'attention'`

#### Scenario: Title matching BOTH attention and running rules resolves to attention
- **GIVEN** a hypothetical session whose `pane.title` is `'⠐ Action Required ...'`
- **WHEN** the row is enriched
- **THEN** `row.state` is `'attention'` (attention precedence beats running)

#### Scenario: Running transitions to done when title stops matching the running rule
- **GIVEN** a session that was running on tick T (memo flag becomes `true`)
- **AND** on tick T+1 the `pane.title` no longer matches the running rule (and doesn't match attention)
- **WHEN** the row is enriched on tick T+1
- **THEN** `row.state` is `'done'`
- **AND** the memo flag is still `true` (not cleared by the rule no longer matching)

#### Scenario: Done state persists across multiple non-running ticks
- **GIVEN** a session in `'done'` state on tick T
- **AND** on tick T+1 the `pane.title` still doesn't match running or attention
- **AND** the user has not opened a ttyd between T and T+1
- **WHEN** the row is enriched on tick T+1
- **THEN** `row.state` remains `'done'`

#### Scenario: Done clears to idle when the user opens a ttyd
- **GIVEN** a session in `'done'` state on tick T (memo flag is `true`)
- **AND** on tick T+1 the user opens the ttyd for that sessionName (via `POST /api/terminal/start` or `POST /api/terminal/attach`)
- **WHEN** the row is enriched after the manager commits the new ttyd entry
- **THEN** the memo flag is `false`
- **AND** assuming `pane.title` doesn't match running or attention, `row.state` is `'idle'`

#### Scenario: Idempotent ttyd reattach also clears the memo
- **GIVEN** a session in `'done'` state with an EXISTING healthy ttyd entry in the manager
- **WHEN** the client POSTs another `/api/terminal/start` (or `/attach`) for the same sessionName, which returns the existing entry idempotently
- **THEN** the memo flag is still cleared to `false` after the idempotent return path commits

#### Scenario: Stopping a ttyd does NOT clear the memo
- **GIVEN** a session in `'done'` state with a ttyd entry currently held by the manager
- **WHEN** `manager.stopSession()` runs (e.g. idle-TTL kill, LRU eviction, or explicit stop)
- **THEN** the memo flag is unchanged
- **AND** subsequent enrichment ticks continue to resolve `'done'` until the user opens the ttyd again or running/attention is re-detected

#### Scenario: Attention does NOT trigger the done memo
- **GIVEN** a session that has never been in `'running'` state
- **AND** on tick T the `pane.title` matches the attention rule
- **WHEN** the row is enriched
- **THEN** `row.state` is `'attention'` (memo flag remains `false`)
- **AND** on tick T+1 the `pane.title` no longer matches attention and doesn't match running
- **WHEN** the row is enriched on T+1
- **THEN** `row.state` is `'idle'` (NOT `'done'` — the prior attention did not set the memo)

#### Scenario: Attention can exit without user action
- **GIVEN** a session in `'attention'` state on tick T
- **AND** on tick T+1 the `pane.title` no longer matches the attention rule
- **AND** the user did not open the ttyd between T and T+1
- **WHEN** the row is enriched on T+1
- **THEN** `row.state` is NOT `'attention'` (it falls through to `'done'` if the running memo is set, else `'idle'`)

#### Scenario: Memo entries are pruned when sessions disappear from tmux
- **GIVEN** the memo holds an entry for `memon-claude-x--run--gone-...`
- **AND** the next `tmux ls` no longer reports that sessionName
- **WHEN** the enrichment pass completes
- **THEN** the memo's entry for that sessionName has been removed
- **AND** the memo's size reflects only currently-observed sessionNames

#### Scenario: First observation does not stamp lastStateChangeAt
- **GIVEN** a sessionName never before seen by `computePaneState`
- **WHEN** the first enrichment tick runs for that sessionName
- **THEN** the memo entry's `lastStateChangeAt` is `null`
- **AND** `row.lastStateChangeAt` is `null` on the wire

#### Scenario: A state transition stamps lastStateChangeAt at the current wall-clock time
- **GIVEN** a sessionName whose memo says `lastState = 'running'` (set by a prior tick) and `lastStateChangeAt = null`
- **WHEN** the next tick computes `newState = 'done'` (the title no longer matches running and no warning rule fires)
- **THEN** the memo's `lastStateChangeAt` is set to the wall-clock time of THIS tick
- **AND** subsequent ticks with the same `newState === 'done'` leave `lastStateChangeAt` unchanged

#### Scenario: Multiple distinct transitions update lastStateChangeAt in order
- **GIVEN** a sessionName transitions running → done → running → done across four ticks
- **WHEN** each transition is processed
- **THEN** `lastStateChangeAt` is rewritten at each transition
- **AND** the value at the final tick is strictly greater (later) than the value at the earlier transitions

#### Scenario: Same-state ticks do NOT touch lastStateChangeAt
- **GIVEN** a sessionName whose memo says `lastState = 'idle'` and `lastStateChangeAt = 'T_prev'`
- **WHEN** the next tick computes `newState = 'idle'` (still no rule match)
- **THEN** `lastStateChangeAt` remains exactly `'T_prev'`

#### Scenario: clearPaneStateMemo drops lastStateChangeAt alongside the running flag
- **GIVEN** a sessionName whose memo holds `lastStateChangeAt: '2026-05-13T20:00:00Z'`
- **WHEN** `clearPaneStateMemo(sessionName)` runs (manager.startSession / attachExistingSession)
- **THEN** the memo entry is deleted
- **AND** the NEXT tick observes a "first observation" — `lastStateChangeAt` is `null` again

#### Scenario: stopSession does NOT clear lastStateChangeAt
- **GIVEN** a sessionName whose memo holds a non-null `lastStateChangeAt`
- **WHEN** `manager.stopSession(sessionName)` runs (idle-TTL kill, LRU eviction, or explicit stop)
- **THEN** the memo entry — including `lastStateChangeAt` — is unchanged

#### Scenario: Card displays max(lastStateChangeAt, tmuxLastActivity) as the relative time
- **GIVEN** a card whose `row.tmuxLastActivity` is `'2026-05-13T20:00:00Z'` (5 minutes ago) and `row.lastStateChangeAt` is `'2026-05-13T20:04:55Z'` (5 seconds ago)
- **WHEN** the row renders
- **THEN** the relative-time label reads ~`5s ago` (derived from the more-recent `lastStateChangeAt`)
- **GIVEN** the same row but with `row.lastStateChangeAt` is `null`
- **WHEN** the row renders
- **THEN** the label reads ~`5m ago` (derived from `tmuxLastActivity` since the transition timestamp is absent)

#### Scenario: Extending the running detection set is a one-line code change
- **GIVEN** the running prefix configuration has the initial values `RUNNING_PREFIX_RANGES = [[0x2800, 0x28FF]]` and `RUNNING_PREFIX_CHARS = (empty)`
- **WHEN** a developer adds a new range to `RUNNING_PREFIX_RANGES` (e.g. another spinner-glyph block) OR adds a new single character to `RUNNING_PREFIX_CHARS` (e.g. codex's `[` U+005B) in `apps/web/lib/terminal/pane-state.ts`
- **THEN** titles whose first code point matches the new range or set member SHALL be classified as `'running'` without any other code edit
- **AND** no API contract change is required (the wire shape is unchanged)
