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
    - **Matchable**, **Manual**, AND **Stale** rows render exactly three actions in this left-to-right order: a `Rename` button, a `Popup` button, and a `Kill` button. Both the `Rename` and `Popup` buttons SHALL be hidden on viewports below the Tailwind `md` breakpoint (`hidden md:inline-flex`); the `Kill` button SHALL be visible at every viewport size so the destructive action remains reachable on mobile.
    - The `Open in drawer` button is REMOVED for every row category. Its function is replaced by clicking the card body to select the row.
    - All three buttons SHALL render as **icon-only** — the leading lucide icon is the only content (`Pencil` for Rename, `ExternalLink` for Popup, `Trash2` for Kill). The visible text labels `"Rename"` / `"Popup"` / `"Kill"` SHALL NOT be rendered. The buttons MUST carry `aria-label` attributes (`"Rename session"` / `"Open in popup"` / `"Kill session"`) for accessibility.
    - The `Rename` and `Popup` buttons SHALL each be wrapped in `<ViewerGuard reason="...">` so they are hidden / non-interactive for viewer-mode visitors, matching the existing `Kill` button's gating.

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
- For **Matchable**, **Manual**, AND **Stale** rows, clicking the card BODY (anywhere except the action buttons or any badge link) SHALL select that row. Action buttons SHALL stop propagation so clicking the icon-only `Rename`, `Popup`, or `Kill` does NOT change the selection. The scope/target badge link AND the project-badge link SHALL also stop propagation.
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
- **THEN** the `Rename` button SHALL contain ONLY the `Pencil` lucide icon — no `Rename` text child
- **AND** the `Popup` button (when present) SHALL contain ONLY the `ExternalLink` lucide icon — no `Popup` text child
- **AND** the `Kill` button SHALL contain ONLY the `Trash2` lucide icon — no `Kill` text child
- **AND** all three buttons SHALL carry an `aria-label` attribute (`"Rename session"` / `"Open in popup"` / `"Kill session"` respectively)

#### Scenario: Manual rows render Rename + Popup + Kill (no Drawer)
- **GIVEN** a manual row (e.g. `memon-manual-foo`)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly three icon-only buttons in this left-to-right order: `Rename`, `Popup`, `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open `/terminal-popup?sessionName=memon-manual-foo`

#### Scenario: Matchable rows render Rename + Popup + Kill (no Drawer)
- **GIVEN** a matchable row (`memon-claude-project-a--run--foo-260507-103000`)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly three icon-only buttons in this left-to-right order: `Rename`, `Popup`, `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open the standard popup URL with `project / scope / slug / agent` query params

