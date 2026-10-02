## ADDED Requirements

### Requirement: Value after this change is 8 with the derived index convention

`FS_CONVENTION_VERSION` SHALL equal `8`, and `MEMON_RELEASE` SHALL start the matching `8.0.0` release. FS v8 keeps every v7 document format and per-file YAML schema version; its breaking changes are that an absent Project `run_dirs` means the default Run locations `["logs/*", "outputs/*", "experiments/*"]` instead of an unbounded walk, that Run directories do not nest, and that memon writers maintain the derived index under `.memon/index/`. FS v8 also introduces the optional tracked declaration `.memon/project.yml` (`schema_version: 1`); its absence is valid and no marker transition creates it. A marker SHALL claim v8 only after the reviewed v7-to-v8 migration has built and verified the index.

#### Scenario: Constant has the new value
- **WHEN** the v8 release commit lands
- **THEN** `FS_CONVENTION_VERSION === 8` and `MEMON_RELEASE === '8.0.0'` in `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v7-to-v8.md` exists and follows the guide-authoring spec

#### Scenario: Fresh install
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** v8 skills are installed
- **THEN** the new marker records `fs_convention_version: 8` and no document format differs from v7

#### Scenario: v7 marker under v8 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 7`
- **WHEN** `memon fs-version check` runs with v8 tooling
- **THEN** it reports `behind` and recommends the reviewed v7-to-v8 migration; it does not rewrite the marker

#### Scenario: v8 marker under v7 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 8`
- **WHEN** a v7 skill preflight runs
- **THEN** `memon fs-version check` exits 11 with `MEMON_TOO_OLD` and the skill stops

## REMOVED Requirements

### Requirement: Value after this change is 7 with Experiment-owned Run paths
**Reason**: Superseded by the FS v8 value requirement; the v7 invariants (Experiment-owned project-relative Run paths, no Run `experiment` field, digests as wiki pages) remain in force and are carried by their own capability specs.
**Migration**: Projects at marker 7 follow `packages/core/migrations/v7-to-v8.md`.
