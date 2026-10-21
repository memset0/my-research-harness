## REMOVED Requirements

### Requirement: HYPOTHESES.md location
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

### Requirement: Hypothesis status legend with 5 states
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

### Requirement: Per-hypothesis entry schema
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

### Requirement: Experiment cross-reference by directory name
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

### Requirement: Summary table rendering
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

### Requirement: Hypothesis ID uniqueness
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

### Requirement: Per-hypothesis `Runs:` field
**Reason**: The managed Hypotheses subsystem is retired.
**Migration**: Preserve existing project files; any conversion is separately agreed per project.

## ADDED Requirements

### Requirement: Retired hypotheses remain project-owned historical content
The product SHALL NOT expose a Hypotheses domain, page, API, parser, status, authoring option, index or automatic cross-reference maintenance. Existing project files and prose SHALL remain unchanged during upgrade. Legacy metadata SHALL be inert compatibility content, not validated or used to derive research state. This retirement supersedes earlier managed-hypothesis contracts.

#### Scenario: Upgrade a historical project
- **WHEN** a project contains docs/hypotheses.md and historical H references
- **THEN** deployment leaves their bytes unchanged and does not read that file for ordinary research browsing
- **AND** migration waits for a project-specific user decision

#### Scenario: Rename an experiment
- **WHEN** an experiment is renamed
- **THEN** the retired hypotheses document is not rewritten implicitly
