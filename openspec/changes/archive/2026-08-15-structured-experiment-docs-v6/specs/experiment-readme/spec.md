## MODIFIED Requirements

### Requirement: Experiment doc body sections

The v6 experiment README SHALL use these canonical H2 sections in order: `Motivation`, `Design`, `Implementation`, `Investigation`, `Results`, `Findings`, `Limitations`, `Conclusion`, and `Warnings`.

`Implementation`, `Investigation`, and `Results` SHALL each contain exactly the canonical one-line managed pointer defined by this change. Whole-document reads return the pointer. Section-scoped reads materialize the corresponding valid YAML as Markdown.

Unsupported and duplicate H2 headings SHALL fail lint but SHALL remain available in an ordered raw-section view. Readers SHALL render their original bodies with diagnostics. A managed section whose body differs from its pointer SHALL render its real body with a managed-conflict error and SHALL NOT silently substitute YAML content.

The legacy v5 parser and serializer SHALL retain their established `Plan` and `New Hypotheses` compatibility behavior while a document has not yet been migrated to v6. Once migrated, `Plan` is an unsupported raw section and the structured v6 sections above are canonical.

#### Scenario: Section missing or empty
- **WHEN** a legacy experiment doc is missing `## Method`
- **THEN** the legacy parser records the absence on the experiment record but does not error
- **AND** the frontend renders the section as a placeholder labeled "to fill"

#### Scenario: New Hypotheses section flagged
- **WHEN** an experiment doc contains a `## New Hypotheses` section
- **THEN** the parser surfaces a `LEGACY_NEW_HYPOTHESES_SECTION` warning
- **AND** it preserves the body verbatim and steers the user to the structured hypothesis locations

#### Scenario: Plan section absent does not error
- **WHEN** a legacy experiment doc has no `## Plan` H2
- **THEN** the legacy parser records `sections.plan = null` and surfaces no warning
- **AND** a v6 reader does not require `Plan` because it is no longer canonical

#### Scenario: Plan body with nested GFM task lists round-trips verbatim
- **GIVEN** a pre-migration `## Plan` body with nested GFM task-list items
- **WHEN** the legacy document is parsed and re-serialized
- **THEN** the body retains every checkbox marker, indentation level, and nested item modulo trailing whitespace normalization
- **AND** a v6 raw-section reader also preserves that unsupported body before migration

#### Scenario: Plan body preserves non-checkbox content
- **GIVEN** a pre-migration `## Plan` body that interleaves checkboxes, paragraphs, plain bullets, and sub-headings
- **WHEN** it is parsed and re-serialized or exposed by a v6 raw-section reader
- **THEN** all content remains in its original order

#### Scenario: Plan section ordering enforced on serialize
- **GIVEN** a legacy parsed experiment record with a non-null `sections.plan`
- **WHEN** the legacy serializer is called before v6 migration
- **THEN** it emits `## Plan` exactly once after `## Method` and before `## Conclusion`
- **AND** the v6 migration subsequently moves its meaning into the structured v6 model without silently discarding the original body

#### Scenario: Empty Plan placeholder on round-trip of legacy doc
- **GIVEN** a legacy experiment doc with no `## Plan` heading
- **WHEN** the legacy document is parsed and re-serialized before migration
- **THEN** it emits an empty `## Plan` placeholder in the legacy canonical position
- **AND** a migrated v6 document does not emit that obsolete placeholder

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
