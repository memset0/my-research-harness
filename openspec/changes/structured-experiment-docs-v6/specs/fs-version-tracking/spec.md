## MODIFIED Requirements

### Requirement: Value after this change is 6 with per-file schema compatibility

`FS_CONVENTION_VERSION` SHALL equal `6`. Core SHALL publish the expected schema version for each structured YAML kind. A project marker and its files SHALL be treated as inconsistent when the global marker says v6 but a required sidecar is missing, has no schema version, is older, or is newer than supported.

#### Scenario: Partial YAML migration blocks v6 completion
- **GIVEN** the marker says v6 but one `results.yaml` remains at an unsupported version
- **WHEN** doctor or structured lint runs
- **THEN** it reports an FS/YAML version mismatch and exits non-zero
