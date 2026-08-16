## MODIFIED Requirements

### Requirement: Drawer state persists across panel close until route change

The browser-terminal drawer SHALL be opened and dismissed by a single `TerminalDrawerProvider` mounted in the ROOT layout (`apps/web/app/layout.tsx`), reachable from every page in the dashboard including `/manage/tmux`. The active terminal target and presentation surface SHALL persist across pathname changes — navigation alone SHALL NOT close the terminal or kill the underlying ttyd / tmux.

The target state SHALL be a discriminated union with these modes:
- **Standard mode** (`kind: 'standard'`): carries `(project, scope, slug, agent)` and starts or reattaches through the standard terminal API.
- **Raw mode** (`kind: 'raw'`): carries `sessionName` and attaches to an existing tmux session by name.
- **Herdr mode** (`kind: 'herdr'`): optionally carries `(project, scope, slug)` and starts or reattaches the shared Herdr ttyd client after target workspace setup when a target is present.

The provider SHALL expose existing drawer-open methods plus equivalent split-open methods for standard, raw, and Herdr targets. Existing callers of the drawer-open methods SHALL retain their behavior.

The panel header in raw mode SHALL show the sessionName as the title. Closing either the drawer or right split SHALL hide the browser client WITHOUT calling the terminal stop API. The underlying ttyd and backend-managed process SHALL remain alive. The panel SHALL NOT expose a `Close + stop session` button.

On desktop, the drawer SHALL open at the user's persisted drawer width. With no stored preference, its effective width SHALL remain the historical `min(80vw, 1280px)` default. A divider on its left edge SHALL allow pointer dragging and keyboard resizing. The effective width SHALL be clamped so the panel remains usable and a viewport gutter remains visible. The selected drawer width SHALL persist locally and SHALL be independent from the right-split width.

On a viewport below the 768-pixel breakpoint, the resize divider SHALL be hidden and the overlay drawer SHALL remain the only in-page terminal presentation.

#### Scenario: Closing the drawer leaves ttyd and tmux alive
- **GIVEN** the user opened the terminal drawer for `(claude, project-a, run, foo-...)` and ttyd is running
- **WHEN** the user clicks the drawer's close button
- **THEN** the drawer hides
- **AND** the terminal stop API is NOT called
- **AND** the terminal list still returns the same session

#### Scenario: Reopening the drawer reattaches to the live ttyd
- **GIVEN** the drawer was closed and the manager entry is still live
- **WHEN** the user opens the same target again
- **THEN** the drawer reopens using the existing manager-deduplicated ttyd entry

#### Scenario: Route change keeps the terminal visible
- **GIVEN** a drawer or right split is open with an active terminal
- **WHEN** the user navigates to a different dashboard route
- **THEN** the same surface remains open with the same target
- **AND** the ttyd and its managed process are unaffected

#### Scenario: Route change keeps the session alive
- **GIVEN** the drawer is open with an active ttyd session
- **WHEN** the user navigates to a different dashboard route
- **THEN** the drawer stays open showing the same terminal target
- **AND** ttyd and the backend-managed process remain unaffected

#### Scenario: Drawer is reachable from the management page
- **WHEN** the user is on `/manage/tmux` and opens a matchable row in the drawer
- **THEN** the root terminal provider opens above the management page
- **AND** the iframe loads the corresponding ttyd

#### Scenario: Manual row opens in raw mode
- **GIVEN** a manual tmux row named `memon-manual-foo`
- **WHEN** the owner opens it in the drawer or right split
- **THEN** the provider uses raw target state with that session name
- **AND** the terminal attaches by session name instead of starting a parsed target

#### Scenario: Manual row opens drawer in raw mode
- **GIVEN** the user selects a manual tmux row such as `memon-manual-foo`
- **WHEN** the drawer opens
- **THEN** the provider uses raw target state with that session name
- **AND** the terminal attaches through the raw attach API rather than starting a parsed target

