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

The `/manage/tmux` page SHALL persist the split-pane sizes across reloads using `localStorage`. The storage key SHALL be `memon:manage-tmux:split-sizes`. The stored value SHALL be a JSON object map keyed by panel id (`tmux-list`, `tmux-terminal`) whose values are numbers in `[0, 100]` summing to `100` (the same `Layout` shape that `react-resizable-panels` accepts as `defaultLayout`).

The page SHALL:

- **On first paint (mount-time):** the `ResizablePanelGroup` SHALL be
  mounted with NO `defaultLayout` prop. The per-panel initial sizes
  SHALL come from each `ResizablePanel`'s `defaultSize` / `maxSize` /
  `minSize` props:
  - On desktop (`orientation="horizontal"`): the LEFT panel SHALL carry
    `defaultSize="300px"` and `maxSize="50%"`. Because `defaultSize` is
    clamped to `maxSize` by the library's constraint solver, the LEFT
    panel's first-paint width SHALL equal `min(300px, 50% × containerWidth)`.
    The RIGHT panel takes the remainder.
  - On mobile (`orientation="vertical"`): the LEFT panel (which is the
    TOP panel in vertical orientation) SHALL carry `defaultSize="50%"`
    with no `maxSize` cap. The default split SHALL be `50 / 50`.
  - The `minSize` constraints SHALL be `"180px"` (desktop) and `25%`
    (mobile), preserving the prior "list pane cannot be dragged
    impractically thin" behavior.

- **Post-mount stored-layout hydration:** in a `useLayoutEffect` that
  runs once after the group has mounted, the page SHALL read the stored
  layout from `localStorage` via the group's imperative ref:
  - If the stored value is present, parses as a JSON object, has BOTH
    `tmux-list` and `tmux-terminal` keys with numeric values in
    `[0, 100]`, AND those values sum to within `0.5` of `100`, the page
    SHALL call `groupRef.setLayout(stored)` to apply the stored sizes.
  - If the stored value is absent, invalid, or fails validation, the
    page SHALL leave the layout at the mount-time defaults.

- **On layout change (`onLayoutChanged`):** the page SHALL debounce by
  `~250ms` and write the layout (in the object-map shape above) to
  `localStorage`. Writes SHALL be wrapped in `try/catch` so private
  mode / quota errors fall back to in-memory state without breaking
  the page.

A single localStorage key is used for both orientations. After rotating
between desktop and mobile orientations, the previously-saved sizes are
applied; the user can drag once and the new sizes get saved. The
`maxSize="50%"` cap on desktop applies during user drag too: the left
pane cannot be dragged past 50% of the container — a session list wider
than half the page is always wrong for this view.

#### Scenario: Pane sizes survive a reload
- **GIVEN** the user drags the divider so the left pane is 40% wide and the right pane is 60%
- **WHEN** the user refreshes the page
- **THEN** the pane sizes after reload are 40 / 60
- **AND** the `localStorage` value at `memon:manage-tmux:split-sizes` is `{"tmux-list":40,"tmux-terminal":60}` (modulo numeric formatting)

#### Scenario: Default desktop split applies on first visit at wide viewport
- **GIVEN** `memon:manage-tmux:split-sizes` is absent from `localStorage` and the container width is 1200px
- **WHEN** the user opens `/manage/tmux` for the first time
- **THEN** the initial LEFT pane width SHALL be `300px` (because `min(300, 0.5 × 1200) = 300`)
- **AND** the initial RIGHT pane width SHALL be `900px` (the remainder)
- **AND** these correspond to roughly `25 / 75` in percentage terms

#### Scenario: Default desktop split applies on first visit at narrow desktop viewport
- **GIVEN** `memon:manage-tmux:split-sizes` is absent and the container width is 500px (a narrow desktop window, still `>= 768px` if the browser window is wider but the available split container is narrower due to the sidebar inset)
- **WHEN** the user opens `/manage/tmux`
- **THEN** the initial LEFT pane width SHALL be `250px` (because `min(300, 0.5 × 500) = 250`)
- **AND** the initial RIGHT pane width SHALL be `250px`
- **AND** these correspond to `50 / 50` in percentage terms

#### Scenario: Default mobile split applies on first visit
- **GIVEN** `memon:manage-tmux:split-sizes` is absent and the viewport is below `md`
- **WHEN** the user opens `/manage/tmux`
- **THEN** the initial split is `50 / 50` (vertical orientation, no `maxSize` cap on mobile)

#### Scenario: Corrupted localStorage value falls back to default
- **GIVEN** `localStorage.memon:manage-tmux:split-sizes` is `"not json"` or is an object missing a panel id key or has non-numeric values
- **WHEN** the page mounts
- **THEN** the `useLayoutEffect` SHALL leave the mount-time defaults in place (NOT call `groupRef.setLayout`)
- **AND** the corrupted value SHALL be overwritten on the next layout change (after the user drags the divider)

