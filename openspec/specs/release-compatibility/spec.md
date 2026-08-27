# release-compatibility Specification

## Purpose
Defines memon's filesystem-aligned Major, Backend/CLI-changing Minor, central-only Patch, and exact adjacent-Minor compatibility policy.

## Requirements

### Requirement: Release axes have fixed meanings
The memon release SHALL be `MAJOR.MINOR.PATCH`. `MAJOR` SHALL equal `FS_CONVENTION_VERSION`; `MINOR` SHALL change for every Backend or CLI artifact change; and `PATCH` SHALL change only central Web/gateway artifacts. A Patch release MUST NOT change Backend or CLI bytes.

#### Scenario: First release is derived from current filesystem convention
- **WHEN** this split architecture is first released while `FS_CONVENTION_VERSION` is 6
- **THEN** its release is `6.0.0`

#### Scenario: Backend code change increments Minor
- **WHEN** a later release changes Backend or CLI source/artifacts
- **THEN** its Minor increases and affected cluster distributions require update

#### Scenario: Frontend-only fix increments Patch
- **WHEN** a release changes only central Web/gateway code
- **THEN** only Patch increases and no Backend/CLI reinstall is required

### Requirement: One change may span multiple pinned releases
OpenSpec change lifecycle SHALL be independent from release lifecycle. An active change MAY produce multiple sequential release boundaries before it is complete. Every boundary SHALL apply the Major/Minor/Patch surface rules, update the canonical version, commit and push the reviewed source before deployment, and pin central plus affected nodes to the same exact revision. Shipping one boundary SHALL NOT by itself archive the change.

#### Scenario: Refinement after the first deployment
- **WHEN** `6.0.0` is deployed while this change still has implementation or rollout work and a later Backend refinement is required
- **THEN** the change remains active, the refinement advances to `6.1.0`, and nodes install the exact pushed `6.1.0` revision

#### Scenario: Central-only refinement inside the same change
- **WHEN** the latest boundary is `6.1.0` and the next refinement changes only central Web/gateway bytes
- **THEN** the next boundary is `6.1.1` and Backends are not reinstalled

### Requirement: Major release requires matching filesystem migration
A release Major change SHALL include and require the matching reviewed filesystem-convention migration. Cross-Major runtime compatibility SHALL NOT be assumed; a mismatch SHALL be reported as `filesystem_migration_required` rather than network failure.

#### Scenario: v7 cannot ship without v6-to-v7 migration
- **WHEN** a release proposes Major 7 from the current v6 line
- **THEN** release validation fails unless the v6-to-v7 migration contract and implementation are present

### Requirement: Central supports current and immediately prior Backend Minor
Central `M.N.P` SHALL accept Backend `M.N.*` as `online` and `M.(N-1).*` as usable `update_available`. An older Minor SHALL be `upgrade_required`, a newer Minor SHALL be `central_update_required`, a different Major SHALL be `filesystem_migration_required`, and malformed/unsupported API metadata SHALL be incompatible/misconfigured. Patch SHALL not affect Backend compatibility.

#### Scenario: Previous Minor stays usable during rollout
- **WHEN** central is `6.2.4` and a Backend is `6.1.0`
- **THEN** the Backend remains usable and is labelled `update_available`

#### Scenario: Backend ahead blocks routing
- **WHEN** central is `6.1.3` and Backend is `6.2.0`
- **THEN** the Host is `central_update_required` and receives no data requests

### Requirement: Compatibility includes capability negotiation
Central SHALL maintain explicit adapters/capability gates for exactly its current and previous Backend Minor. It SHALL NOT invoke an endpoint or capability absent from the negotiated Backend contract.

#### Scenario: New capability is hidden for previous Minor
- **WHEN** a Backend at `M.(N-1)` lacks a capability added in `M.N`
- **THEN** central keeps the Host usable but does not offer or call that capability

### Requirement: Normal Minor rollout is central-first and pinned
A normal Minor rollout SHALL update central first, then update Backends individually to the exact central target revision through Agent-driven SSH/local CLI operations. It SHALL NOT resolve a moving latest per Host or update the fleet unattended. The initial standalone bootstrap SHALL use its separate side-by-side migration gate.

#### Scenario: Rollout uses one revision
- **WHEN** an Agent updates multiple Backends for a Minor release
- **THEN** every invocation is pinned to the same reviewed target revision and reports per-Host outcome

### Requirement: Rollback respects the compatibility window
Before rolling central back, operations SHALL verify compatibility with every already-upgraded Backend. If the rollback central would reject a newer Backend, those Backends SHALL be rolled back and verified before central is rolled back.

#### Scenario: Partial rollout cannot strand central rollback
- **WHEN** some Backends have advanced beyond the prior central's supported window
- **THEN** operations roll those Backends back first or abort central rollback without changing it
