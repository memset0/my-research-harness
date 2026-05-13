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

The page SHALL fetch the session list from `GET /api/tmux-sessions`. The list SHALL be auto-refreshed every 5 seconds while the page is visible, with a manual refresh button to force an immediate refetch. Auto-refetch SHALL update per-row content (live ttyd port, last-activity timestamp, status badges) but SHALL NOT reorder the list — see the **Stable client-side ordering** requirement.

The page SHALL expose a `New session` button at the top of the left pane that opens a Dialog with a text input for the session name. Submitting the dialog SHALL `POST /api/tmux-sessions { name }` and, on success, invalidate the list query so the row appears immediately. A toast SHALL communicate the outcome ("created `memon-manual-<name>`" vs "joined existing `memon-manual-<name>`" based on `alreadyExisted`).

The page SHALL render as a two-pane resizable layout (not a table):
- A **left pane** containing the session list and the header controls (filter tabs, `New session`, `Refresh`).
- A **right pane** showing the inline terminal for the currently-selected session, or an empty-state placeholder when none is selected.
- A draggable **divider** between the panes. The user SHALL be able to resize the split by mouse drag, touch drag, or keyboard (arrow keys when the handle is focused), per the underlying `react-resizable-panels` primitive.

On viewports `>= 768px` (the Tailwind `md` breakpoint) the panel orientation SHALL be horizontal (list left, terminal right). On viewports `< 768px` the orientation SHALL be vertical (list top, terminal bottom). The same `ResizablePanelGroup` SHALL be reused with `direction` switched based on the viewport; no separate component tree per orientation.

The list pane SHALL provide three filter tabs: `All`, `Active in memon`, `Stale`. The default filter is `All`. `Active in memon` shows only rows where the manager has a live ttyd entry. `Stale` shows only rows whose `staleReason` is non-null (manual rows do NOT appear under the `Stale` tab).

Each row SHALL render as a clickable card (NOT a table cell). The card SHALL contain:

- A **title** that is the session name with the universal `memon-` prefix stripped AND any of `manual-` / `project-` / `exp-` / `run-` stripped if present immediately after `memon-`. Examples:
  - `memon-manual-foo` renders as title `foo`.
  - `memon-claude-project-a--run--foo-260507-103000` renders as title `claude-project-a--run--foo-260507-103000`.
  - `memon-claude-foo-260507-103000` (legacy format) renders as title `claude-foo-260507-103000`.

- A **last activity** label (relative time, e.g. `5m ago`), formatted exactly as today.

- A row of **inline metadata badges**. Each badge SHALL include a `lucide-react` icon at its leading edge (size class `size-3`), and each badge type SHALL carry a category-specific color treatment. Badges SHALL be rendered ONLY when their corresponding value is non-null (i.e. the previous table layout would have shown a value other than `—`). The render order, when all are present, is: ttyd port → agent → project → scope/target. Per-badge rules:

  - **ttyd port badge** (when `row.liveEntry !== null`):
    - leading glyph: a small emerald dot (a `size-1.5` round span with `bg-emerald-500`). No icon font.
    - content: `:<port>` (e.g. `:7683`). No prefix label.
    - style: muted background, NO border. Text in emerald (`text-emerald-700` / `dark:text-emerald-300`). The dot is the only visual signal that a ttyd is bound; removing the badge entirely communicates "no ttyd".

  - **Agent badge** (when `parsed.agent !== null` AND `parsed.agent !== 'none'`):
    - icon: `Bot` (lucide).
    - content: the literal prefix word `Agent` followed by `parsed.agent` (e.g. `Agent claude`, `Agent codex`).
    - style: orange color family (bg/text/border in the orange palette, with a `dark:` variant for the dark theme).

  - **Project badge** (when `parsed.project !== null` AND `parsed.scope !== 'project'`):
    - icon: `Folder` (lucide).
    - content: the project name (e.g. `project-a`). No prefix label (the project name alone is unambiguous, and a literal prefix would crowd the adjacent colored scope/target badge).
    - style: muted (neutral) color, matching the existing muted-chip treatment.
    - Suppressed for `parsed.scope === 'project'` rows because the scope/target badge already names the project.

  - **Scope/target badge** (one of six variants, replacing the prior standalone uppercase category chip plus separate target link):
    - For `scope: 'run'` matchable rows: icon `Zap`, content `Run <slug>` (e.g. `Run foo-260507-103000`), emerald color, rendered as a `<Link>` to `/p/<project>/r/<slug>`.
    - For `scope: 'exp'` matchable rows: icon `FlaskConical`, content `Exp <slug>` (e.g. `Exp E0042-bar`), sky color, rendered as a `<Link>` to `/p/<project>/e/<slug>`.
    - For `scope: 'project'` matchable rows: icon `FolderTree`, content `Project <project>` (e.g. `Project project-a`), violet color, rendered as a `<Link>` to `/p/<project>`.
    - For **manual** rows (sessionName matches `^memon-manual-` AND `parsed.scope === null` AND `staleReason === null`): icon `Wrench`, content `Manual`, amber color. NOT a link.
    - For **legacy** rows (`parsed.legacy === true` AND none of the above match): icon `Archive`, content `Legacy`, muted color. NOT a link.
    - For **stale** rows (`row.staleReason !== null`): icon `AlertTriangle`, content `Stale (<reason>)`, amber color (or `destructive` if dark). NOT a link.
    
    All clickable scope/target variants (run / exp / project) SHALL be rendered with `target="_blank"` and `rel="noopener noreferrer"` so the target page opens in a new browser tab. Clicking the badge SHALL NOT bubble up to the card's row-selection handler — the badge anchor SHALL call `event.stopPropagation()` to keep the right pane attached to the currently-selected session.

  - The prefix label words used by the three user-listed badge types — `Agent`, `Exp`, `Run` — SHALL render in Title Case (one capital, rest lowercase) and in `font-medium`; the trailing value SHALL render in `font-mono`. The mixed weight + family lets the prefix read as a label and the value as the addressable identifier.

  - A standalone uppercase category chip (e.g. a leading `RUN` / `EXP` / `MANUAL` chip) SHALL NOT be rendered. The scope/target badge above carries the category signal via its color and prefix label.

