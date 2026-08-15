## MODIFIED Requirements

### Requirement: Value after this change is 6 with per-file schema compatibility

`FS_CONVENTION_VERSION` SHALL equal `6`. Core SHALL publish the expected schema version for each structured YAML kind. A project marker and its files SHALL be treated as inconsistent when the global marker says v6 but a required sidecar is missing, has no schema version, is older, or is newer than supported.

#### Scenario: Constant has the new value
- **WHEN** this change is archived
- **THEN** `FS_CONVENTION_VERSION === 6` in `packages/core/src/version.ts`
- **AND** the staged v5-to-v6 migration guide and validator exist

#### Scenario: Schema after first install on v4
- **GIVEN** a project root with no prior `.memon/` directory
- **WHEN** the current v6 skills are installed
- **THEN** the new marker records `fs_convention_version: 6`
- **AND** each subsequently created structured YAML file uses the schema version expected for its document kind

#### Scenario: last_migrated_at advances after v3→v4 migration
- **GIVEN** a legacy project is still migrating through the v3-to-v4 step
- **WHEN** that step succeeds before later steps continue to v6
- **THEN** `last_migrated_at` advances for the completed v3-to-v4 step
- **AND** the global marker does not claim v6 until all later staged migration work is published successfully

#### Scenario: Partial YAML migration blocks v6 completion
- **GIVEN** the marker says v6 but one `results.yaml` remains at an unsupported version
- **WHEN** doctor or structured lint runs
- **THEN** it reports an FS/YAML version mismatch and exits non-zero
