## MODIFIED Requirements

### Requirement: Higher-level skills do not load execution records
Propose SHALL read Experiment documents and Variant-level results only — the description file and the generated Results summary obtained through the CLI — not Run documents, Run result files, attempts or raw logs, directly or through hydrated CLI summaries. Missing information SHALL be reported as a documentation gap, not permission to descend into execution records. Execution recovery SHALL be a distinct lower-layer task.

#### Scenario: Missing measurement source details
- **WHEN** a proposal needs information absent from an Experiment document
- **THEN** it names the gap instead of scanning Run directories to reconstruct the answer

#### Scenario: Reading Variant results
- **WHEN** propose needs the current measurements of a Variant
- **THEN** it reads them from `memon experiment results table` output and never opens a Run's `result.csv`
