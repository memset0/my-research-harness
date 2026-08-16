## MODIFIED Requirements

### Requirement: Terminal can be docked in a resizable right split

The terminal surface provider SHALL support a `split` presentation in addition to the overlay drawer and popup window. In split presentation, the existing page content SHALL remain interactive in a left region and the active terminal SHALL occupy the shared right-side workspace slot without an overlay or modal backdrop. The project AppBar, or the manage-page header, SHALL remain outside and above both regions so it spans the complete workspace width. A vertical divider SHALL resize the right region by pointer drag or keyboard, and its width SHALL persist independently from the drawer width.

The split SHALL preserve the page React subtree when opened or closed. Moving the terminal between drawer and split SHALL keep the same target state and SHALL reconnect only the browser client to the manager-deduplicated ttyd entry. The split header SHALL provide controls to move the target back to the drawer, pop it out, or close it. Terminal and Report content SHALL be mutually exclusive occupants of the shared right-side slot; replacing a visible terminal with a Report SHALL hide the browser client without stopping its backend session.

#### Scenario: Open target directly in split
- **GIVEN** a desktop viewport and an enabled terminal integration
- **WHEN** the owner selects `Open in split view`
- **THEN** the page content is visible on the left and the target's ttyd terminal is visible on the right below the shared header
- **AND** no modal overlay covers the page

#### Scenario: Split divider resizes both regions
- **GIVEN** the right split is open
- **WHEN** the user drags the divider to the left
- **THEN** the terminal becomes wider and the left page-content region becomes narrower
- **AND** the shared header and project sidebar are not divided or compressed by that divider
- **AND** both content regions remain within their minimum usable widths

#### Scenario: Split width is restored independently
- **GIVEN** the owner has chosen different widths for drawer and split presentations
- **WHEN** each presentation is reopened
- **THEN** each restores its own last committed width

#### Scenario: Move drawer to split without restarting backend process
- **GIVEN** a drawer is attached to a live ttyd entry
- **WHEN** the owner chooses `Split right`
- **THEN** the drawer closes and the same target appears in the right split below the shared header
- **AND** no new tmux session, Herdr workspace, or duplicate ttyd entry is created

#### Scenario: Report replaces visible terminal without stopping it
- **GIVEN** a terminal browser client occupies the right split
- **WHEN** a Report is opened in the shared right-side slot
- **THEN** the terminal client is hidden and the Report becomes visible
- **AND** the terminal backend remains available for later attachment
