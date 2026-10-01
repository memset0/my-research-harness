## ADDED Requirements

### Requirement: Anomalies served from the derived index agree with disk
When central computes membership anomalies from derived-index entries, the anomaly set SHALL equal the set computed from the project files for the same inputs, except for edits made outside memon within the list validation window. `PHANTOM_RUN_REF` for a project-relative declaration SHALL still be decided by the declared path on disk (an indexed entry counts as existing only while its fingerprint is valid). A missing, damaged or unsupported index SHALL fall back to computing anomalies from files.

#### Scenario: Index and disk agree after rebuild
- **WHEN** a rebuild completes and anomalies are requested from a freshly started central
- **THEN** the anomaly records equal those computed from files without an index

#### Scenario: Declared Run deleted outside memon
- **GIVEN** an indexed member Run whose directory is deleted by a script
- **WHEN** its entry is next validated
- **THEN** the entry is removed and the declaration is reported as `PHANTOM_RUN_REF`

### Requirement: Index drift and layout notices are lint, not membership anomalies
`INDEX_DRIFT`, `RUN_OUTSIDE_RUN_DIRS` and `RUN_NESTED` SHALL be reported by lint and index verification only. They SHALL NOT be emitted on the anomaly stream, counted in the anomaly banner or block membership; a declared path that is outside the effective Run locations or nested SHALL keep its membership classification by path.

#### Scenario: Drift does not raise the banner
- **GIVEN** an index entry that disagrees with its README
- **WHEN** anomalies are requested
- **THEN** no anomaly record carries `INDEX_DRIFT`, and `memon index status --verify` lists the drift
