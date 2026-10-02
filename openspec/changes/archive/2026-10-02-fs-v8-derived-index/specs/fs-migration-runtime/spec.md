## ADDED Requirements

### Requirement: Mechanical v7-to-v8 migration
The v7-to-v8 migration SHALL NOT modify, move or rewrite any project document or directory other than `.memon/index/` and `.memon/version.json`, and SHALL NOT create, edit or delete `.memon/project.yml` (a mechanical migration adds no user document; the default Run locations cover the common layouts). Planning SHALL be read-only: it SHALL check marker 7 and the working tree, and SHALL report the Run-shaped directories that the effective Run locations will no longer discover (the rebuild audit) together with any `RUN_NESTED` declarations, as warnings that need the operator's acknowledgement, not as automatic rewrites; the warning SHALL name the remedies — declaring the locations after the migration in `.memon/project.yml` (`memon project init`, edit, commit), in the central Project configuration, or accepting that those Runs leave walks. Planning and apply SHALL use the effective `run_dirs` of the invocation, including an existing `.memon/project.yml`. Apply SHALL build the derived index with a full rebuild (creating `.memon/index/.gitignore` first), SHALL verify it (`memon index status --verify --strict` succeeds and `git check-ignore` reports the snapshot as ignored in git mode), and only then SHALL advance the marker to 8 and commit exactly `.memon/version.json`. Re-running apply on a migrated project SHALL be a no-op apart from refreshing the index. An operator entry `scripts/migrate-v7-to-v8.mjs` with a companion `scripts/migrate-v7-to-v8.md` SHALL offer `plan`, `apply`, `verify` and `rollback` in the shape of the v6-to-v7 entry and SHALL NOT install, stop, restart or publish services.

#### Scenario: Plan reports deep Runs
- **GIVEN** a v7 project with Runs at `outputs/<group>/<run>` and no declared `run_dirs`
- **WHEN** the migration is planned
- **THEN** the plan lists those Run paths as warnings requiring acknowledgement and no file is written

#### Scenario: Migration never creates the declaration
- **GIVEN** a v7 project without `.memon/project.yml` whose plan reported deep Runs
- **WHEN** the acknowledged migration is applied
- **THEN** `.memon/project.yml` still does not exist and the report recommends creating it

#### Scenario: Apply changes only the marker in git
- **WHEN** an acknowledged v7-to-v8 migration is applied in git mode
- **THEN** the migration commit contains only `.memon/version.json`, `.memon/index/` exists and is ignored, and no Run, Experiment or wiki file differs

#### Scenario: Verification fails
- **WHEN** index verification reports drift after the rebuild
- **THEN** the marker stays at 7 and the migration reports the drift

### Requirement: v8 guide and version gate
The migration SHALL ship `packages/core/migrations/v7-to-v8.md` using the seven-section guide contract, all four canonical edge cases and exact Git message `chore(memon): migrate FS convention v7 -> v8`. Its `## Edge Cases` SHALL additionally state that a project whose Runs live deeper than, or outside, the default locations should create `.memon/project.yml` by hand (or with `memon project init`) after the migration, declare its `run_dirs`, commit it separately from the migration commit, and run `memon index rebuild`. FS convention 8 SHALL correspond to application release Major 8, initially 8.0.0. Version mismatches SHALL continue to be intercepted only at skill preflight and `memon fs-version check` (including its use by `memon install-skills`); ordinary CLI, Backend and Web write paths, including index event publishing, SHALL NOT read the marker. Reads SHALL never auto-migrate, and no writer SHALL advance the marker outside the reviewed migration. Rollback SHALL be the revert of the migration commit (marker back to 7); deleting `.memon/index/` SHALL always be allowed and SHALL NOT require a marker change.

#### Scenario: v8 writer on a v7 project
- **WHEN** a v8 CLI writes a Run status on a project whose marker is 7
- **THEN** the write succeeds, publishes an index event, and the marker is unchanged

#### Scenario: Rollback
- **WHEN** the operator reverts the migration commit
- **THEN** the marker reads 7 and v7 tooling works on the project whether or not `.memon/index/` is deleted
