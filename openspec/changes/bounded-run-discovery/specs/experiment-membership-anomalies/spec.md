## MODIFIED Requirements

### Requirement: Declaration anomaly records

The indexer SHALL produce in-memory anomaly records from Experiment declarations alone:

| Code | Trigger |
|---|---|
| `PHANTOM_RUN_REF` | an Experiment `runs[]` entry resolves to no Run directory, or to an ambiguous legacy base name |
| `MISMATCH_EXPERIMENT_REF` | the same Run path is declared by more than one Experiment |

Whether a project-relative `runs[]` path resolves to a Run directory SHALL be decided by checking that path directly beneath the project root (contained, non-escaping, and a directory), not by looking it up in the result of the Run walk; directories hidden from the walk by excludes or by `run_depth` SHALL still count as existing. An existing declared directory without a README SHALL NOT be reported as `PHANTOM_RUN_REF`; it is a member whose Run record carries the existing README-less Run classification (`hasReadme: false`, synthesized identity, README-less lint). A path that is missing, not a directory, malformed or escapes the project SHALL be reported as `PHANTOM_RUN_REF`. Legacy base-name references (no `/`) SHALL continue to resolve through discovered Runs.

`ORPHAN_RUN` remains in the wire code union for compatibility but SHALL NOT be emitted: an unassigned Run is valid. A legacy Run `experiment` field is reported by Run structural lint, never as a membership anomaly. Each record SHALL carry `code` (one of the codes above or a slug-uniqueness code), `project`, `runId` (the declared reference) when a Run is involved, `experimentId` when an Experiment is involved, a one-sentence `message` and `detectedAt` (ISO8601 with offset).

#### Scenario: PHANTOM_RUN_REF detected
- **GIVEN** an experiment `E0001-foo` with `runs: ["logs/bar-260502-100000"]` but that directory does not exist
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `PHANTOM_RUN_REF` record naming the exp and the missing path, and the declaration is kept

#### Scenario: Declared path hidden from the walk is not a phantom
- **GIVEN** a Project excluding `outputs` and an experiment declaring `outputs/sweep/a-260901-090000`, which exists
- **WHEN** the indexer evaluates anomalies
- **THEN** no `PHANTOM_RUN_REF` names that path and the Experiment lists it as a confirmed member

#### Scenario: Declared directory without README
- **GIVEN** an experiment declaring `logs/r-260901-090000`, an existing directory with no README
- **WHEN** the indexer evaluates anomalies
- **THEN** no `PHANTOM_RUN_REF` names that path and the member's Run record reports `hasReadme: false`

#### Scenario: Duplicate owners detected
- **GIVEN** `E0001-foo` and `E0002-bar` both declare `logs/qux-260503-100000`
- **WHEN** the indexer evaluates anomalies
- **THEN** each Experiment gets a `MISMATCH_EXPERIMENT_REF` record for that path and neither lists it as a confirmed member

#### Scenario: Unassigned Run is not an anomaly
- **GIVEN** a Run that no Experiment declares
- **WHEN** the indexer evaluates anomalies
- **THEN** no anomaly record names that Run