#### Scenario: Left pane cannot be dragged past 50% on desktop
- **GIVEN** the desktop split layout is mounted (viewport `>= 768px`)
- **WHEN** the user drags the divider rightward as far as possible
- **THEN** the LEFT panel's width SHALL clamp at `50%` of the container width
- **AND** subsequent reloads with `memon:manage-tmux:split-sizes = {"tmux-list":50,"tmux-terminal":50}` SHALL still apply the `50/50` layout (the `maxSize="50%"` cap is exactly satisfied, not exceeded)

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

### Requirement: Split-pane orientation defaults to horizontal before the viewport size is known

The `/manage/tmux` `ResizablePanelGroup` SHALL render with `orientation="horizontal"` (the desktop layout) on both the SSR pass and the first client commit — i.e. before the `useEffect`-driven `window.matchMedia('(min-width: 768px)')` read has resolved.

The intent is to bias the unknown-viewport case toward the common case
(desktop). The existing "Page renders as a resizable split-pane on
desktop" / "Page renders as a vertical split on mobile" requirements
continue to govern the resolved-viewport behavior: once the media query
resolves, the orientation switches to `vertical` on viewports `< 768px`
and stays `horizontal` on viewports `>= 768px`. A mobile user therefore
sees at most one frame of horizontal layout before the orientation
rotates; a desktop user sees zero frames of the wrong orientation.

The page SHALL accomplish this by:
- Passing `defaultValue = true` to the `useMediaQuery('(min-width: 768px)')`
  call so the hook's initial state on both the SSR pass and the first
  client render is `true` (desktop). The hook continues to update
  asynchronously via its effect when the actual media query resolves.
- The `useMediaQuery` helper SHALL accept an optional second parameter
  `defaultValue: boolean` (default `false`, backward-compatible with
  any future caller that wants the previous mobile-biased default).

#### Scenario: Server-rendered HTML uses horizontal orientation
- **GIVEN** the `/manage/tmux` page is rendered on the server (no `window`)
- **WHEN** the SSR pass produces HTML
- **THEN** the `ResizablePanelGroup` root SHALL carry
  `aria-orientation="horizontal"` (or, equivalently, render with the
  horizontal-orientation `flex` direction, NOT the
  `aria-[orientation=vertical]:flex-col` mobile branch)

#### Scenario: First client render before media query resolves uses horizontal orientation
- **GIVEN** the client has just mounted the page and `useEffect`-driven
  `matchMedia` listeners have NOT yet fired
- **WHEN** React commits the first client render
- **THEN** the `ResizablePanelGroup` SHALL be rendered with
  `orientation="horizontal"` regardless of the actual viewport width

#### Scenario: Mobile viewport rotates to vertical after media query resolves
- **GIVEN** the actual viewport width is `< 768px`
- **WHEN** the post-mount media-query effect fires and reports `matches: false`
- **THEN** the `ResizablePanelGroup` SHALL re-render with
  `orientation="vertical"` (the existing mobile behavior)
- **AND** the brief horizontal-orientation flash that preceded this
  re-render is acceptable and SHALL NOT be papered over with a loading
  spinner or hidden visibility

#### Scenario: useMediaQuery defaultValue parameter is backward compatible
- **GIVEN** an existing caller invokes `useMediaQuery('(min-width: 1024px)')`
  with NO second argument
- **WHEN** the hook initializes
- **THEN** the initial value SHALL be `false` (the prior behavior is
  preserved when no `defaultValue` is supplied)

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

### Requirement: Right-pane TerminalView cache on /manage/tmux

The `/manage/tmux` right pane SHALL maintain an in-memory cache of up
to `MANAGE_TMUX_CACHE_CAP = 4` recently-selected `<TerminalView>`
instances so that switching back to a recently-visited row is a CSS
visibility flip rather than a full iframe re-mount. The cache SHALL be
local to the page component (`TmuxManagePageClient`) and SHALL be
discarded when the user navigates away from `/manage/tmux`.

The cache key SHALL be the row's `sessionName` (the same string used
as the `<TerminalView>` `key` prop). One cache entry holds one
`<TerminalView>` mount; sub-mounts (e.g. for raw-vs-standard mode) are
NOT separately cached — the mode is determined by the row's
classification at selection time and is fixed for the lifetime of the
cache entry.

