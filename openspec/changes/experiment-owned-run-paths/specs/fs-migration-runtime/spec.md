## ADDED Requirements

### Requirement: Reviewed v6-to-v7 path migration
The v6-to-v7 migration SHALL provide a reusable batch planner, explicit apply and verifier. Planning SHALL be read-only and resolve legacy Experiment Run IDs to unique paths using a bounded one-time inventory. Missing targets, duplicate basename candidates, duplicate owners, ambiguous dependent references and contradictory or Run-only ownership claims SHALL block automatic application until explicit resolutions are reviewed. It SHALL never infer ownership solely from a legacy Run claim.

#### Scenario: Ambiguous legacy ID
- **WHEN** a legacy ID matches two Run directories
- **THEN** the plan reports candidate relative paths and apply refuses the unresolved plan without changing project files

#### Scenario: Run-only claim
- **WHEN** a Run claims an Experiment that does not list it
- **THEN** planning requires an explicit decision to amend the Experiment declaration or drop that claim before removing the Run field

### Requirement: Migration preserves data and recovers safely
Apply SHALL check reviewed source fingerprints, preserve unknown frontmatter and document bodies, back up touched files, and modify only planned membership/reference fields and FS metadata. Run outputs SHALL not be moved or traversed. Dirty worktrees SHALL be refused by default. An explicit operator approval MAY enable scoped dirty-tree apply with fingerprint checks and external backups; it SHALL NOT authorize staging unrelated pre-existing edits. Verification SHALL complete before publishing the v7 marker. Interrupted migrations SHALL support recovery without overwriting concurrent edits; fully applied verified plans SHALL be idempotent.

#### Scenario: Source changes after approval
- **WHEN** a planned file changes before apply
- **THEN** apply rejects the stale plan without overwriting the edit or advancing the FS marker

#### Scenario: Partial apply recovery
- **WHEN** a migration is interrupted after some file writes
- **THEN** recovery uses recorded preimages/postimages and refuses to overwrite files edited since those writes

### Requirement: Consecutive guide and version gate
The migration SHALL ship `v6-to-v7.md` using the seven-section guide contract, all four canonical edge cases and exact Git message `chore(memon): migrate FS convention v6 -> v7`. FS convention 7 SHALL correspond to application release Major 7, initially 7.0.0. v7 mutations of v6 projects SHALL fail with migration-required guidance; reads SHALL never auto-migrate data.

#### Scenario: Old project opened by new tooling
- **WHEN** v7 tooling is asked to mutate a v6 project
- **THEN** it requests explicit migration and leaves all project files unchanged
