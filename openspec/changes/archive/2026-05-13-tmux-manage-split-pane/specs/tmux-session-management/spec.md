## MODIFIED Requirements

### Requirement: tmux session inventory page at /manage/tmux

The dashboard SHALL render a page at `/manage/tmux` that lists every tmux session on the host whose name starts with `memon-`. The page SHALL be top-level (NOT scoped under `/p/<project>/`) so it can show sessions across all configured projects, plus sessions whose `<project>` cannot be matched in the current config.

The page SHALL fetch the session list from `GET /api/tmux-sessions`. The list SHALL be auto-refreshed every 5 seconds while the page is visible, with a manual refresh button to force an immediate refetch. Auto-refetch SHALL update per-row content (live ttyd port, last-activity timestamp, status badges) but SHALL NOT reorder the list — see the **Stable client-side ordering** requirement below for the exact policy.

The page SHALL expose a `New session` button at the top of the left pane that opens a Dialog with a text input for the session name. Submitting the dialog SHALL `POST /api/tmux-sessions { name }` and, on success, invalidate the list query so the row appears immediately. A toast SHALL communicate the outcome ("created `memon-manual-<name>`" vs "joined existing `memon-manual-<name>`" based on `alreadyExisted`).

The page SHALL render as a two-pane resizable layout (not a table):
- A **left pane** containing the session list and the header controls (filter tabs, `New session`, `Refresh`).
- A **right pane** showing the inline terminal for the currently-selected session, or an empty-state placeholder when none is selected.
- A draggable **divider** between the panes. The user SHALL be able to resize the split by mouse drag, touch drag, or keyboard (arrow keys when the handle is focused), per the underlying `react-resizable-panels` primitive.

On viewports `>= 768px` (the Tailwind `md` breakpoint) the panel orientation SHALL be horizontal (list left, terminal right). On viewports `< 768px` the orientation SHALL be vertical (list top, terminal bottom). The same `ResizablePanelGroup` SHALL be reused with `direction` switched based on the viewport; no separate component tree per orientation.

The list pane SHALL provide three filter tabs: `All`, `Active in memon`, `Stale`. The default filter is `All`. `Active in memon` shows only rows where the manager has a live ttyd entry. `Stale` shows only rows whose `staleReason` is non-null (manual rows do NOT appear under the `Stale` tab).

Each row SHALL render as a clickable card (NOT a table cell). The card SHALL contain:

- A **category badge** as the lead element, derived from the session name and the parse result, with category-specific color treatment:
  - `manual` (amber) when the sessionName starts with `memon-manual-`.
  - `run` (emerald) when `parsed.scope === 'run'`.
  - `exp` (sky) when `parsed.scope === 'exp'`.
  - `project` (violet) when the sessionName starts with `memon-project-` (forward-compatible — no current names match, but the rule SHALL be in place).
  - `legacy` (muted) when `parsed.legacy === true` and none of the prefixes above match.
  - For stale rows, the category badge SHALL render in muted styling regardless of which category the parse would otherwise assign.

- A **title** that is the session name with the universal `memon-` prefix stripped AND any of `manual-` / `project-` / `exp-` / `run-` stripped if present immediately after `memon-`. Examples:
  - `memon-manual-foo` renders as title `foo` (category badge: `manual`).
  - `memon-claude-project-a--run--foo-260507-103000` renders as title `claude-project-a--run--foo-260507-103000` (category badge: `run`).
  - `memon-claude-foo-260507-103000` (legacy format) renders as title `claude-foo-260507-103000` (category badge: `legacy`).

- A **last activity** label (relative time, e.g. `5m ago`), formatted exactly as today.

