## ADDED Requirements

### Requirement: Report HTML embeds share stepped zoom controls

A rendered Report containing one or more embedded HTML iframe views SHALL expose zoom-out and zoom-in controls in the embed toolbar. The zoom SHALL default to `100%`, where the iframe uses its original scale, and each control activation SHALL change the percentage by exactly 10 percentage points. The current percentage SHALL be visibly and accessibly labelled.

All HTML iframe embeds within the same rendered Report surface SHALL share the current percentage so one adjustment applies uniformly. Zooming SHALL scale the iframe document view while preserving the host Report layout, iframe viewport boundary, loading/error lifecycle, fullscreen behavior, and open-in-new-tab destination. The controls SHALL enforce a finite supported range and disable the direction that has reached its bound.

The iframe toolbar SHALL retain compact control heights on narrow mobile viewports so its zoom, open-in-new-tab, and fullscreen actions do not consume disproportionate vertical space.

#### Scenario: Zoom changes in ten-percent steps
- **GIVEN** an embedded HTML Report is ready at the default `100%`
- **WHEN** the user activates Zoom in once and Zoom out twice
- **THEN** the displayed percentages progress through `110%`, `100%`, and `90%`
- **AND** the iframe view uses the corresponding scale at each step

#### Scenario: Multiple Report iframes share one percentage
- **GIVEN** one rendered Report contains two embedded HTML iframe views
- **WHEN** the user changes either embed from `100%` to `110%`
- **THEN** both iframe views render at `110%`
- **AND** both toolbars display `110%`

#### Scenario: Original scale remains the default
- **WHEN** a Report HTML embed first mounts with no adjustment
- **THEN** its visible zoom value is `100%`
- **AND** the iframe is not enlarged or reduced from its original scale

#### Scenario: Mobile toolbar stays compact
- **GIVEN** a Report HTML embed is rendered on a narrow mobile viewport
- **WHEN** its toolbar actions are displayed
- **THEN** the zoom, open-in-new-tab, and fullscreen buttons use the compact toolbar height
- **AND** the iframe content keeps the remaining vertical space