- An **actions** group, right-aligned on the card. Action buttons depend on row classification:
  - **Matchable** and **Manual** rows render exactly two actions: `Popup` and `Kill`. The `Popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint (`hidden md:inline-flex`).
  - **Stale** rows render only `Kill`. `Popup` is omitted (consistent with the existing `manage-tmux-stale-no-open` decision).
  - The `Open in drawer` button is REMOVED for every row category. Its function is replaced by clicking the card body to select the row.

Click handling on each row card:
- For **Matchable** and **Manual** rows, clicking the card BODY (anywhere except the action buttons or the scope/target badge link) SHALL select that row. Action buttons SHALL stop propagation so clicking `Popup` or `Kill` does NOT change the selection. The scope/target badge link SHALL also stop propagation so clicking the link to open a new tab does NOT change the selection.
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

#### Scenario: memon-manual- secondary prefix is stripped from row titles
- **GIVEN** the host has session `memon-manual-foo`
- **WHEN** the row renders
- **THEN** the card title text SHALL be `foo` (both `memon-` and `manual-` stripped)
- **AND** the scope/target badge SHALL be the `Manual` variant (icon `Wrench`, amber color, no link)

#### Scenario: Run target badge renders with prefix label, icon, color, and new-tab link
- **GIVEN** the host has session `memon-claude-project-a--run--foo-260507-103000` and `project-a` resolves on disk
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL contain the `Zap` icon, the literal prefix `Run`, and the value `foo-260507-103000`
- **AND** the badge SHALL be rendered with the emerald color family (e.g. `bg-emerald-100` light / `dark:bg-emerald-900/40` dark)
- **AND** the badge SHALL be an anchor with `href="/p/project-a/r/foo-260507-103000"`, `target="_blank"`, and `rel="noopener noreferrer"`

#### Scenario: Exp target badge renders with prefix label, icon, color, and new-tab link
- **GIVEN** the host has session `memon-claude-project-a--exp--E0042-bar` and the exp doc exists
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL contain the `FlaskConical` icon, the prefix `Exp`, and value `E0042-bar`
- **AND** the badge SHALL be rendered in the sky color family
- **AND** the badge SHALL be an anchor with `href="/p/project-a/e/E0042-bar"`, `target="_blank"`, `rel="noopener noreferrer"`

#### Scenario: Project-scope target badge renders with prefix label, icon, color, and new-tab link
- **GIVEN** the host has session `memon-claude-project-a--project--root` and `project-a` is in config
- **WHEN** the row renders
- **THEN** the scope/target badge SHALL contain the `FolderTree` icon, the prefix `Project`, and the value `project-a`
- **AND** the badge SHALL be rendered in the violet color family
- **AND** the badge SHALL be an anchor with `href="/p/project-a"`, `target="_blank"`, `rel="noopener noreferrer"`
- **AND** no separate `Folder` project badge SHALL appear on the same row

#### Scenario: ttyd port badge renders with an emerald dot and no icon font
- **GIVEN** the host has session `memon-claude-project-a--run--foo-...` with a live ttyd on port 7683
- **WHEN** the row renders
- **THEN** the row SHALL contain a port badge whose leading glyph is a small emerald-filled circle (e.g. `bg-emerald-500` on a `size-1.5 rounded-full` span)
- **AND** the badge's content SHALL read `:7683` in monospace, in an emerald foreground color
- **AND** the badge SHALL NOT carry any colored border
- **AND** the badge's background SHALL be the muted color used by neutral chips
- **AND** the badge SHALL NOT render the `Plug` lucide icon (the dot is the entire leading visual)

#### Scenario: Agent badge renders with bot icon and Agent prefix
- **GIVEN** the host has session `memon-claude-project-a--run--foo-...` where the parsed agent is `claude`
- **WHEN** the row renders
- **THEN** the agent badge SHALL contain the `Bot` icon, the literal prefix `Agent`, and the value `claude`
- **AND** the badge SHALL be rendered in the orange color family

#### Scenario: Project badge renders with folder icon and NO prefix
- **GIVEN** a matchable row with `scope: 'run'` and `parsed.project === 'project-a'`
- **WHEN** the row renders
- **THEN** the project badge SHALL contain the `Folder` icon and the value `project-a`
- **AND** the badge SHALL NOT carry a `Project` prefix word (the project name alone is the content)
- **AND** the badge SHALL render in the muted color family (no per-project color variation)

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

#### Scenario: Inline badges are omitted when their value is null (badge structure unchanged from prior behavior)
- **GIVEN** the host has session `memon-manual-foo` with NO live ttyd entry
- **WHEN** the row renders
- **THEN** no port badge SHALL be present (no `liveEntry`)
- **AND** no agent badge SHALL be present (manual row has no parsed agent)
- **AND** no project badge SHALL be present (manual row has no parsed project)
- **AND** the scope/target badge SHALL be the `Manual` variant (icon `Wrench`, amber, no link)

#### Scenario: Inline badges render fully for an active matchable row
- **GIVEN** the host has session `memon-claude-project-a--run--foo-260507-103000`, the manager holds a live ttyd entry on port 7683 for it, and `project-a` resolves on disk
- **WHEN** the row renders
- **THEN** the card SHALL contain badges in this order: port (`:7683` with `Plug` icon and emerald border), agent (`Agent claude` with `Bot` icon in orange), project (`project-a` with `Folder` icon in muted), and scope/target (`Run foo-260507-103000` with `Zap` icon in emerald, anchor to `/p/project-a/r/foo-260507-103000` opening in a new tab)
- **AND** no standalone uppercase category chip (e.g. `[RUN]` alone) SHALL be rendered

#### Scenario: Clicking a target-badge link opens a new tab and does not change selection
- **GIVEN** a matchable row for `memon-claude-project-a--run--foo-...` and an unrelated session `Y` is currently selected (right pane shows Y's terminal)
- **WHEN** the user clicks the `Run foo-...` target badge on the matchable row
- **THEN** a new browser tab opens at `/p/project-a/r/foo-...`
- **AND** the current `/manage/tmux` tab stays on the page
- **AND** session `Y` remains selected (the right pane stays on Y's terminal — clicking the badge does NOT propagate to the card's select handler)

#### Scenario: Manual rows render Popup + Kill only (no Drawer)
- **GIVEN** a manual row (e.g. `memon-manual-foo`)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly two buttons: `Popup` and `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open `/terminal-popup?sessionName=memon-manual-foo`

