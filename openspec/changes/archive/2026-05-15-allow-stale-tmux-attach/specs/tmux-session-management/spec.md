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
    - **Matchable**, **Manual**, AND **Stale** rows render exactly two actions: a `Popup` button and a `Kill` button. The `Popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint (`hidden md:inline-flex`).
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
- For **Matchable**, **Manual**, AND **Stale** rows, clicking the card BODY (anywhere except the action buttons or any badge link) SHALL select that row. Action buttons SHALL stop propagation so clicking the icon-only `Popup` or `Kill` does NOT change the selection. The scope/target badge link AND the project-badge link SHALL also stop propagation.
- For **Stale** rows specifically, the card SHALL keep `opacity-75` (signalling "no current memon target") but SHALL be a focusable interactive region (`role="button"`, `tabIndex={0}`, `cursor-pointer`, `focus-visible:ring-*`) so it behaves identically to manual rows for keyboard and pointer interaction. The reduced opacity is the only visual deviation from matchable/manual rows; it does NOT gate selection.

The currently-selected row SHALL be visually distinguished by a **full border in the primary theme color** (e.g. `border-primary` on all four sides), NOT by a leading-edge accent bar or background fill. The selected card's background SHALL remain the same `bg-card` (white in light mode) as the unselected card. This applies to stale rows too: a selected stale row SHALL gain the `border-primary` outline while keeping its `opacity-75`.

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

#### Scenario: Stale rows render Popup + Kill and are selectable in raw mode
- **GIVEN** a stale row (e.g. `memon-claude-archived-proj--run--baz-...` where `archived-proj` is not in config)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly two icon-only buttons: `Popup` and `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open `/terminal-popup?sessionName=memon-claude-archived-proj--run--baz-...&stale=unknown-project`
- **AND** clicking the card body (or pressing Enter / Space when the card is focused) SHALL select the row and mount `<TerminalView mode="raw" sessionName={row.sessionName} />` in the right pane
- **AND** the card SHALL render with `opacity-75` AND `role="button"` AND `tabIndex={0}` AND `cursor-pointer`
- **AND** when selected the card SHALL also gain the `border-primary` outline (opacity stays at `0.75`)

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

### Requirement: Right pane renders inline terminal for the selected session

The right pane of `/manage/tmux` SHALL render one of:
1. An **empty-state placeholder** when no session is selected (centered text "Select a session from the list" plus a brief hint).
2. The existing `<TerminalView>` component, attached to the currently-selected session, in either `standard` or `raw` mode depending on the row's matchability.

The right pane SHALL include a slim **header bar** ABOVE the `<TerminalView>` iframe when a session is selected, showing:
- The full (unstripped) session name in monospace.
- A `Pop out` button that opens the same `/terminal-popup` URL the per-row `Popup` button would (standard query shape for matchable, `?sessionName=` for manual, `?sessionName=&stale=<reason>` for stale).

When the selected row is **stale** (`row.staleReason !== null`), the right pane SHALL render a one-line **stale warning banner** between the slim header bar and the `<TerminalView>` iframe-host container. The banner SHALL:
- be a single horizontal `flex` row spanning the full width of the right pane,
- carry the same amber palette used by the list-row `Stale (<reason>)` badge (e.g. `bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200` with an `AlertTriangle` lucide icon at its leading edge),
- read `Stale: <reason> — memon links won't resolve. ttyd is still attached.` (where `<reason>` is one of `unknown-project` or `unknown-target`),
- include the full sessionName in `font-mono` at the end of the line (truncating with ellipsis if it overflows),
- NOT be dismissible — no close button, no localStorage state.

The `<TerminalView>` SHALL be keyed on `sessionName` (`key={sessionName}` on the JSX element) so that switching the selected row tears down the previous instance (firing its cleanup effect) and mounts a fresh instance for the new session. This guarantees:
- The previous iframe is removed from the DOM (no zombie connections).
- The new start/attach effect fires for the new sessionName.

`<TerminalView>` mode dispatch:
- Matchable row (`row.matchable === true`): mode is `standard`, wired to `row.parsed.project / scope / slug / agent`. The component internally calls `POST /api/terminal/start`.
- Manual row (`row.matchable === false && row.staleReason === null`): mode is `raw`, wired to `row.sessionName`. The component internally calls `POST /api/terminal/attach`.
- Stale row (`row.staleReason !== null`): mode is `raw`, wired to `row.sessionName`. The component internally calls `POST /api/terminal/attach`. The right pane additionally renders the stale warning banner described above.