The right pane SHALL render all cache entries simultaneously inside an
absolutely-positioned container. The currently-selected entry SHALL be
visible (no Tailwind `hidden` class); every non-selected cache entry
SHALL carry the Tailwind `hidden` class (which sets `display: none`)
so its iframe + WebSocket + xterm state remain mounted but the entry
contributes nothing to layout, paint, or pointer events. The cache
SHALL NOT use `<TerminalView>`'s `fullscreen` prop (the page-level
ResizablePanel sizes the container).

When the user selects a row whose sessionName is NOT in the cache:
1. If the cache is at cap, the entry with the oldest `lastSeenAt`
   (least-recently-selected) SHALL be removed from the cache. Its
   `<TerminalView>` SHALL unmount, closing its iframe and its
   WebSocket.
2. A fresh cache entry SHALL be created for the new sessionName, its
   `<TerminalView>` SHALL mount, and the entry's `lastSeenAt` SHALL
   be set to `Date.now()`.

When the user selects a row whose sessionName IS in the cache:
1. The cache entry's `lastSeenAt` SHALL be updated to `Date.now()`.
2. The previously-visible cache entry (if different) SHALL gain the
   `hidden` class; the newly-selected entry SHALL lose it.
3. NO `<TerminalView>` SHALL be unmounted; NO `start`/`attach` POST
   SHALL fire (the cached `<TerminalView>` instance was already past
   the `ready` phase).

Cache eviction SHALL also fire when:
- The row disappears from the `/api/tmux-sessions` refetch (e.g. the
  session was killed by the user via the page's Kill action, killed
  by `tmux kill-session` from a real terminal, or killed by a
  parallel manage-page tab). Cache cleanup follows the existing
  "selected session no longer present" cleanup path.
- The row is renamed via the page's Rename action. The old
  sessionName cache entry SHALL be dropped at the same time the URL
  is updated to the new sessionName. The new sessionName SHALL NOT
  be pre-allocated; it enters the cache via the normal "fresh
  selection" path.
- A `terminal-attached` `BroadcastChannel` message arrives for a
  sessionName that is in the cache AND is NOT the currently-selected
  entry — see the `Cross-page release of cached TerminalView via
  BroadcastChannel` requirement below.

The currently-selected cache entry SHALL never be evicted by LRU or
broadcast — only by row-disappearance or rename. If the user
explicitly selects a different row that is itself the LRU eviction
target (impossible because selecting bumps `lastSeenAt`) the rule is
moot.

The empty-state placeholder (the existing `RightPaneEmpty`) SHALL
render when `selectedName === null`. It is independent of the cache:
the cache may still hold up to `MANAGE_TMUX_CACHE_CAP` previously-
selected entries while the right pane displays the empty state. The
empty state SHALL be the only visible content in this case (every
cache entry carries the `hidden` class).

#### Scenario: Cache hit on switching back is a visibility flip with no fresh attach

- **GIVEN** the user has selected row `A` (`memon-claude-project-a--run--foo-260507-103000`), then row `B`, in that order — both rows are in the cache and `B` is currently visible
- **WHEN** the user clicks row `A`
- **THEN** no `POST /api/terminal/start` and no `POST /api/terminal/attach` SHALL fire for `A`'s sessionName
- **AND** `A`'s `<TerminalView>` SHALL remain the same React instance it was a moment ago (the iframe DOM node, the WebSocket, and the xterm state are preserved)
- **AND** `A`'s container SHALL lose the `hidden` class and `B`'s container SHALL gain it
- **AND** `A`'s `lastSeenAt` SHALL be updated to `Date.now()`
- **AND** the perceived switch SHALL appear instant (no `starting ttyd…` loader, no terminal redraw)

#### Scenario: LRU eviction at cap

- **GIVEN** `MANAGE_TMUX_CACHE_CAP = 4` and the user has selected rows `A`, `B`, `C`, `D` in that order — all four are cached and `D` is currently visible; `A` is the LRU entry
- **WHEN** the user selects a fifth row `E` whose sessionName is not in the cache
- **THEN** `A`'s cache entry SHALL be removed from the cache map
- **AND** `A`'s `<TerminalView>` SHALL unmount (its iframe, WebSocket, and xterm state are destroyed)
- **AND** the server SHALL observe `A`'s WebSocket close (via `noteWsDisconnect`)
- **AND** a fresh cache entry SHALL be created for `E` and its `<TerminalView>` SHALL mount, firing the standard `start`/`attach` POST for `E`
- **AND** `E` SHALL be the visible entry; `B`, `C`, `D`, `E` are now in the cache (size = 4)

#### Scenario: First selection mounts and adds to cache

- **GIVEN** the page just loaded with no `?session=` param and the cache is empty
- **WHEN** the user clicks row `X` for the first time
- **THEN** a fresh `<TerminalView>` SHALL mount for `X` and POST the appropriate `start` or `attach` endpoint
- **AND** the cache contains exactly one entry: `X` with `lastSeenAt = Date.now()`

