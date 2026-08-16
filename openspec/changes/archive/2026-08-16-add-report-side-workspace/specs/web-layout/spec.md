## ADDED Requirements

### Requirement: AppBar spans the paired-document workspace

On project routes, the AppBar SHALL be laid out above the complete content workspace rather than inside the left split region. Opening, closing, or resizing a right-side terminal or Report SHALL affect only the content region below the AppBar; it SHALL NOT divide, duplicate, horizontally compress, or obscure the AppBar. The project sidebar SHALL also remain outside the paired content split.

On manage routes, the manage header and SidebarTrigger SHALL follow the same rule when a terminal split is open.

#### Scenario: Project AppBar remains shared above Report split
- **GIVEN** a project page is open
- **WHEN** a Report opens in the right split
- **THEN** one AppBar spans above both the left document and the Report
- **AND** only the region below the AppBar is divided

#### Scenario: Project AppBar remains shared above terminal split
- **WHEN** a terminal opens in the right split on a project route
- **THEN** the AppBar retains the full project inset width above both content regions
- **AND** its tabs and controls are not constrained to the left region

#### Scenario: Manage header remains shared above terminal split
- **WHEN** a terminal opens in the right split on a manage route
- **THEN** the manage header remains above the divided content workspace
- **AND** its SidebarTrigger remains available
