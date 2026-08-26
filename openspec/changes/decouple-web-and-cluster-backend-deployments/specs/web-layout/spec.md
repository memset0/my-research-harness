## ADDED Requirements

### Requirement: Central navigation hierarchy is Host then Project
In central mode, primary navigation SHALL expose configured Hosts and their live Projects with visible Host ownership and status. Project links SHALL include Host. Standalone layout SHALL preserve its current project-only navigation.

#### Scenario: Equal-name Projects are distinguishable in sidebar
- **WHEN** two Hosts expose `project-x`
- **THEN** the sidebar shows two entries under their respective Hosts with distinct links

### Requirement: Persisted layout state is Host-qualified
Central sidebar expansion, last-selected Project, responsive navigation, and other Project-specific layout persistence SHALL include Host identity so one Host cannot overwrite another Host's equal-name state.

#### Scenario: Expansion state does not collide
- **WHEN** a user expands `project-x` under Host A but not Host B
- **THEN** remounting restores those two independent states

### Requirement: Host status remains navigable without stale Project data
An unusable Host SHALL remain visible with status/help affordance even when its prior Project list is removed. The layout SHALL NOT present cached Project links as live data for that Host.

#### Scenario: Host goes offline after page load
- **WHEN** a Host transitions from online to offline
- **THEN** its status remains visible, its stale Project navigation is removed/disabled, and other navigation remains stable
