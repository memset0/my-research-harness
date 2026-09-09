## ADDED Requirements

### Requirement: FS v7 Experiment declarations own membership
For FS v7, Experiment README `runs` SHALL be the sole membership authority and SHALL contain canonical project-root-relative Run directory paths. This replaces the v6 basename-only `runs` field rules. Missing `runs` means no members; duplicates and malformed references SHALL be diagnosed, not silently discarded. Experiment bundle structure and unrelated fields SHALL remain unchanged.

#### Scenario: Direct declared membership
- **WHEN** an Experiment declares `runs: [logs/batch/train-260901-090000]`
- **THEN** the declared member is that project-relative directory without requiring a Run parent field

#### Scenario: Legacy ID in a v7 document
- **WHEN** a v7 Experiment declares a bare Run ID
- **THEN** validation reports an invalid path reference rather than running a project-wide search or silently dropping it