#### Scenario: Stale rows render Rename + Popup + Kill and are selectable in raw mode
- **GIVEN** a stale row (e.g. `memon-claude-archived-proj--run--baz-...` where `archived-proj` is not in config)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly three icon-only buttons in this left-to-right order: `Rename`, `Popup`, `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open `/terminal-popup?sessionName=memon-claude-archived-proj--run--baz-...&stale=unknown-project`
- **AND** clicking the card body (or pressing Enter / Space when the card is focused) SHALL select the row and mount `<TerminalView mode="raw" sessionName={row.sessionName} />` in the right pane
- **AND** the card SHALL render with `opacity-75` AND `role="button"` AND `tabIndex={0}` AND `cursor-pointer`
- **AND** when selected the card SHALL also gain the `border-primary` outline (opacity stays at `0.75`)

#### Scenario: Rename and Popup buttons are hidden on mobile, Kill stays visible
- **GIVEN** the viewport is below the Tailwind `md` breakpoint
- **WHEN** any matchable, manual, or stale row renders
- **THEN** the `Rename` button SHALL carry class `hidden md:inline-flex` and not be visible
- **AND** the `Popup` button SHALL carry class `hidden md:inline-flex` and not be visible
- **AND** the `Kill` button SHALL remain visible (no `hidden` class)

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

#### Scenario: Rename button click does not change selection
- **GIVEN** session `A` is currently selected and session `B` is also visible
- **WHEN** the user clicks the `Rename` button on row `B`
- **THEN** session `A` SHALL remain selected (right pane stays on A's terminal)
- **AND** the Rename dialog opens with row B's sessionName pre-filled in the input

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

## ADDED Requirements

### Requirement: Rename dialog opens from the per-row Rename button on /manage/tmux

Clicking the per-row `Rename` icon-only button SHALL open a shadcn `Dialog` modal scoped to that row's sessionName. The dialog SHALL contain:

- A title `Rename tmux session`.
- A short description naming the current sessionName in `font-mono`.
- A single `<Input>` pre-filled with the current sessionName (the FULL `memon-...` form, not the stripped display title). The input SHALL be auto-focused on dialog open and SHALL select-all so the user can immediately type-replace.
- An inline validation message area below the input. Validation SHALL run on every keystroke and SHALL surface one of:
  - "" (empty / valid) — no message, submit enabled.
  - `must match memon-[A-Za-z0-9._-]+`
  - `same as current name`
  - any server error returned from a failed submit (e.g. `tmux session already exists`).
- A `Rename` submit button — disabled when client validation fails or when a submit is in flight (button text changes to `Renaming…` while in flight).
- A `Cancel` button that closes the dialog without firing the request.

Submitting the dialog SHALL `POST /api/tmux-sessions/<oldName>/rename` with body `{ newName }` where `<oldName>` is URL-encoded. On 200:
- The list query (`['tmux-sessions']`) SHALL be invalidated to force an immediate refetch.
- A `sonner` toast `renamed <old> → <new>` SHALL be shown.
- If `<oldName>` was the currently-selected session (URL `?session=<oldName>`), the URL SHALL be updated via `router.replace` to `?session=<newName>` so the right pane re-mounts attached to the new name. The right pane's `<TerminalView>` SHALL re-key on the new sessionName and re-call `POST /api/terminal/attach` for `<newName>` (the backend has already torn down the old ttyd entry, so a fresh ttyd is spawned).
- The dialog closes.

On 4xx error (validation, not-found, or conflict):
- The server error message SHALL be displayed in the inline validation area.
- The dialog SHALL NOT close.
- The list query SHALL NOT be invalidated (the source-of-truth state is unchanged).

On 5xx error:
- A toast SHALL surface the generic error message.
- The dialog stays open so the user can retry.

The dialog SHALL be auth-gated by `<ViewerGuard>` on the trigger button (viewer-mode visitors never see the Rename button).

#### Scenario: Dialog opens with pre-filled current name
- **GIVEN** a matchable row for `memon-claude-project-a--run--foo-260507-103000`
- **WHEN** the user clicks the `Rename` icon button on that row
- **THEN** a shadcn `Dialog` opens with title `Rename tmux session`
- **AND** the input is pre-filled with `memon-claude-project-a--run--foo-260507-103000`
- **AND** the input is auto-focused and its contents are selected
- **AND** the inline validation area is empty

#### Scenario: Submit triggers POST and updates selection
- **GIVEN** the Rename dialog is open for `memon-manual-old` and that row is the currently-selected session (URL is `/manage/tmux?session=memon-manual-old`)
- **WHEN** the user changes the input to `memon-manual-new` and clicks `Rename`
- **THEN** `POST /api/tmux-sessions/memon-manual-old/rename` fires with body `{ "newName": "memon-manual-new" }`
- **AND** the response is 200 `{ ok: true, sessionName: "memon-manual-new" }`
- **AND** the dialog closes
- **AND** a toast `renamed memon-manual-old → memon-manual-new` appears
- **AND** the list query is invalidated and the row reappears under its new name in the next render
- **AND** the URL becomes `/manage/tmux?session=memon-manual-new` via `router.replace`
- **AND** the right pane's `<TerminalView key="memon-manual-new" mode="raw" sessionName="memon-manual-new" />` re-mounts and attaches a fresh ttyd

#### Scenario: Invalid name shows inline validation and disables submit
- **GIVEN** the Rename dialog is open for `memon-manual-foo`
- **WHEN** the user clears the input and types `nopfx`
- **THEN** the inline validation area shows `must match memon-[A-Za-z0-9._-]+`
- **AND** the `Rename` submit button is disabled

#### Scenario: No-op rename (same name) is rejected client-side
- **GIVEN** the Rename dialog is open for `memon-manual-foo`
- **WHEN** the input contains exactly `memon-manual-foo` (unchanged)
- **THEN** the inline validation area shows `same as current name`
- **AND** the `Rename` submit button is disabled
- **AND** no HTTP request is fired

#### Scenario: Duplicate target shows server error and keeps dialog open
- **GIVEN** the Rename dialog is open for `memon-manual-foo`
- **AND** another tmux session `memon-manual-bar` already exists on the host
- **WHEN** the user changes the input to `memon-manual-bar` and clicks `Rename`
- **THEN** `POST /api/tmux-sessions/memon-manual-foo/rename` returns 409 `{ error: { code: "CONFLICT", message: "tmux session memon-manual-bar already exists" } }`
- **AND** the dialog stays open
- **AND** the inline validation area shows `tmux session memon-manual-bar already exists`
- **AND** the list query is NOT invalidated
- **AND** no toast is shown

#### Scenario: Cancel closes the dialog without firing a request
- **GIVEN** the Rename dialog is open with a modified input value
- **WHEN** the user clicks `Cancel`
- **THEN** the dialog closes
- **AND** no HTTP request is fired
- **AND** the underlying session is unchanged

### Requirement: POST /api/tmux-sessions/:name/rename renames a tmux session

The web backend SHALL expose `POST /api/tmux-sessions/:name/rename` with body `{ newName: string }` that renames an existing tmux session via `tmux rename-session -t <oldName> <newName>`.

The endpoint SHALL be classified as a `shell` route under `auth-system` (it executes a process), SHALL require owner Basic auth or session cookie, and SHALL refuse viewer-cookie auth.

Path validation:
- `<oldName>` (URL path param, URL-decoded) MUST match `^memon-[A-Za-z0-9._-]+$`. Otherwise the response is 400 `{ error: { code: "BAD_REQUEST", message: "name must match memon-[A-Za-z0-9._-]+" } }` and no `tmux` shell-out runs.

Body validation:
- `newName` MUST be a non-empty string matching `^memon-[A-Za-z0-9._-]+$`. Otherwise 400.
- `newName` MUST differ from `<oldName>`. Otherwise 400 `{ error: { code: "BAD_REQUEST", message: "newName must differ from oldName" } }`.

Pre-execution checks:
- The old session MUST exist on the host (`tmux has-session -t <oldName>` returns 0). Otherwise 404 `{ error: { code: "NOT_FOUND", message: "tmux session not found" } }`.
- The new name MUST NOT already exist on the host (`tmux has-session -t <newName>` returns non-0). Otherwise 409 `{ error: { code: "CONFLICT", message: "tmux session <newName> already exists" } }`.

Execution sequence (in order):
1. If the terminal manager has a live ttyd entry under `<oldName>`, call `stopSession(<oldName>)` to tear it down. Errors from `stopSession` SHALL be caught and logged but SHALL NOT prevent the rename from proceeding.
2. Run `tmux rename-session -t <oldName> <newName>`. On non-0 exit, return 500 `{ error: { message: "<stderr>" } }`.
3. On success, return 200 `{ ok: true, sessionName: "<newName>" }`.

The endpoint SHALL NOT touch on-disk memon artefacts. Renaming a `memon-<agent>-<project>--<scope>--<slug>` session does NOT rename the corresponding run dir / exp doc.

#### Scenario: Successful rename
- **GIVEN** the host has session `memon-manual-old` AND no session `memon-manual-new` exists
- **WHEN** an authenticated owner `POST`s to `/api/tmux-sessions/memon-manual-old/rename` with body `{ "newName": "memon-manual-new" }`
- **THEN** `tmux rename-session -t memon-manual-old memon-manual-new` runs and exits 0
- **AND** the response is 200 with body `{ "ok": true, "sessionName": "memon-manual-new" }`
- **AND** subsequent `GET /api/tmux-sessions` lists `memon-manual-new` and NOT `memon-manual-old`

#### Scenario: Live ttyd is torn down before rename
- **GIVEN** the manager holds a live ttyd entry for `memon-manual-old` on port 7683
- **WHEN** the rename endpoint fires
- **THEN** the manager's entry under `memon-manual-old` is removed BEFORE `tmux rename-session` runs
- **AND** after the rename, `lookupSession("memon-manual-old")` returns `null`
- **AND** the next `POST /api/terminal/attach { sessionName: "memon-manual-new" }` spawns a fresh ttyd entry for the new name

#### Scenario: Old name not found
- **WHEN** an owner `POST`s `/api/tmux-sessions/memon-manual-ghost/rename` with `{ newName: "memon-manual-x" }` and no `memon-manual-ghost` exists on the host
- **THEN** the response is 404 with `{ error: { code: "NOT_FOUND", message: "tmux session not found" } }`
- **AND** no `tmux rename-session` runs

#### Scenario: New name already exists (conflict)
- **GIVEN** sessions `memon-manual-foo` AND `memon-manual-bar` BOTH exist on the host
- **WHEN** an owner `POST`s `/api/tmux-sessions/memon-manual-foo/rename` with `{ newName: "memon-manual-bar" }`
- **THEN** the response is 409 with `{ error: { code: "CONFLICT", message: "tmux session memon-manual-bar already exists" } }`
- **AND** no `tmux rename-session` runs
- **AND** the manager's entry for `memon-manual-foo` is NOT torn down

#### Scenario: Empty newName rejected
- **WHEN** an owner `POST`s `/api/tmux-sessions/memon-manual-foo/rename` with `{ newName: "" }`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "newName must match memon-[A-Za-z0-9._-]+" } }`

#### Scenario: newName without memon- prefix rejected
- **WHEN** the body is `{ newName: "nopfx" }`
- **THEN** the response is 400 with a message mentioning the `memon-` prefix requirement

#### Scenario: newName equal to oldName rejected
- **WHEN** the body is `{ newName: "memon-manual-foo" }` and the path is `/api/tmux-sessions/memon-manual-foo/rename`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "newName must differ from oldName" } }`

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client `POST`s `/api/tmux-sessions/<n>/rename`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`
- **AND** no `tmux rename-session` runs

#### Scenario: Viewer cookie rejected
- **WHEN** a request bearing only a `memon-shares` viewer cookie hits the endpoint
- **THEN** the response is 401 (the route is `shell`-classified and viewer cookies do not authenticate shell routes)
- **AND** no `tmux rename-session` runs

#### Scenario: Path param fails name regex
- **WHEN** the URL path is `/api/tmux-sessions/not-a-memon-prefix/rename`
- **THEN** the response is 400 with `{ error: { code: "BAD_REQUEST", message: "name must match memon-[A-Za-z0-9._-]+" } }`
- **AND** no `tmux` shell-out runs
