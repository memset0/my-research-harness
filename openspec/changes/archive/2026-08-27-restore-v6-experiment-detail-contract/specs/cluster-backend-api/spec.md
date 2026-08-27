## ADDED Requirements

### Requirement: Experiment detail preserves the safe v6 document contract
The ID-addressed Backend Experiment detail response SHALL include ordered raw section descriptors, sanitized parsed Implementation/Investigation/Results documents, canonical display sections, document diagnostics, read-only state, and Results update metadata. It MUST omit absolute paths and raw filesystem authority. Experiment list responses SHALL NOT include the managed document payload.

#### Scenario: Valid v6 detail crosses the Backend boundary
- **WHEN** central requests an Experiment whose three managed YAML documents parse successfully
- **THEN** the response runtime-validates and contains the structured data required to render all canonical managed sections and Results Variants
- **AND** no cluster absolute path appears anywhere in the response

#### Scenario: List stays summary-only
- **WHEN** central lists Experiments
- **THEN** each summary omits raw sections, managed documents, display projections, and document bodies
