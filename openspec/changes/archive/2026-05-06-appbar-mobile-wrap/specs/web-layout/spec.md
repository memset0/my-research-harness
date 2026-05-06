## ADDED Requirements

### Requirement: AppBar tabs wrap on narrow viewports

The AppBar tab list SHALL wrap onto additional rows inside the
AppBar when it cannot fit on a single row (typical on phone-width
viewports), instead of overflowing the viewport horizontally. The
AppBar's height SHALL grow to fit the wrapped row count; on
single-row layouts the AppBar SHALL retain its standard 48px floor
(`min-h-12`).

The `SidebarTrigger` SHALL remain vertically centered relative to
the (potentially multi-row) tab block, achieved via the AppBar
container's `items-center` and the trigger's intrinsic single-row
height.

The page body SHALL NOT gain a horizontal scrollbar as a result of
the tab list overflowing. (The pre-existing avoidance of
`overflow-x-auto` on the nav stays — that comment in
`app-bar.tsx` documents why.)

#### Scenario: Tabs wrap to a second row on a narrow viewport
- **GIVEN** a viewport whose width is too small to fit all tabs
  on one row alongside the sidebar trigger
- **WHEN** the AppBar renders
- **THEN** the tab list element carries the `flex-wrap` class and
  the tabs flow onto two or more rows
- **AND** the AppBar header's height has grown to accommodate the
  rows (it is no longer fixed at 48px)
- **AND** the document body has no horizontal scroll

#### Scenario: Single-row layout keeps 48px floor
- **GIVEN** a viewport wide enough for all tabs to fit on one row
- **WHEN** the AppBar renders
- **THEN** the AppBar header is 48px tall (no growth from the
  base `min-h-12`)

#### Scenario: SidebarTrigger stays vertically centered
- **GIVEN** the AppBar has wrapped its tabs onto two rows
- **WHEN** the AppBar renders
- **THEN** the `SidebarTrigger` button is vertically centered
  within the AppBar (its center aligns with the midpoint of the
  multi-row tab block, NOT with the top row's midpoint)
