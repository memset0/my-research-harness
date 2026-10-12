## Purpose

Retain experimental history and stable Variant identities while restricting current research judgments to evidence collected under the current scientific comparison version.

## ADDED Requirements

### Requirement: Research versions are independent of result schema and execution state

An FS10 Experiment SHALL declare a positive current research version, a consecutive version history with writer-local ISO8601 timestamps and transition reasons, and an immutable mapping from Run paths to research versions. These versions SHALL NOT change or replace `experiment_schema_version`, external protocol labels, Run execution status, or Experiment lifecycle status. Variant identities SHALL remain usable across research versions. Current Variant definitions SHALL NOT overwrite historical execution facts.

#### Scenario: Same Variant across versions
- **WHEN** a Variant's planned configuration changes after research version 1 advances to 2
- **THEN** its version-1 Runs retain their identity and association, and differing historical parameters are not treated as errors against version-2 plans

### Requirement: Version advancement preserves history atomically

Advancement SHALL require a nonempty reason, expected current version, expected mtime and expected hash, and SHALL atomically close the current version and create its immediate successor. Closing a version SHALL snapshot its Variant definitions, associations, provenance, deprecation information, columns, groups, frozen sources and result-schema version without copying Run measurements. Every earlier Run SHALL become ineligible for current decisions. Existing associations and attribution SHALL remain unchanged. Frozen historical cells and states SHALL NOT fall back into the new current version.

#### Scenario: Old results do not fill an empty new version
- **WHEN** version 2 starts before any new Run exists
- **THEN** current planned Variants remain visible without version-1 measured values, frozen fallback metrics, completion states, or rankings

#### Scenario: Concurrent update
- **WHEN** a version transition encounters changed content, mtime, membership, or current version
- **THEN** it returns a conflict and does not partially advance the ledger or modify Run files

### Requirement: Run attribution cannot be promoted by relinking

Controlled creation/recording with an Experiment SHALL register a new execution to the version active at creation. Completion or continuation SHALL NOT change that attribution. Unlink SHALL retain attribution tombstones. Relink SHALL reuse the original attribution. Existing unregistered executions SHALL require explicit historical import and reason; ordinary import SHALL NOT enroll an old execution into the current version after an advance. Initial reviewed format migration SHALL initialize legacy members without claiming they newly executed. Supported generic writers SHALL reject ledger reassignment, snapshot edits, and attribution deletion.

#### Scenario: Completion after advance
- **WHEN** a Run created under version 1 finishes after version 2 starts
- **THEN** it remains version-1 history despite its successful execution

#### Scenario: Unlink and relink
- **WHEN** a version-1 Run is removed and added again during version 2
- **THEN** its old attribution survives and it cannot contribute current evidence

#### Scenario: Enrollment interrupted
- **WHEN** creation enrollment is interrupted between attribution and membership publication
- **THEN** the state is recoverable without an eligible unversioned member or silent promotion across a concurrent transition

### Requirement: Variant deprecation is an independent eligibility decision

A Variant SHALL support deprecation with a required reason, timestamp, and optional existing non-self same-Experiment successor. Cycles SHALL be rejected. Deprecation SHALL retain the Variant and every association while excluding it from current evidence and ranking. An explicit restore with reason SHALL preserve deprecation history and SHALL NOT change any Run's research version. Deprecation SHALL NOT rewrite execution or Experiment lifecycle states.

#### Scenario: Finished evidence under deprecated Variant
- **WHEN** an otherwise eligible Variant is deprecated
- **THEN** its historical values remain inspectable but cannot contribute to current judgments, ranking, or comparisons

#### Scenario: Restore after version advance
- **WHEN** a Variant is restored in version 2 with only version-1 Runs
- **THEN** it has no current measured evidence

### Requirement: Version scope governs summaries and historical validation

Current summaries SHALL use only current-version, FINISHED, nondeprecated Runs associated with nondeprecated Variants and declared as members. Version scope SHALL be applied before result-schema validation, planned-value comparison, effective-status derivation, and fallback. Historical file errors SHALL remain visible as historical diagnostics without blocking current evidence. Attribution or membership integrity errors SHALL fail closed. Historical views SHALL select a single version's definition snapshot and actual Run values; incompatible historical schemas SHALL display raw evidence with diagnostics rather than use current definitions.

#### Scenario: Older schema does not block the present
- **WHEN** a version-1 result records an older schema than current version 2
- **THEN** current summary generation excludes it before current-schema validation and history exposes the original data with its appropriate schema or diagnostic

#### Scenario: Current schema error remains an error
- **WHEN** a current-version Run has an invalid result schema
- **THEN** current Results fail visibly under the existing current-scope validation contract

### Requirement: Cross-surface access exposes eligibility and preserves safety

Core, CLI and backend SHALL share mutation behavior and return version/deprecation/exclusion metadata. CLI SHALL provide version inspection/advancement, historical enrollment and Variant deprecate/restore; backend and Web SHALL provide equivalent authorized operations. Writes SHALL enforce path containment, owner authorization and mtime-plus-hash conflicts. Results requests SHALL default to current and allow explicit single-version historical reads. Cache identity SHALL distinguish version selection and reject stale summaries generated under an incompatible contract.

#### Scenario: Viewer cannot advance
- **WHEN** a viewer requests version advancement or deprecation
- **THEN** authorization rejects the write without changing files

#### Scenario: History cache cannot become current
- **WHEN** a historical summary is cached and current Results are requested
- **THEN** only the current-version summary is returned

### Requirement: Schema upgrades do not promote research evidence

For FS10, a result-schema upgrade SHALL preview and transform only the current generation's result files and definitions. Closed snapshots and historical Run results SHALL stay unchanged. Research attribution SHALL stay unchanged across schema upgrades, annotations, imports, and generic writes. FS9 read compatibility SHALL NOT reinterpret existing all-member upgrade rules as research-version semantics.

#### Scenario: Schema upgrade with historical members
- **WHEN** current research version 2 changes its metric schema
- **THEN** its preview identifies current files only, version-1 files and snapshots remain unchanged, and no Run becomes version 2 as a side effect

### Requirement: Skills distinguish execution facts and research validity

Bundled guidance SHALL distinguish research version, metric schema, Variant deprecation, Run deprecation and execution status. It SHALL instruct agents to preserve associations, use explicit transitions with reasons, inspect current evidence by default, and treat historical mismatches as historical facts. It SHALL forbid relabeling or copying old results to manufacture new-version evidence; genuine new executions can reference older artifacts as lineage.

#### Scenario: Reuse a checkpoint
- **WHEN** an agent reuses an older checkpoint for a new-version evaluation
- **THEN** it creates an actual new evaluation execution with lineage rather than changing the old Run's version or claiming copied metrics as new evidence