#### Scenario: Matchable rows render Popup + Kill only (no Drawer)
- **GIVEN** a matchable row (`memon-claude-project-a--run--foo-260507-103000`)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly two buttons: `Popup` and `Kill`
- **AND** no `Drawer` button SHALL be present in the DOM
- **AND** clicking `Popup` SHALL open the standard popup URL with `project / scope / slug / agent` query params

#### Scenario: Stale rows render Kill only and are non-selectable
- **GIVEN** a stale row (e.g. `memon-claude-archived-proj--run--baz-...` where `archived-proj` is not in config)
- **WHEN** the row renders
- **THEN** the actions group SHALL contain exactly one button: `Kill`
- **AND** no `Popup` or `Drawer` button SHALL be present in the DOM
- **AND** clicking the card body SHALL NOT change the selected session

#### Scenario: Popup button on mobile is hidden for matchable and manual rows
- **GIVEN** the viewport is below the Tailwind `md` breakpoint
- **WHEN** any matchable or manual row renders
- **THEN** the `Popup` button SHALL carry class `hidden md:inline-flex` and not be visible

#### Scenario: Clicking a matchable row card selects that session
- **GIVEN** a matchable row in the left pane and no session currently selected
- **WHEN** the user clicks the card body (not an action button or the target badge link)
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

### Requirement: Selected session is reflected in the URL

The `/manage/tmux` page SHALL reflect the currently-selected session in the URL as the query parameter `?session=<sessionName>`. The parameter value SHALL be the FULL session name including the `memon-` prefix (not the stripped display title).

The page SHALL:
- On mount, read `?session=` from the URL. If the named session exists in the current list, set it as the selected session. Otherwise ignore the param.
- On selection change (user click on a row), update the URL via `router.replace` (not `push`) so accumulated row-pick clicks do NOT pollute browser history.
- On Kill of the currently-selected session, remove the `?session=` param.
- If the list refetches and the selected session is no longer present, clear the selection AND remove the `?session=` param via `router.replace`.

