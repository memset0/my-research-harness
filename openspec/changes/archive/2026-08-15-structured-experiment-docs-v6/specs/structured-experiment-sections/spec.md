## ADDED Requirements

### Requirement: Experiment structured sidecars are schema-versioned sources of truth

Every v6 experiment SHALL contain `implementation.yaml`, `investigation.yaml`, and `results.yaml` beside `README.md`. Each file SHALL contain integer `schema_version: 1`. Implementation and Investigation SHALL store independent ordered nested trees with stable IDs. Results SHALL store ordered display columns and Variant rows. The YAML files, not generated Markdown, SHALL be authoritative.

#### Scenario: Agent reads and writes YAML directly
- **WHEN** an agent needs to update an Implementation, Investigation, or Variant
- **THEN** it directly edits the corresponding YAML file
- **AND** it validates the complete Experiment bundle before declaring the work complete

### Requirement: Results represent pre-run Variants and preserve non-adopted attempts

A Variant MAY have zero runs while `PLANNED`. Its status SHALL be one of `PLANNED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, or `DROPPED`. `runs[]` SHALL list adopted evidence Runs; `attempts[]` SHALL list non-adopted failed, interrupted, superseded, or invalid attempts. A Run ID SHALL NOT appear in both lists.

#### Scenario: Failed first launch and successful retry
- **GIVEN** a planned Variant whose first run fails and whose second run succeeds
- **WHEN** the writer finalizes the retry
- **THEN** `attempts[]` contains the failed Run
- **AND** `runs[]` contains the successful Run

### Requirement: Enum columns declare allowed options

Every Results column with `type: enum` SHALL declare a non-empty unique `options[]` list. A Variant value for that column SHALL be one of the declared options. The schema SHALL NOT require every option to appear in at least one Variant.

#### Scenario: Unused enum option remains valid
- **GIVEN** `options: [fp32, bf16, fp8]` and current Variants use only fp32 and bf16
- **WHEN** Results validates
- **THEN** validation succeeds

### Requirement: Structured sections share deterministic readable projections

Core SHALL expose one normalized model and deterministic Markdown renderers. CLI section reads and the first web UI SHALL use those renderers. A future specialized component SHALL consume the normalized model rather than parse generated Markdown.

#### Scenario: CLI and web projection agree
- **WHEN** the same Investigation YAML is read by CLI and web
- **THEN** both expose equivalent hierarchy, IDs, statuses, dependencies, Variant links, and outcomes