#### Scenario: Selected entry is never LRU-evicted

- **GIVEN** the cache is at cap with `A`, `B`, `C`, `D` and `A` is currently selected
- **WHEN** the user selects a fresh row `E`
- **THEN** the LRU eviction targets the entry with the oldest `lastSeenAt` AMONG THE NON-SELECTED ENTRIES (i.e. the eviction picks from `{B, C, D}`, not `A`)
- **AND** `A` remains in the cache after the selection completes

#### Scenario: Killing a cached session removes it from the cache

- **GIVEN** rows `A`, `B`, `C` are cached and `B` is currently selected
- **WHEN** the user clicks `Kill` on row `A` and the kill mutation succeeds
- **AND** the next `GET /api/tmux-sessions` refetch returns a list without `A`
- **THEN** `A`'s cache entry SHALL be removed from the cache map
- **AND** `A`'s `<TerminalView>` SHALL unmount
- **AND** `B` remains visible; `C` remains in the cache (hidden)

#### Scenario: Renaming a cached session drops the old cache entry

- **GIVEN** row `memon-manual-old` is cached and currently selected; the rename dialog is opened on it; the user submits `memon-manual-new`
- **WHEN** the rename mutation succeeds
- **THEN** the old cache entry under `memon-manual-old` SHALL be removed from the cache map
- **AND** the page's URL SHALL update to `?session=memon-manual-new` via `router.replace` (existing rename behaviour)
- **AND** the new sessionName `memon-manual-new` SHALL be inserted into the cache as a fresh entry on the post-URL-update render — its `<TerminalView>` mounts and POSTs `attach` for the new name
- **AND** the cache size SHALL be unchanged (one entry replaced by another)

#### Scenario: Cache survives a refetch that does not change session set

- **GIVEN** rows `A`, `B`, `C` are cached and `A` is currently selected
- **WHEN** the 5-second `/api/tmux-sessions` refetch fires and the response still contains `A`, `B`, `C` (no add, no remove)
- **THEN** the cache SHALL be unchanged — same three entries, same instances, same `lastSeenAt` values
- **AND** no `<TerminalView>` SHALL re-mount

#### Scenario: Empty-state coexists with cached entries

- **GIVEN** rows `A`, `B` are cached and `A` is currently selected
- **WHEN** the user clicks the same row `A` a second time so that the page implementation toggles to no selection (or a future affordance clears the selection by other means)
- **THEN** the right pane SHALL render the `RightPaneEmpty` placeholder
- **AND** `A` and `B` SHALL remain in the cache, both with the `hidden` class on their containers
- **AND** subsequently selecting `A` again SHALL be a cache hit (no fresh `start`/`attach` fires)

NOTE: the current `/manage/tmux` UI does not expose a "deselect"
gesture; this scenario is preserved as a guarantee for any future
deselect affordance.

### Requirement: Cross-page release of cached TerminalView via BroadcastChannel

`TmuxManagePageClient` SHALL subscribe to a same-origin
`BroadcastChannel` named `memon:terminal-attached` for the lifetime
of the page mount. Each message SHALL carry the shape:

```ts
type AttachedMessage = {
  sessionName: string
  source: 'manage' | 'drawer' | 'popup' | 'unknown'
  attachedAt: number  // Date.now() millis since epoch
}
```

On each incoming message:
- If `BroadcastChannel` is not supported by the current browser
  (`typeof BroadcastChannel === 'undefined'`), the subscribe step
  SHALL be skipped — the cache continues to operate via LRU only.
- If `msg.sessionName === selectedName` (the manage page's
  currently-selected row), the message SHALL be a no-op.
- Else if `msg.sessionName` IS a key in the cache (a cached but not
  currently-selected entry), the cache entry SHALL be removed and
  its `<TerminalView>` SHALL unmount.
- Else the message SHALL be a no-op.

The page SHALL NOT filter incoming messages on `source`. The
`source` field is for telemetry / debugging only.

The page SHALL clean up the channel subscription on unmount
(`channel.close()` in the effect cleanup).

Coexistence with same-tab self-broadcasts: when the page selects a
fresh row whose `<TerminalView>` mounts and broadcasts `{ sessionName:
'X', source: 'manage' }`, the listener SHALL evaluate the message
AFTER `selectedName` has been updated to `'X'`. The "no-op when
selected" rule then fires and no eviction happens. Implementations
MUST guarantee this ordering — typically by reading `selectedName`
inside the listener via a ref or re-creating the listener whenever
`selectedName` changes.

#### Scenario: Popup attach releases a cached non-selected entry