The page SHALL URL-encode the sessionName when writing to the URL and URL-decode when reading. SessionNames contain characters (`-`, `--`) that are safe in URLs, but encoding is applied unconditionally for safety.

#### Scenario: Refresh restores the selected session
- **GIVEN** the user is on `/manage/tmux?session=memon-claude-project-a--run--foo-260507-103000` and the session exists in the list
- **WHEN** the browser refreshes
- **THEN** after rehydration the right pane mounts the same terminal
- **AND** the corresponding row in the left pane renders with the selected styling

#### Scenario: Clicking a row updates the URL without pushing history
- **GIVEN** the user is on `/manage/tmux` with no selection
- **WHEN** the user clicks row `A` then row `B` then row `C`
- **THEN** the URL ends at `/manage/tmux?session=<C>`
- **AND** the browser's back button returns to whatever page preceded `/manage/tmux`, NOT to `?session=<B>` or `?session=<A>`

#### Scenario: Deep link to a non-existent session falls back to no selection
- **GIVEN** the URL is `/manage/tmux?session=memon-manual-doesnotexist` and that session is not in the current list
- **WHEN** the page mounts
- **THEN** the right pane shows the empty-state placeholder
- **AND** the `?session=` param SHALL be removed from the URL via `router.replace`

#### Scenario: Killing the selected session clears the URL param
- **GIVEN** the URL is `/manage/tmux?session=memon-manual-foo` and the right pane is mounted
- **WHEN** the user clicks `Kill` on that row and confirms
- **THEN** the row disappears, the right pane returns to empty state
- **AND** the URL becomes `/manage/tmux` (no query string)

### Requirement: Split-pane sizes persist in localStorage

The `/manage/tmux` page SHALL persist the split-pane sizes across reloads using `localStorage`. The storage key SHALL be `memon:manage-tmux:split-sizes`. The stored value SHALL be a JSON array of numbers summing to 100 (the same format `react-resizable-panels` uses for `defaultSize`).

