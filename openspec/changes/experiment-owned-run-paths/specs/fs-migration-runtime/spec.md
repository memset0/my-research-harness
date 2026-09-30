## ADDED Requirements

### Requirement: Reviewed v6-to-v7 path migration
The v6-to-v7 migration SHALL provide a reusable batch planner, explicit apply and verifier. Planning SHALL be read-only and resolve legacy Experiment Run IDs to unique paths using a bounded one-time inventory. Missing targets, duplicate basename candidates, duplicate owners, ambiguous dependent references and contradictory or Run-only ownership claims SHALL block automatic application until explicit resolutions are reviewed. It SHALL never infer ownership solely from a legacy Run claim. A declared member directory that exists but has no `README.md` is not a blocker: the plan records a `MEMBER_README_MISSING` warning, keeps the declaration and leaves the directory untouched, since there is no Run field to strip. A declared path that is a symlink whose real path stays inside the project root is accepted and processed under its declared path without rewriting it to the target; a symlink whose real path escapes the project root remains a blocker. A file reachable through several accepted paths is planned once.

#### Scenario: Ambiguous legacy ID
- **WHEN** a legacy ID matches two Run directories
- **THEN** the plan reports candidate relative paths and apply refuses the unresolved plan without changing project files

#### Scenario: README-less declared member
- **WHEN** an Experiment declares an existing Run directory that has no `README.md`
- **THEN** the plan keeps the declaration, reports `MEMBER_README_MISSING` as a warning, plans no change for that directory and is not blocked by it

#### Scenario: Symlinked member path
- **WHEN** a declared Run path is a symlink resolving inside the project root
- **THEN** the plan accepts it under the declared path; if the symlink resolves outside the project root, the plan reports a blocker and reads nothing outside

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
The migration SHALL ship `v6-to-v7.md` using the seven-section guide contract, all four canonical edge cases and exact Git message `chore(memon): migrate FS convention v6 -> v7`. FS convention 7 SHALL correspond to application release Major 7, initially 7.0.0. Version mismatches SHALL be intercepted at exactly the two existing detection points — skill preflight and `memon fs-version check` (including its use by `memon install-skills`) — and ordinary CLI, Backend and Web write paths SHALL NOT read the marker. Reads SHALL never auto-migrate data, and no writer SHALL advance the marker outside the reviewed migration.

#### Scenario: Old project opened by new tooling
- **WHEN** a v7 skill or `memon fs-version check` runs against a project whose marker is 6
- **THEN** the check reports `behind`, the skill stops before any spec-file write and recommends the reviewed migration, and no project file changes

#### Scenario: Direct writer on a v6 project
- **WHEN** a v7 CLI, Backend or Web mutation runs directly against a v6 project
- **THEN** it does not consult the marker and writes only canonical v7 forms (project-relative `runs` paths, no Run `experiment` field), which v6 readers of the prepared data already accept

### Staged rollout decision

An explicitly approved data-only migration MAY use `--keep-version` to apply
the membership conversion while preserving the v6 marker byte-for-byte.
Readers and writers SHALL support this state. Verification SHALL check the
actual data format separately from the release marker. Final v7 release and
marker advancement wait until all planned migrations are ready; this step
SHALL NOT trigger an automatic release or claim unrelated migrations passed.
