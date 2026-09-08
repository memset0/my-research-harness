## ADDED Requirements

### Requirement: Project requests resolve one local configured authority
Every central request SHALL resolve an exact authorized project identity to one configured root and storage group. Browser input SHALL NOT select arbitrary roots, SSH targets or upstream URLs. Unknown/ambiguous identities SHALL fail without fallback. Configuration SHALL remain protected, local and redacted; storage unavailability SHALL be reported separately from missing resources.

#### Scenario: Equal resource IDs
- **WHEN** two configured projects contain the same experiment ID
- **THEN** each request accesses only its selected project

#### Scenario: Unavailable root
- **WHEN** one configured storage group is unavailable
- **THEN** its project remains identifiable with unavailable status while other groups continue

## REMOVED Requirements

### Requirement: Central registry is local, protected, and comment-preserving
**Reason**: The remote Backend hosting model is retired.
**Migration**: Resolve authorized project identities to protected local configured roots; retain optional explicit SSH execution providers, not upstream Backend routes.

### Requirement: URL and SSH transports normalize to one upstream
**Reason**: The remote Backend hosting model is retired.
**Migration**: Resolve authorized project identities to protected local configured roots; retain optional explicit SSH execution providers, not upstream Backend routes.

### Requirement: Gateway routes to exactly one configured Host
**Reason**: The remote Backend hosting model is retired.
**Migration**: Resolve authorized project identities to protected local configured roots; retain optional explicit SSH execution providers, not upstream Backend routes.

### Requirement: Gateway prevents credential forwarding and SSRF
**Reason**: The remote Backend hosting model is retired.
**Migration**: Resolve authorized project identities to protected local configured roots; retain optional explicit SSH execution providers, not upstream Backend routes.

### Requirement: Host state distinguishes failure classes
**Reason**: The remote Backend hosting model is retired.
**Migration**: Resolve authorized project identities to protected local configured roots; retain optional explicit SSH execution providers, not upstream Backend routes.

### Requirement: Runtime and operations paths remain separate
**Reason**: The remote Backend hosting model is retired.
**Migration**: Resolve authorized project identities to protected local configured roots; retain optional explicit SSH execution providers, not upstream Backend routes.
