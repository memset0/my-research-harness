## MODIFIED Requirements

### Requirement: Report inbox empty state names its authoring workflow

The inbox SHALL render kind-specific empty states. Reports SHALL identify memon-write-report as the authoring workflow. Copy SHALL remain a property of the shared layout rather than hardcoded behavior. With no Report selected, the reading pane SHALL show the authoring empty state only when the Report list has loaded and is empty; while it loads it SHALL show a loading placeholder, when Reports exist it SHALL ask the reader to select one from the report list, and when the list fails it SHALL show the failure. Whenever the picker is hidden, the control to show it SHALL remain available in that pane.

#### Scenario: Empty reports directory
- **WHEN** a project has no matching Report files
- **THEN** the pane points to memon-write-report and the rail shows an empty placeholder

#### Scenario: Reports exist but none is selected
- **GIVEN** a project with published Reports and the picker hidden by the reader's preference
- **WHEN** the reader opens the Reports landing route
- **THEN** the pane asks the reader to select a report and offers the show-reports control
- **AND** it does not say that there are no reports
