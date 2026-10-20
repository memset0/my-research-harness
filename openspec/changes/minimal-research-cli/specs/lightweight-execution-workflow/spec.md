## MODIFIED Requirements

### Requirement: Lint is the sole document check workflow
Structural checks SHALL run within supported creation, publication and reading operations. Separate document lint, doctor and validate command registrations SHALL not be required. Diagnostics SHALL report actual syntax/schema errors without prescribing research prose, conclusions, lifecycle changes or archival.

#### Scenario: Finished Run without a conclusion
- **WHEN** a structurally valid finished Run is published without narrative
- **THEN** publication accepts it without requesting prose or archival
