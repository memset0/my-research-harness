# release-compatibility Specification

## Purpose
Define filesystem-aligned Major, distributed CLI/skills Minor, central-only Patch and independent native installation.

## Requirements

### Requirement: Release axes have fixed meanings

MAJOR SHALL equal FS_CONVENTION_VERSION. Distributed CLI or bundled-skill artifact changes SHALL increment MINOR and reset PATCH. Central-only Web or in-process service changes SHALL increment PATCH when distributed CLI/skill artifacts are unchanged. There is no separately versioned remote Backend fleet.

#### Scenario: Distributed artifact change
- **WHEN** a release changes CLI or bundled skills
- **THEN** MINOR increases and nodes update independently

#### Scenario: Central-only change
- **WHEN** a release changes only central artifacts
- **THEN** PATCH increases without a remote CLI installation gate

### Requirement: Major release requires matching filesystem migration
A release Major change SHALL include and require the matching reviewed filesystem-convention migration. Cross-Major runtime compatibility SHALL NOT be assumed; a mismatch SHALL be reported as `filesystem_migration_required` rather than network failure.

#### Scenario: v7 cannot ship without v6-to-v7 migration
- **WHEN** a release proposes Major 7 from the current v6 line
- **THEN** release validation fails unless the v6-to-v7 migration contract and implementation are present

### Requirement: Version axes remain unchanged after centralization
MAJOR SHALL continue to equal FS_CONVENTION_VERSION and require its reviewed migration. Changes to distributed CLI artifacts (including bundled skills) SHALL increment MINOR and reset PATCH. Central Web-only changes SHALL increment PATCH without forcing remote reinstall. Retiring Backend artifacts in this migration SHALL be a Minor surface change, not a Major filesystem change.

#### Scenario: Web only fix
- **WHEN** only central Web artifacts change
- **THEN** PATCH increments and remote CLI updates are not required

#### Scenario: CLI or bundled skill change
- **WHEN** distributed CLI or bundled skills change
- **THEN** MINOR increments and PATCH resets

#### Scenario: Filesystem convention change
- **WHEN** the on-disk convention changes
- **THEN** MAJOR changes only with the matching migration

### Requirement: Remote updates are independent and do not run suites
Each remote node MAY invoke memon update to pull the latest configured trusted published CLI/skills source and install it independently. The updater SHALL NOT require central revision discovery or equality, build the Web frontend, run unit tests or project-wide lint/typecheck suites, or execute a per-peer deployment gate. Filesystem convention safety checks SHALL remain.

#### Scenario: Different latest revision
- **WHEN** a node updates after a newer CLI publication than central deployment
- **THEN** it can install that latest source without a central SHA match

#### Scenario: Remote update work
- **WHEN** memon update executes on a CLI node
- **THEN** only update/build/install work needed for CLI/skills occurs, without remote tests or Backend startup

### Requirement: Active changes span independently deployed central releases
OpenSpec change and release lifecycles SHALL remain independent. Central releases SHALL record their exact source revision, and a release SHALL NOT archive an active change. Remote CLI/skills installations SHALL not be pinned to the central revision or block central release completion.

#### Scenario: Remote revision differs
- **WHEN** central is released while a remote CLI remains at an older compatible filesystem version
- **THEN** central release does not require updating or testing that node

### Requirement: Verified releases complete without remote fleet gates
After an authorized implementation satisfies development/release-side gates, release SHALL retain separate implementation and semantic release commits, push the release, deploy and verify central when affected. Required product choices, credentials, unsafe worktree isolation, failed gates or rollback checks SHALL still block deployment. This workflow SHALL NOT require deploying a Backend, matching remote SHAs, or running tests on remote CLI nodes.

#### Scenario: Central release completes
- **WHEN** central post-deployment checks pass while remote nodes have not updated
- **THEN** the release is complete without a fleet rollout

#### Scenario: Development tests fail
- **WHEN** an applicable release-side test fails
- **THEN** deployment stops rather than replacing the gate with remote testing