The right-pane container SHALL be `flex flex-col h-full min-h-0` so the iframe stretches to fill the pane and the iframe scrolls internally rather than the page scrolling. The banner SHALL NOT consume scroll space inside the iframe — it lives outside the iframe-host container.

#### Scenario: Empty state placeholder when nothing is selected
- **GIVEN** the user is on `/manage/tmux` with no `?session=` and has not clicked any row
- **WHEN** the page mounts
- **THEN** the right pane renders a centered "Select a session from the list" placeholder
- **AND** no `<TerminalView>` instance is in the DOM

#### Scenario: Selecting a matchable row mounts TerminalView in standard mode
- **GIVEN** a matchable row for `memon-claude-project-a--run--foo-260507-103000`
- **WHEN** the user clicks the row card
- **THEN** the right pane mounts `<TerminalView mode="standard" project="project-a" scope="run" slug="foo-260507-103000" agent="claude" />`
- **AND** the header bar shows the full `memon-claude-project-a--run--foo-260507-103000` text and a `Pop out` button
- **AND** no stale warning banner SHALL be present

#### Scenario: Selecting a manual row mounts TerminalView in raw mode
- **GIVEN** a manual row for `memon-manual-foo`
- **WHEN** the user clicks the row card
- **THEN** the right pane mounts `<TerminalView mode="raw" sessionName="memon-manual-foo" />`
- **AND** the header bar shows `memon-manual-foo` and a `Pop out` button that opens `/terminal-popup?sessionName=memon-manual-foo`
- **AND** no stale warning banner SHALL be present

#### Scenario: Selecting a stale row mounts TerminalView in raw mode with a stale banner
- **GIVEN** a stale row `memon-claude-archived-proj--run--baz-...` where `archived-proj` is not in config (so `row.staleReason === 'unknown-project'`)
- **WHEN** the user clicks the row card
- **THEN** the right pane mounts `<TerminalView mode="raw" sessionName="memon-claude-archived-proj--run--baz-..." />`
- **AND** a stale warning banner SHALL render between the slim header bar and the iframe-host container
- **AND** the banner SHALL include the `AlertTriangle` icon, the text `Stale: unknown-project — memon links won't resolve. ttyd is still attached.`, and the full sessionName in `font-mono`
- **AND** the banner SHALL carry the amber palette (`bg-amber-100`/`dark:bg-amber-900/40`)
- **AND** the banner SHALL NOT have a close/dismiss button

#### Scenario: Switching from a stale row to a matchable row clears the banner
- **GIVEN** the right pane currently shows a stale session with the warning banner visible
- **WHEN** the user clicks a matchable row in the list
- **THEN** the previous `<TerminalView>` SHALL unmount
- **AND** a new `<TerminalView mode="standard" ...>` mounts for the matchable row
- **AND** the stale warning banner SHALL NOT be in the DOM

#### Scenario: Switching selected sessions unmounts the previous TerminalView
- **GIVEN** session `A` is selected and its `<TerminalView>` is mounted with `key="memon-..-A"`
- **WHEN** the user clicks row `B`
- **THEN** the previous `<TerminalView key="memon-..-A">` SHALL unmount, firing its existing cleanup effect (no zombie iframe in DOM)
- **AND** a new `<TerminalView key="memon-..-B">` SHALL mount with the right props
- **AND** the header bar's sessionName updates to B's full name

#### Scenario: Pop out from the right-pane header on a stale row carries the stale query param
- **GIVEN** a stale session is currently selected with `row.staleReason === 'unknown-target'`
- **WHEN** the user clicks `Pop out` in the right-pane header
- **THEN** a popup window opens at `/terminal-popup?sessionName=<encoded>&stale=unknown-target`
- **AND** the popup page renders the stale warning banner with the same shape as the inline banner
- **AND** the right pane's iframe is NOT torn down (the manager dedups concurrent attach calls for the same sessionName)

#### Scenario: Pop out from the right-pane header
- **GIVEN** session `memon-claude-project-a--run--foo-260507-103000` is currently selected
- **WHEN** the user clicks `Pop out` in the right-pane header
- **THEN** a popup window opens at the standard popup URL (`?project=project-a&scope=run&slug=foo-260507-103000&agent=claude`)
- **AND** the right pane's iframe is NOT torn down (so the user can have both windows attached to the same ttyd via the manager's dedup)

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

Stale classification SHALL NOT prevent the `Kill` action from working — `Kill` remains available on every row regardless of matchability. Manual classification SHALL NOT prevent `Kill` either.