The page SHALL:
- On mount, read the stored sizes. If present and valid (object whose values are numbers in [0, 100] keyed by the panel ids), use them as the initial layout. If absent or invalid, use the default split: **1:2** on desktop (`{ list: 33, terminal: 67 }`) and **1:1** on mobile (`{ list: 50, terminal: 50 }`).
- On layout change (the panel group's `onLayout` callback), debounce by ~250ms and write the new sizes to `localStorage`.
- If `localStorage` is unavailable (private mode, sandboxed iframe), fall back to in-memory state. The sizes are still applied for the current visit; they just don't persist.

A single key is used for both orientations. After rotating between desktop and mobile orientations, the previously-saved sizes are applied; the user can drag once and the new sizes get saved.

#### Scenario: Pane sizes survive a reload
- **GIVEN** the user drags the divider so the left pane is 40% wide and the right pane is 60%
- **WHEN** the user refreshes the page
- **THEN** the pane sizes after reload are 40 / 60
- **AND** the `localStorage` value at `memon:manage-tmux:split-sizes` is `[40, 60]`

#### Scenario: Default desktop split applies on first visit
- **GIVEN** `memon:manage-tmux:split-sizes` is absent from `localStorage` and the viewport is desktop
- **WHEN** the user opens `/manage/tmux` for the first time
- **THEN** the initial split is 33 / 67 (1:2)

#### Scenario: Default mobile split applies on first visit
- **GIVEN** `memon:manage-tmux:split-sizes` is absent and the viewport is below `md`
- **WHEN** the user opens `/manage/tmux`
- **THEN** the initial split is 50 / 50 (1:1, vertical orientation)

#### Scenario: Corrupted localStorage value falls back to default
- **GIVEN** `localStorage.memon:manage-tmux:split-sizes` is `"not json"` or missing a panel id key
- **WHEN** the page mounts
- **THEN** the default split applies and the corrupted value is overwritten on the next layout change

### Requirement: Stable client-side ordering of the session list

The `/manage/tmux` page SHALL maintain a stable visual ordering of session rows across the 5-second auto-refetch cycle, so the user can pick and manage sessions without rows shifting underneath the cursor. The order is **re-snapshotted from the API response** (which is sorted by `tmuxLastActivity` descending) only in three situations:

1. **First load** — on initial mount, the client adopts the API's order as its snapshot.
2. **A new sessionName appears** in the refetched response that was not in the previous snapshot — the entire client order is reset to the new API response order.
3. **The user clicks the manual `Refresh` button** — the client re-snapshots after the refetch completes, regardless of whether new sessions appeared.

Between these events, the client SHALL:
- Render each refetched row's content (relative time-ago, live ttyd port, badges) in fresh form — only the **order** is frozen, not the data.
- Drop rows from the snapshot when their sessionName is no longer present in the latest API response (e.g. after a kill). Removal SHALL preserve the relative order of remaining rows.

The order snapshot SHALL be in-memory only (not persisted to localStorage or URL). Reloading the page falls back to the API's `tmuxLastActivity desc` order on first paint.

#### Scenario: Auto-refresh does not reorder existing rows
- **GIVEN** the visible list is `[A, B, C, D]` in that order
- **WHEN** 5 seconds pass and the auto-refetch fires, returning the same four sessions but with `C` now having the most recent activity (which would sort it to the top in the API response)
- **THEN** the rendered order remains `[A, B, C, D]`
- **AND** row `C`'s last-activity badge updates to reflect the newer timestamp

#### Scenario: A new session triggers a full re-snapshot
- **GIVEN** the visible list is `[A, B, C]` and the user just created a new session `D` via the `New session` dialog
- **WHEN** the next refetch returns `[D, A, B, C]` (D is newest, ordered first by the API)
- **THEN** the rendered order updates to `[D, A, B, C]` (full re-snapshot from API)

#### Scenario: A kill removes the row but preserves order of the rest
- **GIVEN** the visible list is `[A, B, C, D]`
- **WHEN** the user kills `B` (and confirms) and the refetch returns `[A, C, D]`
- **THEN** the rendered order is `[A, C, D]`
- **AND** the relative order of `A`, `C`, `D` is preserved (no full re-snapshot)

#### Scenario: Manual Refresh re-snapshots even without new sessions
- **GIVEN** the visible list is `[A, B, C]` and during the 5s polling some rows' last-activity timestamps changed (but no new sessions appeared)
- **WHEN** the user clicks the `Refresh` button
- **THEN** the refetch is forced AND on completion the client SHALL re-snapshot the order from the API response — if the API now sorts the rows as `[C, A, B]` by latest activity, the rendered order updates to `[C, A, B]`

#### Scenario: Page reload falls back to API order
- **GIVEN** the user has a stable in-memory order `[A, B, C]` (no longer matches the API's activity-desc order)
- **WHEN** the user reloads the page
- **THEN** the initial render uses the fresh API response order (which is activity-desc), NOT the prior in-memory snapshot (which was not persisted)

### Requirement: Right pane renders inline terminal for the selected session

The right pane of `/manage/tmux` SHALL render one of:
1. An **empty-state placeholder** when no session is selected (centered text "Select a session from the list" plus a brief hint).
2. The existing `<TerminalView>` component, attached to the currently-selected session, in either `standard` or `raw` mode depending on the row's matchability.

The right pane SHALL include a slim **header bar** ABOVE the `<TerminalView>` iframe when a session is selected, showing:
- The full (unstripped) session name in monospace.
- A `Pop out` button that opens the same `/terminal-popup` URL the per-row `Popup` button would (standard query shape for matchable, `?sessionName=` for manual).

The `<TerminalView>` SHALL be keyed on `sessionName` (`key={sessionName}` on the JSX element) so that switching the selected row tears down the previous instance (firing its cleanup effect) and mounts a fresh instance for the new session. This guarantees:
- The previous iframe is removed from the DOM (no zombie connections).
- The new start/attach effect fires for the new sessionName.

`<TerminalView>` mode dispatch:
- Matchable row (`row.matchable === true`): mode is `standard`, wired to `row.parsed.project / scope / slug / agent`. The component internally calls `POST /api/terminal/start`.
- Manual row (`row.matchable === false && row.staleReason === null`): mode is `raw`, wired to `row.sessionName`. The component internally calls `POST /api/terminal/attach`.
- Stale row: NEVER selectable, so no terminal mount path applies.

The right-pane container SHALL be `flex flex-col h-full min-h-0` so the iframe stretches to fill the pane and the iframe scrolls internally rather than the page scrolling.

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

#### Scenario: Selecting a manual row mounts TerminalView in raw mode
- **GIVEN** a manual row for `memon-manual-foo`
- **WHEN** the user clicks the row card
- **THEN** the right pane mounts `<TerminalView mode="raw" sessionName="memon-manual-foo" />`
- **AND** the header bar shows `memon-manual-foo` and a `Pop out` button that opens `/terminal-popup?sessionName=memon-manual-foo`

#### Scenario: Switching selected sessions unmounts the previous TerminalView
- **GIVEN** session `A` is selected and its `<TerminalView>` is mounted with `key="memon-..-A"`
- **WHEN** the user clicks row `B`
- **THEN** the previous `<TerminalView key="memon-..-A">` SHALL unmount, firing its existing cleanup effect (no zombie iframe in DOM)
- **AND** a new `<TerminalView key="memon-..-B">` SHALL mount with the right props
- **AND** the header bar's sessionName updates to B's full name

#### Scenario: Stale rows do not mount the terminal
- **GIVEN** a stale row in the list
- **WHEN** the user clicks the stale row's card body
- **THEN** no `<TerminalView>` is mounted
- **AND** the right pane stays on whatever it showed before (empty state, or a previously-selected session's terminal)

#### Scenario: Pop out from the right-pane header
- **GIVEN** session `memon-claude-project-a--run--foo-260507-103000` is currently selected
- **WHEN** the user clicks `Pop out` in the right-pane header
- **THEN** a popup window opens at the standard popup URL (`?project=project-a&scope=run&slug=foo-260507-103000&agent=claude`)
- **AND** the right pane's iframe is NOT torn down (so the user can have both windows attached to the same ttyd via the manager's dedup)

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

### Requirement: Server-side pane-info enrichment with bounded shell-out cost

The web backend SHALL maintain a server-side helper that enriches every
row returned by `listMemonTmuxSessions` with a `pane` field carrying the
active pane's `title`, `currentCommand`, and `currentPath`. The data
SHALL be sourced from one `tmux list-panes -a -F …` shell-out per
refresh, filtered to rows where `window_active = 1 AND pane_active = 1`.

The format string SHALL be (in this exact order, with `pane_title` last
so embedded `|` characters in the title don't break the parser):

```
#{session_name}|#{window_active}|#{pane_active}|#{pane_pid}|#{pane_current_command}|#{pane_current_path}|#{pane_title}
```

The parser SHALL split each line on `|` and rejoin all tokens past
position 6 with `|` to reconstruct titles containing the delimiter.

A short-lived in-process cache SHALL deduplicate concurrent shell-outs
within the same refresh window. The cache TTL SHALL be 800 milliseconds.
The cache slot SHALL be pinned on `globalThis` (matching the existing
`__memonTerminalState` pattern in `manager.ts`) so Next.js HMR reloads
do not drop in-flight pane data.

When tmux is unavailable, the shell-out fails, the format result is
empty, or no pane row matches a sessionName, the enrichment helper
SHALL fall back to `pane: null` for the affected row(s) and SHALL NOT
throw. `listMemonTmuxSessions` continues to return the original row
list with pane info set to `null` where missing.

The server SHALL truncate `pane.title` to 256 characters (with a `…`
suffix when truncated) before serialization. The server SHALL replace
embedded newline / carriage-return characters in `pane.title` with a
single space, defensively, even though tmux normally strips control
characters from titles.

#### Scenario: Single shell-out enriches every row
- **GIVEN** the host has three `memon-*` sessions, each with one active pane
- **WHEN** `listMemonTmuxSessions(rt)` runs
- **THEN** exactly one `tmux list-panes -a -F …` shell-out is invoked (in addition to the existing `tmux ls`)
- **AND** each returned row carries a `pane: { title, currentCommand, currentPath }` matching that session's active-window active-pane data

#### Scenario: Cache deduplicates concurrent enrichments
- **GIVEN** the host has at least one `memon-*` session and the pane cache is empty
- **WHEN** two `listMemonTmuxSessions(rt)` calls fire within the same 100 ms window
- **THEN** exactly one `tmux list-panes -a -F …` shell-out happens; the second call reads from cache
- **AND** both calls receive the same `pane` payload for matching rows

#### Scenario: Cache expires after 800 ms
- **GIVEN** the pane cache was populated at time T
- **WHEN** a new enrichment call arrives at time T + 900 ms
- **THEN** a fresh `tmux list-panes -a -F …` shell-out is invoked and the cache slot is overwritten

#### Scenario: tmux daemon down returns null pane info, not error
- **WHEN** `tmux list-panes -a` exits non-zero (daemon not running, or no panes on host)
- **THEN** `listMemonTmuxSessions` continues to return the existing row list
- **AND** every row's `pane` field is `null`
- **AND** no exception is propagated

#### Scenario: Title containing pipe character is preserved verbatim
- **GIVEN** an active pane whose `pane_title` is the literal string `a|b|c`
- **WHEN** the enrichment helper parses the `list-panes` output
- **THEN** the row's `pane.title` is exactly `a|b|c`

#### Scenario: Title exceeding 256 chars is truncated with ellipsis
- **GIVEN** a pane whose `pane_title` is 300 ASCII characters long
- **WHEN** enrichment returns
- **THEN** `pane.title.length === 257` (256 source chars truncated to 256 + a single `…` suffix)
- **AND** the last character of `pane.title` is `…`

#### Scenario: Newlines in title are replaced with spaces
- **GIVEN** a pane whose `pane_title` contains an embedded `\n`
- **WHEN** enrichment returns
- **THEN** the `\n` in `pane.title` has been replaced with a single space character

#### Scenario: Only the active window's active pane is included
- **GIVEN** a tmux session `memon-claude-project-a--run--foo-...` has two windows; window 0 is inactive with one pane, window 1 is active with two panes (pane 1 active)
- **WHEN** the enrichment helper parses `list-panes -a`
- **THEN** only the data for window 1 / pane 1 is associated with the session
- **AND** the row's `pane.currentCommand` reflects window 1's active pane

### Requirement: TmuxSessionRow carries pane info on the wire

The shape of each row returned by `GET /api/tmux-sessions` SHALL be
extended with the optional field:

```ts
pane: {
  /** PTY-protocol window title set by the foreground program. Truncated to ≤256+1 chars. */
  title: string | null
  /** Basename of the foreground process (e.g. `claude`, `bash`, `node`). */
  currentCommand: string | null
  /** Absolute cwd of the foreground process. */
  currentPath: string | null
} | null
```

A row's `pane` field SHALL be `null` when:
- tmux returned no active pane for that session, OR
- the `list-panes` shell-out failed, OR
- the enrichment helper was unable to identify which pane is active.

A row's `pane` field SHALL be an object (with possibly-null nested
fields) when any pane data was successfully fetched.

#### Scenario: Active session surfaces full pane payload
- **GIVEN** a memon-* tmux session whose active pane has command `claude`, path `/path/to/run-dir`, and title `✻ Claude — Building digest…`
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row carries `pane: { currentCommand: 'claude', currentPath: '/path/to/run-dir', title: '✻ Claude — Building digest…' }`

#### Scenario: Manual session with bare shell surfaces shell as command
- **GIVEN** a memon-manual-foo session whose active pane is running `bash` with no OSC title set
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** the corresponding row carries `pane: { currentCommand: 'bash', currentPath: <some-path>, title: <hostname-or-similar> }`

#### Scenario: Session with no pane info surfaces null
- **GIVEN** the host's tmux is reachable for `tmux ls` but `tmux list-panes -a` fails (e.g. permissions race)
- **WHEN** `GET /api/tmux-sessions` runs
- **THEN** every row's `pane` field is `null` and the response still returns 200

#### Scenario: Backward-compatible response shape
- **GIVEN** an older client that does not read the `pane` field
- **WHEN** the client deserializes the API response
- **THEN** the existing top-level fields (`sessionName`, `parsed`, `liveEntry`, `tmuxCreatedAt`, `tmuxLastActivity`, `matchable`, `staleReason`) remain present and have the same shape and types

### Requirement: GET /api/tmux-sessions/:name returns a single enriched row

The web backend SHALL expose `GET /api/tmux-sessions/:name` returning
`{ row: TmuxSessionRow }` for the named session, using the same
enrichment helper and cache as `GET /api/tmux-sessions`. The `:name`
parameter SHALL be URL-decoded before validation.

Validation rules:
- `:name` SHALL match `^memon-[A-Za-z0-9._-]+$`. Reject with 400 if
  not.
- After validation, the server SHALL attempt to find the named row in
  the enriched inventory. If absent (no matching `memon-*` session on
  the host), respond with 404 + `{ error: { code: 'NOT_FOUND',
  message } }`.

Auth: the endpoint SHALL be classified as a `shell`-class route under
`auth-system`, matching the existing classification of the prefix
`/api/tmux-sessions` (see `apps/web/lib/auth/route-classes.ts`).
Owner-only. Viewer share cookies SHALL NOT grant access — anonymous
and viewer requests return 401 with `WWW-Authenticate: Basic
realm="memon"`. Route-class tests SHALL cover both `GET
/api/tmux-sessions/<name>` and the existing `DELETE
/api/tmux-sessions/<name>` to confirm the prefix-based rule covers
both verbs.

The GET handler SHALL cohabit the existing
`apps/web/app/api/tmux-sessions/[name]/route.ts` file alongside the
existing `DELETE` export. Both verbs SHALL operate on the same path
template `/api/tmux-sessions/:name`.

#### Scenario: GET returns enriched row for known session
- **GIVEN** `memon-claude-project-a--run--foo-260507-103000` exists on the host
- **WHEN** an authenticated client sends `GET /api/tmux-sessions/memon-claude-project-a--run--foo-260507-103000`
- **THEN** the response is 200 with `{ row: TmuxSessionRow }` where `row.sessionName` matches and `row.pane` is populated per the row shape requirement above

#### Scenario: GET 404 on unknown session
- **WHEN** an authenticated client sends `GET /api/tmux-sessions/memon-manual-doesnotexist` and that session is not on the host
- **THEN** the response is 404 with `{ error: { code: 'NOT_FOUND', message } }`

#### Scenario: GET 400 on malformed name
- **WHEN** the user sends `GET /api/tmux-sessions/not-a-memon-prefix`
- **THEN** the response is 400 (validation fail)

#### Scenario: GET hits the shared 800 ms pane cache
- **GIVEN** `GET /api/tmux-sessions` just populated the cache 100 ms ago
- **WHEN** an authenticated client sends `GET /api/tmux-sessions/<some-memon-row>`
- **THEN** no new `tmux list-panes -a` shell-out is invoked; the response is served from the cached map

#### Scenario: Anonymous request rejected
- **WHEN** an anonymous client sends `GET /api/tmux-sessions/<name>`
- **THEN** the response is 401 with `WWW-Authenticate: Basic realm="memon"`

#### Scenario: Viewer share cookie does not grant access
- **GIVEN** a viewer with a `memon-shares` cookie scoped to project-a
- **WHEN** the viewer sends `GET /api/tmux-sessions/memon-claude-project-a--run--foo-...`
- **THEN** the response is 401 (shell-class routes do not decode viewer cookies — same behaviour as the existing `DELETE` on this prefix)

### Requirement: /manage/tmux cards render a pane info line under the badge row

Each session card on `/manage/tmux` SHALL render a thin **pane info
line** as a single row beneath the existing badge row, in muted
foreground color and `text-[10px]`. The line SHALL contain (in order):

1. A leading `Activity` lucide icon (`size-3`).
2. `pane.currentCommand` rendered in monospace, when non-null AND not
   in the "uninformative shell" deny-list `[bash, zsh, sh, fish, tmux]`
   OR when `pane.title` is null (so the card still shows something
   informative).
3. A separator dot (`·`) with horizontal spacing, when both the
   command and title would be rendered.
4. `pane.title` truncated to fit the remaining width with CSS
   ellipsis. The full untruncated title SHALL be the card's `title`
   attribute (browser tooltip) so the user can hover to read more.

The line SHALL NOT be rendered when:
- `row.pane === null`, OR
- both `row.pane.currentCommand` would be suppressed (deny-listed) AND
  `row.pane.title === null`.

The pane info line SHALL NOT affect card click-to-select behaviour;
it is non-interactive. Mouse events on the line SHALL propagate up to
the card body's existing select handler (no `stopPropagation` here).

#### Scenario: Card shows command + title for a Claude session
- **GIVEN** a `memon-claude-*` card whose `row.pane` has `currentCommand: 'claude'` and `title: '✻ Claude — Building digest…'`
- **WHEN** the card renders
- **THEN** the pane info line shows the `Activity` icon, the text `claude`, a `·` separator, and the truncated title `✻ Claude — Building digest…`
- **AND** hovering the card surfaces the full title via the card's `title` attribute

#### Scenario: Card with only bare shell hides command but shows hostname title
- **GIVEN** a card whose `row.pane` has `currentCommand: 'bash'` and `title: 'hostname:/path'`
- **WHEN** the card renders
- **THEN** the pane info line shows the icon + the title `hostname:/path` (no `bash` segment because `bash` is in the deny-list AND a title is available)

#### Scenario: Card with only bare shell and no title shows the command
- **GIVEN** a card whose `row.pane` has `currentCommand: 'bash'` and `title: null`
- **WHEN** the card renders
- **THEN** the pane info line shows the icon + the text `bash` (deny-list suppression is bypassed because no title is available — without the command segment the line would be blank)

#### Scenario: Card with null pane info omits the line
- **GIVEN** a card whose `row.pane === null`
- **WHEN** the card renders
- **THEN** no pane info line is in the DOM and the card does NOT reserve vertical space for it

#### Scenario: Pane info line does not eat card click
- **GIVEN** an unselected matchable card with a non-null pane info line
- **WHEN** the user clicks anywhere on the pane info line text
- **THEN** the card's select handler fires and the session becomes selected (the card gains the `border-primary` outline)

### Requirement: Right-pane header on /manage/tmux echoes pane info

The right-pane header bar on `/manage/tmux` SHALL append a `· <command> · <title>` suffix after the sessionName when the selected row's `pane` data is present. The header bar is the slim row above the inline terminal that shows the currently-selected session name plus the `Pop out` button.

Rendering rules:
- The suffix SHALL render in muted color, `text-[10px]`, monospace.
- The suffix SHALL truncate (with CSS ellipsis) so the `Pop out`
  button never wraps to a second line.
- The suffix SHALL be omitted when `row.pane === null` OR both
  `currentCommand` would be suppressed AND `title === null`.
- The deny-list of "uninformative shell" commands is identical to
  the card line's deny-list.

#### Scenario: Right-pane header shows pane info for selected Claude session
- **GIVEN** a `memon-claude-*` session is currently selected and its `row.pane` has `currentCommand: 'claude'` and `title: '✻ Claude — Building digest…'`
- **WHEN** the right-pane header renders
- **THEN** the header shows the sessionName, a `·` separator, the text `claude`, another `·`, and the truncated title `✻ Claude — Building digest…`
- **AND** the `Pop out` button is still visible on the right side and is not wrapped to a new line

#### Scenario: Right-pane header shows nothing when pane data is missing
- **GIVEN** a session is selected and its `row.pane === null`
- **WHEN** the right-pane header renders
- **THEN** only the sessionName + `Pop out` button are visible (the suffix is absent)

