## MODIFIED Requirements

### Requirement: Experiment doc body sections

The v6 experiment README SHALL use these canonical H2 sections in order: `Motivation`, `Design`, `Implementation`, `Investigation`, `Results`, `Findings`, `Limitations`, `Conclusion`, and `Warnings`.

`Implementation`, `Investigation`, and `Results` SHALL each contain exactly the canonical one-line managed pointer defined by this change. Whole-document reads return the pointer. Section-scoped reads materialize the corresponding valid YAML as Markdown.

Unsupported and duplicate H2 headings SHALL fail lint but SHALL remain available in an ordered raw-section view. Readers SHALL render their original bodies with diagnostics. A managed section whose body differs from its pointer SHALL render its real body with a managed-conflict error and SHALL NOT silently substitute YAML content.

#### Scenario: Unknown legacy Plan remains visible
- **GIVEN** a v5 README containing a non-empty `## Plan`
- **WHEN** a v6 web reader opens it before migration
- **THEN** the Plan body is rendered with an unsupported-section diagnostic
- **AND** lint fails without deleting or hiding the body

#### Scenario: Managed conflict preserves README content
- **GIVEN** `## Investigation` contains a checklist instead of the canonical pointer
- **WHEN** a section-scoped read occurs
- **THEN** it returns a conflict diagnostic and the real checklist
- **AND** it does not replace the checklist with `investigation.yaml` output