- A row of **inline metadata badges**, AFTER the category badge. Each badge SHALL be rendered ONLY when its corresponding value is non-null (i.e. the previous table layout would have shown a value other than `—`):
  - `:<port>` — the ttyd bound port (rendered when `row.liveEntry !== null`).
  - `<agent>` — `claude` / `codex` / `opencode` / `terminal` (rendered when `parsed.agent !== null` AND `parsed.agent !== 'none'`).
  - `<project>` — the project name (rendered when `parsed.project !== null`).
  - target — a clickable link with an arrow icon when the row is matchable. The link target depends on `parsed.scope`:
    - `/p/<project>/r/<slug>` for `scope: 'run'`
    - `/p/<project>/e/<slug>` for `scope: 'exp'`
    - `/p/<project>` for `scope: 'project'` (the slug is always `'root'` and is not embedded in the link; the badge label reads `project root` rather than `root`)
  - stale indicator — an inline `⚠ stale (<reason>)` chip in place of the target badge when `row.staleReason !== null`. Reasons remain `unknown-project` or `unknown-target`. Project-scope rows can only ever be `unknown-project` (slug `root` is always valid by contract).
  - Scope SHALL NOT be a standalone badge — it's encoded in the category badge.

- An **actions** group, right-aligned on the card. Action buttons depend on row classification:
  - **Matchable** and **Manual** rows render exactly two actions: `Popup` and `Kill`. The `Popup` button SHALL be hidden on viewports below the Tailwind `md` breakpoint (`hidden md:inline-flex`).
  - **Stale** rows render only `Kill`. `Popup` is omitted (consistent with the existing `manage-tmux-stale-no-open` decision).
  - The `Open in drawer` button is REMOVED for every row category. Its function is replaced by clicking the card body to select the row.

Click handling on each row card:
- For **Matchable** and **Manual** rows, clicking the card BODY (anywhere except the action buttons) SHALL select that row. Action buttons SHALL stop propagation so clicking `Popup` or `Kill` does NOT change the selection.
- For **Stale** rows, clicking the card body SHALL be a no-op — stale rows cannot be selected and cannot mount a terminal. The card SHALL render with reduced opacity (`opacity-75`) and SHALL NOT be a focusable interactive region (`role` is not `button`, `tabIndex` is `-1`).

The currently-selected row SHALL be visually distinguished (e.g., subtle accent background and / or a leading accent bar).

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
- **AND** the lead category badge SHALL render the `manual` chip in amber styling

#### Scenario: Category badge reflects parsed scope for matchable rows
- **GIVEN** the host has sessions `memon-claude-project-a--run--foo-...` and `memon-claude-project-a--exp--E0001-bar`
- **WHEN** the rows render
- **THEN** the first row's category badge SHALL be `run` in emerald styling
- **AND** the second row's category badge SHALL be `exp` in sky styling

#### Scenario: Legacy rows render with legacy category badge
- **GIVEN** the host has session `memon-claude-foo-260507-103000` (pre-rework format)
- **WHEN** the row renders
- **THEN** the lead category badge SHALL be `legacy` in muted styling
- **AND** the card title SHALL be `claude-foo-260507-103000`

#### Scenario: Inline badges are omitted when their value is null
- **GIVEN** the host has session `memon-manual-foo` with NO live ttyd entry
- **WHEN** the row renders
- **THEN** no `:<port>` badge SHALL be present in the row
- **AND** no `<agent>` badge SHALL be present (manual row has no parsed agent)
- **AND** no `<project>` badge SHALL be present
- **AND** no target badge SHALL be present (manual rows have no target)
- **AND** ONLY the category badge (`manual`) and the title are visible

#### Scenario: Inline badges render fully for an active matchable row
- **GIVEN** the host has session `memon-claude-project-a--run--foo-260507-103000`, the manager holds a live ttyd entry on port 7683 for it, and `project-a` resolves on disk
- **WHEN** the row renders
- **THEN** the card SHALL contain badges in this order: category `run`, `:7683`, `claude`, `project-a`, and a target link to `/p/project-a/r/foo-260507-103000`

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
- **WHEN** the user clicks the card body (not an action button)
- **THEN** the row SHALL render with a selected-row visual treatment (accent background)
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

## ADDED Requirements

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