Stale classification SHALL NOT prevent ttyd attach either: stale rows expose the same `Popup` icon button as manual rows and SHALL mount `<TerminalView mode="raw">` in the right pane when selected. The right pane and popup page SHALL render a stale warning banner (see the **Right pane renders inline terminal for the selected session** requirement) so the user understands that memon-side navigation links won't resolve while the underlying tmux session is still attachable. Manual rows and matchable rows are unaffected by the banner requirement.

The `Open in drawer` button has been REMOVED for every row category (the drawer-based primary surface was retired by the manage-tmux split change); its function is taken by clicking the card body to mount the inline right-pane terminal.

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

#### Scenario: Stale row Popup opens raw popup with stale query param
- **GIVEN** a stale row (`row.staleReason === 'unknown-project'`)
- **WHEN** the user clicks the row's icon-only `Popup` button
- **THEN** a popup window opens at `/terminal-popup?sessionName=<encoded>&stale=unknown-project`
- **AND** the popup page mounts `<TerminalView mode="raw">` for that sessionName
- **AND** the popup page renders the stale warning banner above the iframe

## ADDED Requirements

### Requirement: Terminal popup page renders a stale warning banner when stale query param is present

The `/terminal-popup` route SHALL accept an optional `stale=<reason>` query parameter alongside `sessionName=<name>`. When BOTH are present AND `<reason>` matches one of `unknown-project` / `unknown-target`, the popup page SHALL render a one-line stale warning banner ABOVE the `<TerminalView mode="raw" fullscreen />` iframe.

The banner SHALL:
- be a single horizontal `flex` row spanning the full viewport width,
- carry the amber palette (`bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`),
- include an `AlertTriangle` lucide icon at the leading edge,
- read `Stale: <reason> — memon links won't resolve. ttyd is still attached.`,
- include the sessionName in `font-mono` at the end of the line (truncating with ellipsis if it overflows the viewport width),
- NOT be dismissible — no close button, no localStorage state.

When `sessionName=` is present but `stale=` is absent or carries an unrecognized value, the popup page SHALL render only the iframe (no banner) — preserving the existing manual-popup behavior. When `sessionName=` is absent (standard-mode popup), the `stale=` param SHALL be ignored entirely.

The banner SHALL NOT consume vertical space inside the iframe; the iframe-host container SHALL still stretch to fill the remaining viewport height (e.g. via a `min-h-0 flex-1` flex child below a fixed-height banner row).

#### Scenario: Raw popup with stale=unknown-project renders the banner
- **GIVEN** the user opens `/terminal-popup?sessionName=memon-claude-archived--run--baz-...&stale=unknown-project`
- **WHEN** the page mounts
- **THEN** a one-line amber stale warning banner SHALL render at the top of the viewport
- **AND** the banner text SHALL be `Stale: unknown-project — memon links won't resolve. ttyd is still attached.`
- **AND** the banner SHALL include the sessionName in `font-mono`
- **AND** below the banner the `<TerminalView mode="raw" fullscreen />` iframe SHALL fill the remaining viewport height

#### Scenario: Raw popup with stale=unknown-target renders the banner
- **GIVEN** the user opens `/terminal-popup?sessionName=memon-claude-project-a--run--archived-...&stale=unknown-target`
- **WHEN** the page mounts
- **THEN** the banner text SHALL include the substring `Stale: unknown-target`

#### Scenario: Manual popup (no stale param) renders no banner
- **GIVEN** the user opens `/terminal-popup?sessionName=memon-manual-foo`
- **WHEN** the page mounts
- **THEN** NO stale warning banner SHALL render
- **AND** the `<TerminalView mode="raw" fullscreen />` iframe SHALL fill the full viewport

#### Scenario: Popup with invalid stale value ignores the banner
- **GIVEN** the user opens `/terminal-popup?sessionName=memon-manual-foo&stale=garbage`
- **WHEN** the page mounts
- **THEN** NO stale warning banner SHALL render
- **AND** the `<TerminalView mode="raw" fullscreen />` iframe SHALL fill the full viewport

#### Scenario: Standard-mode popup ignores stale param
- **GIVEN** the user opens `/terminal-popup?project=project-a&scope=run&slug=foo-...&agent=claude&stale=unknown-project`
- **WHEN** the page mounts
- **THEN** NO stale warning banner SHALL render
- **AND** `<TerminalView mode="standard" ...>` SHALL mount normally
