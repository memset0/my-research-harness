## ADDED Requirements

### Requirement: Experiment detail renders v6 and legacy sections without hiding source

The Experiment detail API SHALL expose the ordered raw README H2 occurrences, managed-document state, shared Markdown projections, and diagnostics. The detail page SHALL render canonical sections in source order. For a valid Implementation, Investigation, or Results pointer, it SHALL render Core's YAML-derived Markdown projection. For an unsupported or duplicate heading, it SHALL render the original body with a visible compatibility diagnostic. For a managed-pointer conflict, it SHALL render and highlight the real README body rather than substituting YAML.

An Experiment with unsupported, incomplete, or conflicting document structure SHALL remain readable. Mutating controls MAY be disabled until the bundle passes v6 lint.

#### Scenario: Legacy content remains readable before migration
- **GIVEN** a v5 Experiment has `Method`, `Plan`, and `Caveats` but no v6 sidecars
- **WHEN** the Experiment detail page opens under the v6 web application
- **THEN** all three original bodies remain visible with compatibility diagnostics
- **AND** the page does not fabricate managed YAML content

#### Scenario: Valid managed section uses shared projection
- **GIVEN** an exact `## Results` pointer and valid `results.yaml`
- **WHEN** the Experiment detail page opens
- **THEN** the Results card renders the same human-readable Markdown projection as the CLI
- **AND** known Run IDs link to their memon panel and available W&B page
- **AND** the literal pointer is still returned by a whole-README source read

### Requirement: Direct YAML edits refresh without corrupting README locks

The Web runtime SHALL poll each managed YAML sidecar and the Experiment bundle directory in addition to README.md. A sidecar edit SHALL reload the complete bundle and emit the normal Experiment change signal. The aggregate bundle mtime MAY advance for list activity, but every README mutation SHALL use README.md's own mtime as its optimistic lock.

#### Scenario: Agent edits only results.yaml
- **GIVEN** an Experiment page is backed by a valid cached v6 bundle
- **WHEN** an Agent directly updates only `results.yaml`
- **THEN** the runtime reloads the Results projection without requiring a restart or README edit
- **AND** a later status/archive mutation using `readmeMtime` is not rejected because the YAML is newer
