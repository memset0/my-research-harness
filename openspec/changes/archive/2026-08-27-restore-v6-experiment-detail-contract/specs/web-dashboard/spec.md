## ADDED Requirements

### Requirement: Central Experiment pages do not silently downgrade current v6 data
For a supported current/prior Backend release, the dashboard SHALL require the strict v6 Experiment detail fields and render canonical Implementation, Investigation, Results, Findings, Limitations, and Conclusion sections. Missing current-contract fields SHALL surface a safe compatibility error rather than synthesize deprecated Method, Plan, or Caveats sections.

#### Scenario: Managed documents render in central
- **WHEN** an owner opens a Host-qualified valid v6 Experiment detail
- **THEN** Implementation and Investigation render their structured item hierarchies
- **AND** Results renders its Variant table
- **AND** legacy Plan/Caveats headings are not shown
