## Purpose

Provide lightweight execution records and layered research workflows without losing historical data, while reducing mandatory agent document maintenance and enforcing explicit research exclusion.

## ADDED Requirements

### Requirement: Minimal new Run records preserve legacy readability
New Run records SHALL contain necessary execution facts and references without mandatory narrative chapters or duplicated Experiment/Variant explanations. Readers SHALL continue accepting existing rich Run documents, and unrelated lifecycle updates SHALL preserve their content.

#### Scenario: New minimal execution
- **WHEN** a new execution is recorded with its identity, association and state
- **THEN** lint accepts the supported minimal structure without requiring Motivation, Setup, Result or Artifacts prose

#### Scenario: Historical rich record
- **WHEN** an old Run with narrative sections is read or its lifecycle flag is changed
- **THEN** its historical content remains readable and is not truncated or normalized away

### Requirement: Deprecated Runs are reversibly excluded
Run deprecation SHALL be independent of execution status and Variant membership, SHALL default to false when absent, and SHALL exclude the Run's evidence from current result analysis, aggregation and derived completion judgments. Deprecation SHALL retain its existing Variant association and list placement. Explicit inspection for execution reuse and restoration SHALL remain possible without deleting artifacts or stopping execution.

#### Scenario: Successful deprecated execution
- **WHEN** a FINISHED Run is deprecated
- **THEN** ordinary research queries omit it, explicit inspection retains its FINISHED status and artifacts, and restoration makes it eligible again

#### Scenario: Invalidated materialized evidence
- **WHEN** current projected results rely on a deprecated execution
- **THEN** the system does not silently present the affected measurements as valid active evidence and does not fabricate replacement measurements

#### Scenario: Reusing deprecated execution context
- **WHEN** an executor prepares a replacement Run for the same Variant
- **THEN** it MAY inspect the deprecated Run's scripts, commands, environment, logs and artifacts to reuse correct execution context while correcting known problems
- **AND** that inspection SHALL NOT make the old measurements current evidence or relax propose's higher-layer boundary

#### Scenario: Redoing a set of Variants
- **WHEN** the user requests a redo of existing Variants
- **THEN** the workflow preserves their definitions and Run associations, deprecates old Runs within the agreed scope, and creates fresh Runs for unchanged conditions
- **AND** changed comparison conditions SHALL be declared before launch

Implementation limitation: result eligibility currently checks all Variant.runs. Deprecated historical members may keep replacement measurements partial; separate per-metric evidence lineage is future work. This archive does not require or claim that recovery behavior.

### Requirement: Lint is the sole document check workflow
CLI and supported non-Wiki skills SHALL use lint for syntax, schema and document structure. Doctor and separate document validate commands SHALL be removed rather than retained as aliases. Lint SHALL NOT prescribe research conclusions, process-status changes, timestamp refresh or archival to resolve diagnostics.

#### Scenario: Finished Run without a conclusion
- **WHEN** a structurally valid finished Run has no narrative conclusion
- **THEN** lint does not request a conclusion or suggest archival

### Requirement: Higher-level skills do not load execution records
Propose SHALL read Experiment documents and Variant-level results only, not Run documents, Attempts or raw logs directly or through hydrated CLI summaries. Missing information SHALL be reported as a documentation gap, not permission to descend into execution records. Execution recovery SHALL be a distinct lower-layer task.

#### Scenario: Missing measurement source details
- **WHEN** a proposal needs information absent from an Experiment document
- **THEN** it names the gap instead of scanning Run directories to reconstruct the answer

### Requirement: Reduced skills retain safety and measured accountability
Non-Wiki skills SHALL remove mandatory Run prose, repeated full-document scans, per-event writer delegation and redundant checks while preserving concurrency, unknown historical content, privacy, execution safety and human authority. Before/after document token measurements SHALL name the tokenizer and include changed references and shared guidance.

#### Scenario: Per-document reduction report
- **WHEN** the reform is presented for review
- **THEN** each measured document has baseline and final token counts, absolute savings and reduction percentage, with semantic differences and verification results reported separately
