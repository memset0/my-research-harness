# cluster-backend-lifecycle Specification

## Purpose
Describe independent CLI/skills installation with no remote Backend service lifecycle.

## Requirements

### Requirement: Remote installation contains no required Backend lifecycle
The remote memon installation SHALL provide CLI and managed skills without a required Backend worker, supervisor, protocol negotiation or fleet update service. Removed Backend commands SHALL not remain as compatibility shims that start the retired service.

#### Scenario: CLI only node
- **WHEN** a user installs or updates remote memon
- **THEN** the CLI and skills can operate without starting a memon listener
