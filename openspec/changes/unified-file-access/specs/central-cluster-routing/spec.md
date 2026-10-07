## MODIFIED Requirements

### Requirement: Project requests resolve one local configured authority
Every central request SHALL resolve an exact authorized project identity to one configured file-source authority and source group. Native and SSHFS authorities SHALL use configured roots; agent authorities SHALL use a configured authenticated endpoint, source identity and agent project mapping without requiring a central mount or fake local root. Host SHALL remain an optional namespace independent of access transport; unqualified legacy requests SHALL use the same new primitives, observations, budgets and writer locks while preserving their URLs and response projections. Ambiguous legacy resource IDs SHALL fail rather than select a guessed project. Browser input SHALL NOT select arbitrary roots, SSH targets or upstream URLs. Unknown/ambiguous identities SHALL fail without fallback. Configuration SHALL remain protected, local and redacted; storage unavailability SHALL be reported separately from missing resources.

#### Scenario: Equal resource IDs
- **WHEN** two configured projects contain the same experiment ID
- **THEN** each request accesses only its selected project

#### Scenario: Unavailable root
- **WHEN** one configured storage group is unavailable
- **THEN** its project remains identifiable with unavailable status while other groups continue

#### Scenario: Agent project has no mount
- **WHEN** an authorized request selects a configured agent-backed project
- **THEN** every project file operation resolves to that agent project and no central local-path fallback occurs

#### Scenario: Agent without host
- **WHEN** a project omits host and selects authenticated agent access
- **THEN** its unqualified routes use that agent through the unified file primitives without a central mount, synthetic configured host or legacy native fallback

#### Scenario: Legacy native entry
- **WHEN** an unqualified native memory-cached project serves a foreground request and background validation
- **THEN** both reuse the new shared observations and source budgets without legacy startup scans or independent parsed caches