- **GIVEN** rows `A` and `B` are cached on `/manage/tmux`; `A` is currently selected; `B` is in the cache (hidden)
- **AND** the user opens row `B` in a popup window (clicks the per-row Popup button)
- **WHEN** the popup's `<TerminalView>` enters the `ready` phase and broadcasts `{ sessionName: 'B', source: 'popup', attachedAt: <now> }` on `memon:terminal-attached`
- **THEN** the manage page's listener SHALL receive the message
- **AND** because `B !== selectedName ('A')` and `B` is in the cache, the cache entry for `B` SHALL be removed
- **AND** `B`'s `<TerminalView>` on the manage page SHALL unmount, closing its WebSocket
- **AND** subsequently selecting `B` on the manage page SHALL be a fresh mount (cache miss) that POSTs `start`/`attach` for `B` again — the popup's ttyd is shared via the manager's idempotent return, so no duplicate ttyd process is spawned

#### Scenario: Selected entry is never released by broadcast

- **GIVEN** row `A` is currently selected on `/manage/tmux` (the right pane shows A's iframe)
- **WHEN** the user opens row `A` ALSO in a popup window and the popup broadcasts `{ sessionName: 'A', source: 'popup', ... }`
- **THEN** the manage page's listener SHALL evaluate `msg.sessionName === selectedName ('A')` as true
- **AND** the cache entry for `A` SHALL NOT be removed
- **AND** the right pane continues to show `A`'s iframe (no flicker, no reattach)
- **AND** both the manage page's iframe and the popup's iframe co-attach to the same backend ttyd via shared `wsConnections`

#### Scenario: Drawer attach releases a cached non-selected entry

- **GIVEN** the manage page caches rows `A` (selected) and `B` (hidden)
- **AND** the user opens the global terminal drawer for row `B` from a non-manage page in another tab
- **WHEN** the drawer's `<TerminalView>` enters `ready` and broadcasts `{ sessionName: 'B', source: 'drawer', ... }`
- **THEN** the manage page in the first tab SHALL drop `B` from its cache

#### Scenario: Self-broadcast from the manage page does not evict its own selection

- **GIVEN** the cache is empty and the user clicks row `C` for the first time
- **WHEN** `C`'s newly-mounted `<TerminalView>` enters `ready` and broadcasts `{ sessionName: 'C', source: 'manage', ... }` (the page's own listener receives this self-broadcast)
- **THEN** the listener SHALL evaluate `msg.sessionName === selectedName ('C')` as true (selection updated before broadcast under the ordering guarantee)
- **AND** the cache entry for `C` SHALL NOT be removed
- **AND** `C` remains visible

#### Scenario: Two manage-page tabs coordinate via broadcast

- **GIVEN** tab `T1` has cached `A` (selected), `B` (hidden); tab `T2` has cached `B` (selected), `A` (hidden)
- **WHEN** in tab `T1` the user selects `C` (a fresh row), causing `T1` to broadcast `{ sessionName: 'C', source: 'manage', ... }`
- **THEN** in tab `T2`, `C` is NOT cached, so the broadcast is a no-op for `T2`
- **AND** in tab `T2`'s subsequent selection of `B`, `T2` broadcasts `{ sessionName: 'B', source: 'manage', ... }` — but `B` IS the selectedName in `T2`, so `T2`'s self-broadcast is a no-op for `T2`
- **AND** in tab `T1`, the listener sees `B` in the cache and `B !== selectedName ('A')`, so `T1` evicts `B` from its cache

#### Scenario: BroadcastChannel unavailable falls back to LRU only

- **GIVEN** the page is loaded in a browser where `typeof BroadcastChannel === 'undefined'`
- **WHEN** the page mounts
- **THEN** no channel subscription SHALL be attempted (no `new BroadcastChannel(...)` call)
- **AND** the cache continues to operate — LRU eviction still fires at cap, kill / rename eviction still fires
- **AND** no error SHALL be thrown and no console warning SHALL block the page render

#### Scenario: Channel subscription is cleaned up on unmount

- **GIVEN** the user is on `/manage/tmux` and the channel listener is registered
- **WHEN** the user navigates away (route change unmounts `TmuxManagePageClient`)
- **THEN** the effect cleanup SHALL call `channel.close()` so no further messages reach the now-unmounted page

### Requirement: Keyboard navigation between session rows on /manage/tmux

The `/manage/tmux` page SHALL support keyboard-driven navigation
between rows in the left-pane session list. The bindings SHALL be
`Ctrl+Shift+ArrowDown` (move selection to the next row) and
`Ctrl+Shift+ArrowUp` (move selection to the previous row). The
navigation SHALL operate on the **visible** filtered list — the
same array of `TmuxSessionRow` values the left pane renders — and
SHALL drive selection through the same URL-routed flow as a click
on a card (`router.replace('/manage/tmux?session=<name>')`).

