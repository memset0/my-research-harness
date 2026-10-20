## Purpose

Provide small agent-maintained Experiment declarations and explicit Variant aggregation whose saved results can be read without revisiting execution directories.

## ADDED Requirements

### Requirement: Lightweight declarations retain research intent
An Experiment using `format: "lightweight"` SHALL require only a readable README and optional column/group presentation and per-Variant aggregation settings. It SHALL NOT require binding lists, Variant names/drafts, research versions, development-stage YAML files or fixed README headings. Directory ownership and Run records SHALL determine Variant membership, optional names, planned parameters and active selection. Legacy bundles SHALL remain readable without conversion or changed evidence eligibility.

#### Scenario: Unexecuted draft
- **WHEN** a Variant contains a READY active Run with partial parameters and no metrics
- **THEN** the Variant is visible with planned parameters and no fabricated measurement or required display name

### Requirement: Default aggregation uses only selected evidence
The default aggregator SHALL accept zero or one Run whose `active` flag is true per ordinary Variant and SHALL reject multiple selected Runs unless that Variant explicitly selects custom aggregation. It SHALL exclude smoke and unselected historical Runs. READY Run metrics SHALL be excluded while its planned parameters remain visible. Run paths SHALL resolve within the owning Experiment and Variant directory and reject traversal and symlink escapes.

#### Scenario: Multiple selected Runs without custom aggregation
- **WHEN** a Variant selects two Runs without a custom aggregator
- **THEN** aggregation reports that Variant and leaves any existing experiment result file unchanged

#### Scenario: Historical execution
- **WHEN** one selected Run and several other Run directories belong to a Variant
- **THEN** only the selected Run contributes parameters and metrics

### Requirement: Custom aggregation is per Variant
A Variant SHALL be able to explicitly select the experiment-local `aggregate_variant.py`. The script SHALL receive the specified Variant and its selected Runs and produce that Variant's result data. Other Variants SHALL continue using the default path. Script failure or invalid output SHALL fail the whole update without replacing the prior result file. Website reads SHALL NOT execute scripts.

#### Scenario: Mixed aggregation methods
- **WHEN** one Variant uses a custom script and another uses one selected Run
- **THEN** both outputs appear in the experiment table through their respective aggregation methods

### Requirement: Persisted result tables contain only result data
Aggregation SHALL atomically save the experiment-level `results.csv` containing Variant identifiers and result values. It SHALL contain no generation timestamp, fingerprints, research/schema version or cache metadata. It SHALL be suitable for Git tracking. Readers SHALL combine that table with the declaration without reading Run directories or recomputing results. Missing or malformed saved tables SHALL be explicitly represented without substituting planned data or stale Run evidence.

#### Scenario: Reading a saved table
- **WHEN** a browser requests results for a lightweight Experiment
- **THEN** it reads the declaration and saved table and performs no Run result reads

### Requirement: Explicit Run metadata columns
Declared `run.*` result columns SHALL read selected Run metadata such as status, host, external links and timestamps, without replacing actual parameters or measurements. Undeclared metadata SHALL NOT be copied wholesale into the result table.

#### Scenario: Reporting a queued Run
- **WHEN** a Variant selects a Run with recorded QUEUED status and a run.status column is declared
- **THEN** aggregation records QUEUED even when no metric result exists yet
