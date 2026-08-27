## ADDED Requirements

### Requirement: Project read routes share indexed snapshot state
All fixed Backend Project read routes SHALL use the owning Project's shared snapshot generation. ID-addressed routes SHALL use direct indexes, and list/detail/results/files/hypotheses/journal/anomaly routes MUST NOT each trigger an independent recursive discovery pass.

#### Scenario: Mixed read family shares one generation
- **WHEN** a client requests a Project list, an Experiment detail, and a Run detail without an intervening change
- **THEN** every response is derived from one snapshot generation
- **AND** at most zero refreshes occur after that generation is already warm

### Requirement: Project include patterns constrain discovery
Configured Project include/exclude patterns SHALL constrain both snapshot refresh and filesystem monitoring consistently. A narrower machine-local include policy MUST NOT be silently ignored by either path.

#### Scenario: Unrelated nested artifact resembles a Run ID
- **WHEN** a nested artifact directory matches the Run naming regex but is outside the configured include patterns
- **THEN** it is not indexed, monitored, returned, or treated as an anomaly-producing Run