The modifier match SHALL require `ctrlKey === true` AND
`shiftKey === true` AND `altKey === false` AND `metaKey === false`.
Other modifier combinations SHALL leave the page's default keydown
handling untouched.

The shortcut SHALL be **suppressed** (the handler returns without
calling `preventDefault`) under any of the following:

- The event's target is an editable control: an `<input>`,
  `<textarea>`, `<select>`, or any element with
  `isContentEditable === true`.
- The Kill, Rename, or Create dialog is currently open.

When the shortcut is NOT suppressed, the page SHALL resolve the
next selection from the current visible list and the current
`?session=` URL value:

- If the list is empty, the shortcut is a no-op and SHALL NOT
  call `preventDefault()`.
- If no session is currently selected, both `ArrowDown` and
  `ArrowUp` SHALL select the **first** row in the visible list.
- If a session is selected and present in the visible list at
  index `i`:
  - `ArrowDown` with `i < list.length - 1` SHALL select index
    `i + 1`. `ArrowDown` with `i === list.length - 1` SHALL be a
    no-op (clamp at the bottom; no wrap-around).
  - `ArrowUp` with `i > 0` SHALL select index `i - 1`.
    `ArrowUp` with `i === 0` SHALL be a no-op (clamp at the top).
- If a session is selected but NOT in the visible list (e.g. the
  user switched filter tabs and the selected session is no longer
  visible), both `ArrowDown` and `ArrowUp` SHALL select the
  **first** visible row.

When the shortcut DOES change the selection, the page SHALL:

- Call `preventDefault()` on the keydown event so the browser's
  built-in text-selection-extension behavior does NOT also fire.
- Update the URL via `router.replace` (consistent with click-
  driven selection — no new history entry).
- Scroll the newly-selected card into view via
  `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`.
  When the user agent reports `prefers-reduced-motion: reduce`,
  the page SHALL use `behavior: 'auto'` instead.

The page SHALL NOT call `.focus()` on the newly-selected card.
Selection and focus are independent: the card receives the
`border-primary` selected styling and the right pane re-mounts
its terminal, but document focus stays wherever it was before
the keypress.

The keydown listener SHALL be installed only while the
`TmuxManagePageClient` is mounted and SHALL be removed on
unmount, so the shortcut does NOT leak to other routes.

The shortcut SHALL also fire when keyboard focus is currently
inside the right-pane ttyd `<iframe>`. Because the iframe URL
(`/api/terminal/proxy/<sessionName>/`) is same-origin with the
parent app, `TerminalView` SHALL — when its `source` prop is
`'manage'` — install a `'keydown'` listener with
`{ capture: true }` on **both** `iframe.contentWindow` and
`iframe.contentDocument` after the iframe finishes loading.
Attaching on both targets defends against any iframe-internal
listener (xterm.js or otherwise) that might register at the
window level; the document attachment is the backup. Capture
phase ensures the listener fires before any target-phase
listener inside the iframe (xterm.js's keydown is on the helper
textarea, which is the target).

The attach point SHALL NOT be the placeholder `about:blank`
document that browsers expose synchronously for an iframe with
a freshly-set `src` (with `readyState === 'complete'` and
`URL === 'about:blank'`). That placeholder is replaced when the
real navigation completes, and any listener attached to it gets
orphaned silently. The implementation SHALL therefore:

- Reject any `contentDocument` whose `URL === 'about:blank'`
  or whose `readyState === 'loading'`.
- Register a `'load'` event listener on the iframe element and
  re-attempt the attach inside that handler, so the listener
  lands on the post-navigation document.
- Also attempt one eager (synchronous) attach inside the
  `useEffect` body, so the rare case where the iframe has
  already finished loading before the effect runs (e.g. cached
  content) is still covered. The `about:blank` rejection makes
  the eager attempt a safe no-op when the navigation is still
  in flight.
- When a re-attach succeeds, drop any prior attachment first so
  listeners do not stack across iframe re-loads. When that listener observes the exact
`Ctrl+Shift+ArrowUp/Down` combo:

- It SHALL call `event.preventDefault()`,
  `event.stopPropagation()`, and `event.stopImmediatePropagation()`
  on the iframe event so xterm.js does NOT receive the key and
  ttyd does NOT forward it over WebSocket to the underlying
  tmux/agent. Per the DOM dispatch algorithm, calling
  `stopPropagation()` in capture phase on the iframe's window
  prevents the event from reaching the target phase, so
  xterm.js's textarea listener does not fire.
