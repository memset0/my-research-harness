## ADDED Requirements

### Requirement: Experiment View authorization is scope-exact and read-only for viewers

The central authorization layer SHALL classify Experiment View collection reads as exact Project-scoped reads and all View lifecycle or definition mutations as owner-only. In central mode a viewer read SHALL require the exact Host+Project pair carried by its validated share scope; Project-name equality without Host equality SHALL NOT grant access. Route handlers SHALL repeat role and scope validation instead of relying only on disabled UI controls.

#### Scenario: Viewer collection read is allowed in exact scope

- **GIVEN** a validated viewer scope for Host A and Project X
- **WHEN** the viewer lists Views for an Experiment on Host A and Project X
- **THEN** the read succeeds

#### Scenario: Viewer View mutation is denied

- **GIVEN** a validated viewer scope for the target Experiment
- **WHEN** the viewer directly submits a create, update, rename, or delete request
- **THEN** the request is rejected as forbidden
- **AND** SQLite remains unchanged