#### Scenario: Drawer preserves its historical initial width
- **GIVEN** no drawer width preference exists and the viewport is 1920 pixels wide
- **WHEN** the drawer opens
- **THEN** its initial width is 1280 pixels

#### Scenario: Drawer width caps at 80vw on small screens
- **GIVEN** no stored drawer width and a 1024-pixel viewport
- **WHEN** the drawer opens
- **THEN** its initial width is approximately 819 pixels
- **AND** the resize bounds keep a visible viewport gutter

#### Scenario: Drawer width caps at 1280px on wide screens
- **GIVEN** no stored drawer width and a 1920-pixel viewport
- **WHEN** the drawer opens
- **THEN** its initial width is 1280 pixels
- **AND** the user can subsequently resize it within the viewport-aware limits

#### Scenario: Dragging the drawer divider persists width
- **GIVEN** the desktop drawer is open
- **WHEN** the user drags its left divider and releases it at a valid new width
- **THEN** the drawer immediately uses that width
- **AND** reopening or reloading restores that drawer width

#### Scenario: Keyboard resizes the drawer
- **GIVEN** the drawer divider is focused
- **WHEN** the user presses ArrowLeft or ArrowRight
- **THEN** the drawer grows or shrinks respectively within its limits
- **AND** Shift plus an arrow uses a larger adjustment step

#### Scenario: Mobile keeps the overlay behavior
- **GIVEN** the viewport is narrower than 768 pixels
- **WHEN** a caller requests the split surface
- **THEN** the target opens in the overlay drawer
- **AND** no draggable horizontal split is rendered

## ADDED Requirements

### Requirement: Terminal can be docked in a resizable right split

The root terminal provider SHALL support a `split` presentation in addition to the overlay drawer and popup window. In split presentation, the existing dashboard SHALL remain interactive in a left region and the active terminal SHALL occupy a right region without an overlay or modal backdrop. A vertical divider SHALL resize the right region by pointer drag or keyboard, and its width SHALL persist independently from the drawer width.

The split SHALL preserve the dashboard React subtree when opened or closed. Moving the terminal between drawer and split SHALL keep the same target state and SHALL reconnect only the browser client to the manager-deduplicated ttyd entry. The split header SHALL provide controls to move the target back to the drawer, pop it out, or close it.

#### Scenario: Open target directly in split
- **GIVEN** a desktop viewport and an enabled terminal integration
- **WHEN** the owner selects `Open in split view`
- **THEN** the dashboard is visible on the left and the target's ttyd terminal is visible on the right
- **AND** no modal overlay covers the dashboard

#### Scenario: Split divider resizes both regions
- **GIVEN** the right split is open
- **WHEN** the user drags the divider to the left
- **THEN** the terminal becomes wider and the dashboard region becomes narrower
- **AND** both regions remain within their minimum usable widths

#### Scenario: Split width is restored independently
- **GIVEN** the owner has chosen different widths for drawer and split presentations
- **WHEN** each presentation is reopened
- **THEN** each restores its own last committed width

#### Scenario: Move drawer to split without restarting backend process
- **GIVEN** a drawer is attached to a live ttyd entry
- **WHEN** the owner chooses `Split right`
- **THEN** the drawer closes and the same target appears in the right split
- **AND** no new tmux session, Herdr workspace, or duplicate ttyd entry is created

### Requirement: Unified Open With picker exposes split presentation

The shared project, experiment, and run Open With picker SHALL include an `Open in split view` action for the current default integration in addition to its integration choices and popup action. Selecting it SHALL use the same target identity and backend-specific setup as opening the default integration in the drawer.

#### Scenario: Open With launches current default in split
- **GIVEN** the owner's current default integration is Herdr for an experiment target
- **WHEN** the owner selects `Open in split view`
- **THEN** the Herdr target is created or focused using the experiment identity
- **AND** its ttyd client opens in the right split

#### Scenario: Existing main action remains a drawer action
- **WHEN** the owner clicks the main face of Open With
- **THEN** it continues to open the current default integration in the drawer