- It SHALL dispatch a synthesized `KeyboardEvent('keydown', ...)`
  with the same `key`, `code`, `ctrlKey: true`, `shiftKey: true`,
  `altKey: false`, `metaKey: false`, `bubbles: true`,
  `cancelable: true` onto the **parent** `window`. The parent's
  page-level handler SHALL receive the synthesized event and run
  the navigation as if the user had pressed the keys with focus
  outside the iframe.

The forwarder SHALL pass through any keydown that does NOT match
Ctrl+Shift+ArrowUp/Down (no preventDefault, no stopPropagation,
no re-dispatch) so terminal-program input is unaffected.

The forwarder SHALL only be installed when `source === 'manage'`.
Other `<TerminalView>` callers (`source: 'drawer'`, `'popup'`, or
`'unknown'`) SHALL NOT install it.

The forwarder SHALL be removed when the iframe is replaced (URL
change, `source` change, or `TerminalView` unmount). Failure to
read `iframe.contentDocument` (e.g. unexpected cross-origin
configuration) SHALL be caught and treated as a silent no-op so
the parent-window shortcut still works when focus is outside the
iframe.

#### Scenario: Down arrow with selection moves to the next visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL becomes `/manage/tmux?session=B` via
  `router.replace` (no new history entry pushed)
- **AND** the keydown event has `defaultPrevented === true`
- **AND** the row for `B` is scrolled into view if it was off-
  screen, and the left pane shows `B`'s card with the selected
  styling
- **AND** the right pane unmounts `A`'s `<TerminalView>` and
  mounts `B`'s

#### Scenario: Up arrow with selection moves to the previous visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=C`
- **WHEN** the user presses `Ctrl+Shift+ArrowUp`
- **THEN** the URL becomes `/manage/tmux?session=B`
- **AND** the keydown event has `defaultPrevented === true`

#### Scenario: Down arrow clamps at the last row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=C`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=C`
- **AND** the keydown event has `defaultPrevented === false`
  (no wrap-around, no preventDefault)

#### Scenario: Up arrow clamps at the first row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowUp`
- **THEN** the URL remains `/manage/tmux?session=A`
- **AND** the keydown event has `defaultPrevented === false`

#### Scenario: Down arrow with no selection bootstraps onto the first visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux` (no `?session=` param)
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL becomes `/manage/tmux?session=A`

#### Scenario: Up arrow with no selection bootstraps onto the first visible row

- **GIVEN** the visible list is `[A, B, C]` and the URL is
  `/manage/tmux` (no `?session=` param)
- **WHEN** the user presses `Ctrl+Shift+ArrowUp`
- **THEN** the URL becomes `/manage/tmux?session=A`

#### Scenario: Selected session missing from visible list re-bootstraps

