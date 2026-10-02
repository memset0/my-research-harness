## ADDED Requirements

### Requirement: Value after this change is 9 with per-Run result files

`FS_CONVENTION_VERSION` SHALL equal `9`, and `MEMON_RELEASE` SHALL start the matching `9.0.0` release. FS v9 keeps every v8 convention except the Results model: an Experiment bundle holds the description file `experiment.json` instead of `results.yaml`, a Run directory MAY hold a tracked `result.csv`, an Experiment MAY hold `schema-upgrades/`, generated Results summaries live under `.memon/index/results/`, and the derived index uses `index_version: 2`. `implementation.yaml`, `investigation.yaml`, Run README frontmatter and `.memon/project.yml` keep their v8 formats. A marker SHALL claim v9 only after the reviewed v8-to-v9 migration has written and verified the new files.

#### Scenario: Constant has the new value
- **WHEN** the v9 release commit lands
- **THEN** `FS_CONVENTION_VERSION === 9` and `MEMON_RELEASE === '9.0.0'` in `packages/core/src/version.ts`
- **AND** `packages/core/migrations/v8-to-v9.md` exists and follows the guide-authoring spec

#### Scenario: Fresh install
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** v9 skills are installed
- **THEN** the new marker records `fs_convention_version: 9`

#### Scenario: v8 marker under v9 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 8`
- **WHEN** `memon fs-version check` runs with v9 tooling
- **THEN** it reports `behind` and recommends the reviewed v8-to-v9 migration; it does not rewrite the marker

#### Scenario: v9 marker under v8 tooling
- **GIVEN** a project whose marker records `fs_convention_version: 9`
- **WHEN** a v8 skill preflight runs
- **THEN** `memon fs-version check` exits 11 with `MEMON_TOO_OLD` and the skill stops

## REMOVED Requirements

### Requirement: Value after this change is 8 with the derived index convention
**Reason**: Superseded by the FS v9 value requirement; the v8 invariants (default Run locations, no nested Runs, the derived index, the optional `.memon/project.yml`) remain in force and are carried by their own capability specs.
**Migration**: Projects at marker 8 follow `packages/core/migrations/v8-to-v9.md`.
