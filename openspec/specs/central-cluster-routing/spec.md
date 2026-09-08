# central-cluster-routing Specification

## Purpose
Resolve host-qualified project namespaces to authorized configured roots and explicit command providers.

## Requirements

### Requirement: Project requests resolve one local configured authority
Every central request SHALL resolve an exact authorized project identity to one configured root and storage group. Browser input SHALL NOT select arbitrary roots, SSH targets or upstream URLs. Unknown/ambiguous identities SHALL fail without fallback. Configuration SHALL remain protected, local and redacted; storage unavailability SHALL be reported separately from missing resources.

#### Scenario: Equal resource IDs
- **WHEN** two configured projects contain the same experiment ID
- **THEN** each request accesses only its selected project

#### Scenario: Unavailable root
- **WHEN** one configured storage group is unavailable
- **THEN** its project remains identifiable with unavailable status while other groups continue
