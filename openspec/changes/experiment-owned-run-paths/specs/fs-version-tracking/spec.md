## ADDED Requirements

### Requirement: Value after this change is 7 with Experiment-owned Run paths

`FS_CONVENTION_VERSION` SHALL equal `7`, and `MEMON_RELEASE` SHALL start the matching `7.0.0` release. FS v7 keeps every v6 per-file YAML schema version; its breaking changes are that Experiment `runs` declare project-relative Run paths as the sole membership authority, Run READMEs no longer carry `experiment`, and legacy `docs/digests/` files become `digest`-kind Wiki pages. A marker SHALL claim v7 only after the reviewed v6-to-v7 migration has verified those invariants.

#### Scenario: Constant has the new value
- **WHEN** the v7 release commit lands
- **THEN** `FS_CONVENTION_VERSION === 7` and `MEMON_RELEASE === '7.0.0'` in `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v6-to-v7.md` exists and follows the guide-authoring spec

#### Scenario: Fresh install
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** v7 skills are installed
- **THEN** the new marker records `fs_convention_version: 7` and each created structured YAML file uses the unchanged v6 per-kind schema version

#### Scenario: v6 marker under v7 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 6`
- **WHEN** `memon fs-version check` runs with v7 tooling
- **THEN** it reports `behind` and recommends the reviewed v6-to-v7 migration; it does not rewrite the marker

#### Scenario: Partial YAML migration still blocks completion
- **GIVEN** the marker says v7 but one `results.yaml` remains at an unsupported schema version
- **WHEN** structured lint runs
- **THEN** it reports an FS/YAML version mismatch and exits non-zero

## REMOVED Requirements

### Requirement: Value after this change is 6 with per-file schema compatibility
**Reason**: Superseded by the FS v7 release.
**Migration**: See "Value after this change is 7 with Experiment-owned Run paths"; the v6 per-file schema compatibility rules carry over unchanged.