- **GIVEN** the URL is `/manage/tmux?session=X` and the filter tab
  is `Active`, but `X` is a stale row that is filtered out so the
  visible list is `[B, D]`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown` (or
  `ArrowUp`)
- **THEN** the URL becomes `/manage/tmux?session=B` (the first
  visible row)

#### Scenario: Shortcut suppressed while typing in the Rename dialog

- **GIVEN** the Rename dialog is open with its `<Input>` focused
  and the visible list is `[A, B, C]` with `?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=A` (no
  navigation)
- **AND** the keydown propagates to the input so the browser's
  default text-selection-extension behavior runs

#### Scenario: Shortcut suppressed while the Kill dialog is open

- **GIVEN** the Kill confirmation dialog is open (its `Cancel`
  button has focus, not an input) and the URL is
  `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=A`

#### Scenario: Shortcut suppressed while the Create dialog is open

- **GIVEN** the New-session dialog is open with its `<Input>`
  focused and the URL is `/manage/tmux?session=A`
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the URL remains `/manage/tmux?session=A`

#### Scenario: Ctrl-without-Shift does not trigger navigation

- **GIVEN** the URL is `/manage/tmux?session=A` and the visible
  list is `[A, B, C]`
- **WHEN** the user presses `Ctrl+ArrowDown` (no Shift)
- **THEN** the URL remains `/manage/tmux?session=A`
- **AND** the page's keydown handler does NOT call
  `preventDefault()`

#### Scenario: Empty visible list is a no-op

- **GIVEN** the visible list is `[]` (filter `Stale` with no stale
  rows, for example)
- **WHEN** the user presses `Ctrl+Shift+ArrowDown` (or
  `ArrowUp`)
- **THEN** the page makes no `router.replace` call
- **AND** the keydown has `defaultPrevented === false`

#### Scenario: Reduced motion preference disables smooth scroll

- **GIVEN** the user agent reports `prefers-reduced-motion: reduce`
  and the keyboard navigation changes the selection
- **WHEN** the scroll-into-view is invoked
- **THEN** the call SHALL use `behavior: 'auto'` instead of
  `'smooth'`

#### Scenario: Shortcut is removed when leaving the page

- **GIVEN** the user is on `/manage/tmux` and the shortcut is
  active
- **WHEN** the user navigates away (`router.push('/p/foo')`),
  unmounting `TmuxManagePageClient`
- **THEN** the global keydown listener SHALL be removed and
  pressing `Ctrl+Shift+ArrowDown` on the new page SHALL NOT
  trigger any selection change

#### Scenario: Shortcut fires when focus is inside the ttyd iframe

- **GIVEN** the user is on `/manage/tmux?session=A` with the
  visible list `[A, B, C]`, has clicked into the right-pane
  ttyd terminal so xterm's hidden textarea has focus
- **WHEN** the user presses `Ctrl+Shift+ArrowDown`
- **THEN** the iframe-side capture listener SHALL receive the
  event first and call `preventDefault()` + `stopPropagation()`
- **AND** xterm.js SHALL NOT receive the event (no character
  sent to ttyd over WebSocket, no scroll/selection inside the
  terminal)
- **AND** a synthesized `KeyboardEvent` SHALL be dispatched on
  the parent `window` with `ctrlKey: true`, `shiftKey: true`,
  `altKey: false`, `metaKey: false`, and the same `key`/`code`
- **AND** the parent's page-level handler SHALL run and the URL
  SHALL become `/manage/tmux?session=B`

#### Scenario: Non-shortcut keys inside the iframe pass through to xterm

- **GIVEN** the user is on `/manage/tmux?session=A` with focus
  in the right-pane terminal
- **WHEN** the user types a non-shortcut key (e.g. `a`, or
  `ArrowDown` without Ctrl+Shift, or `Ctrl+C`)
- **THEN** the iframe-side forwarder SHALL NOT call
  `preventDefault()`, `stopPropagation()`, or re-dispatch
- **AND** the keystroke SHALL reach xterm.js normally and be
  forwarded to the underlying tmux/agent

#### Scenario: Forwarder is not installed for drawer/popup TerminalView usage

- **GIVEN** a `<TerminalView>` is rendered with `source !==
  'manage'` (e.g. inside the side drawer or popup window) and
  the iframe has loaded
- **WHEN** the user presses `Ctrl+Shift+ArrowDown` with focus
  inside that iframe
- **THEN** the forwarder SHALL NOT be installed
- **AND** xterm.js SHALL receive the event as it would for any
  other key (no parent-side navigation occurs)

#### Scenario: Forwarder is removed when the iframe is replaced

- **GIVEN** a `<TerminalView source="manage">` has an installed
  iframe forwarder for session A
- **WHEN** the parent selection switches to session B and the
  iframe URL changes (React re-mounts the iframe due to
  `key={iframeUrl}`)
- **THEN** the previous forwarder SHALL be removed (its
  `removeEventListener` cleanup runs)
- **AND** a fresh forwarder SHALL be installed on the new
  iframe's `contentDocument` once it loads

#### Scenario: Forwarder does not attach to the initial about:blank document

- **GIVEN** an iframe inside `<TerminalView source="manage">` is
  freshly inserted with a `src` and, at the moment the React
  effect runs, `iframe.contentDocument.URL === 'about:blank'`
  and `readyState === 'complete'` (the browser-provided
  placeholder before the real navigation finishes)
- **WHEN** the effect's eager `tryAttach` invocation runs
- **THEN** it SHALL detect `URL === 'about:blank'` and return
  without attaching a listener to that document
- **AND** the registered `'load'` event handler on the iframe
  SHALL subsequently re-invoke `tryAttach` once the real ttyd
  document is the `contentDocument`, attaching the listener
  there instead

#### Scenario: Re-attach on iframe load swaps out any stale listener

- **GIVEN** a forwarder has been attached to some document A
  inside the iframe
- **WHEN** the iframe fires a fresh `'load'` event (rare, e.g.
  internal navigation) and `tryAttach` sees a different
  `contentDocument` B
- **THEN** the implementation SHALL remove the listener from A
  before adding it to B, so the two attachments do not stack

#### Scenario: Forwarder is a no-op when contentDocument is unreadable

- **GIVEN** a `<TerminalView source="manage">` whose iframe
  loads from a hypothetical cross-origin URL (e.g. a
  reverse-proxy misconfiguration) so
  `iframe.contentDocument` access throws a SecurityError
- **WHEN** the effect attempts to attach the forwarder
- **THEN** the SecurityError SHALL be caught and the forwarder
  SHALL silently no-op
- **AND** the parent-window listener SHALL continue to function
  for keystrokes received with focus outside the iframe

