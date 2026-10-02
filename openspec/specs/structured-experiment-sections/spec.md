# structured-experiment-sections Specification

## Purpose
Defines the schema-versioned `implementation.yaml`, `investigation.yaml` and `results.yaml` files beside an Experiment's README as the authoritative sources of its Implementation, Investigation and Results sections, including Variants, enum columns and sparse column annotations. It serves agents that edit the YAML directly and readers that see deterministic Markdown projections in the CLI and dashboard. Schemas, validation and projection live in `@memon/core` (`experiments/documents.ts`).

## Requirements

### Requirement: Experiment structured sidecars are schema-versioned sources of truth

Every v6 experiment SHALL contain `implementation.yaml`, `investigation.yaml`, and `results.yaml` beside `README.md`. Each file SHALL contain integer `schema_version: 1`. Implementation and Investigation SHALL store independent ordered nested trees with stable IDs. Results SHALL store ordered display columns and Variant rows. The YAML files, not generated Markdown, SHALL be authoritative.

#### Scenario: Agent reads and writes YAML directly
- **WHEN** an agent needs to update an Implementation, Investigation, or Variant
- **THEN** it directly edits the corresponding YAML file
- **AND** it validates the complete Experiment bundle before declaring the work complete

### Requirement: Results represent pre-run Variants and preserve non-adopted attempts

A Variant MAY have zero runs while `PLANNED` or `BLOCKED`. Its status SHALL be one of `PLANNED`, `BLOCKED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE`, or `DROPPED`; this list is also the canonical lifecycle order of the statuses. `runs[]` SHALL list adopted evidence Runs; `attempts[]` SHALL list non-adopted failed, interrupted, superseded, or invalid attempts. A Run ID SHALL NOT appear in both lists.

`BLOCKED` SHALL mean a declared Variant that cannot be launched or relaunched until a named prerequisite is met, for example a parent Variant's checkpoint, an allocation, or an upstream fix. Like `PLANNED` it is pre-run and non-terminal: it SHALL NOT record a failed outcome (a launched Run that fails is recorded as `FAILED` or kept in `attempts[]`), earlier attempts MAY remain in `attempts[]`, and the Variant moves to `PLANNED` or `RUNNING` once unblocked or to `DROPPED` when abandoned. The prerequisite belongs in the Variant `description`. `BLOCKED` SHALL be validated exactly like `PLANNED`: it makes no field required or forbidden, and the core parser, the CLI, the Backend protocol and the dashboard SHALL all accept it.

Adding `BLOCKED` SHALL NOT increment `FS_CONVENTION_VERSION` or the Results file `schema_version`.

#### Scenario: Failed first launch and successful retry
- **GIVEN** a planned Variant whose first run fails and whose second run succeeds
- **WHEN** the writer finalizes the retry
- **THEN** `attempts[]` contains the failed Run
- **AND** `runs[]` contains the successful Run

#### Scenario: A blocked Variant is readable
- **GIVEN** a `results.yaml` in which one Variant has `status: BLOCKED`, zero `runs`, and a description naming the parent checkpoint it waits for
- **WHEN** the Results document is parsed and the Experiment bundle is linted
- **THEN** parsing succeeds without errors and the Variant keeps the status `BLOCKED`
- **AND** no diagnostic is reported for that status

#### Scenario: An unknown status is still rejected
- **GIVEN** a Variant with `status: WAITING`
- **WHEN** the Results document is parsed
- **THEN** parsing fails with an `INVALID_RESULTS_SCHEMA` error for that Variant's `status` that lists the seven accepted statuses

### Requirement: Enum columns declare allowed options

Every Results column with `type: enum` SHALL declare a non-empty unique `options[]` list. A Variant value for that column SHALL be one of the declared options. The schema SHALL NOT require every option to appear in at least one Variant.

#### Scenario: Unused enum option remains valid
- **GIVEN** `options: [fp32, bf16, fp8]` and current Variants use only fp32 and bf16
- **WHEN** Results validates
- **THEN** validation succeeds

### Requirement: Results columns may carry sparse supplemental Markdown annotations

`results.yaml` schema v1 MAY contain an optional top-level `column_annotations`
mapping before `columns`. Each declared column key MAY independently provide a
Markdown `description`, a partial Markdown `value_descriptions` mapping, or
both. No column or value description is required. Value descriptions SHALL NOT
define or restrict the allowed domain, SHALL NOT be required to cover enum
`options`, and MAY name a value that is added later.

This additive optional field SHALL NOT increment `FS_CONVENTION_VERSION` or the
Results file `schema_version`.

#### Scenario: A future enum value is documented sparsely
- **GIVEN** a parameter enum currently declares `options: [fp32, bf16]`
- **WHEN** `column_annotations.precision.value_descriptions` describes only `bf16` and future `fp4`
- **THEN** Results schema validation succeeds
- **AND** no description is required for `fp32`

### Requirement: Structured sections share deterministic readable projections

Core SHALL expose one normalized model and deterministic display/Markdown projection. CLI, standalone Web, and central-through-Backend Web SHALL use that same projection. Specialized components SHALL consume sanitized normalized Implementation, Investigation, and Results models rather than parse generated Markdown. A valid current v6 payload MUST NOT be rendered through the legacy Method/Plan/Caveats fallback.

#### Scenario: CLI and web projection agree
- **WHEN** the same valid v6 Experiment is read by CLI, standalone Web, and central through a Backend
- **THEN** all expose equivalent canonical section order, Implementation/Investigation hierarchy, Results Variants, IDs, statuses, dependencies, links, outcomes, and diagnostics
- **AND** deprecated Plan/Caveats sections are absent unless preserved as explicitly unsupported source content

### Requirement: Variant provenance environment values are strings

`provenance.env` SHALL map environment variable names to string values, and the normalized Results model SHALL expose only string env values. A reader SHALL accept a YAML number or boolean env value, normalize it to its canonical string — the shortest spelling that round-trips the number (`0.000008` → `"0.000008"`, `1e-7` → `"1e-7"`), or `"true"` / `"false"` — and SHALL report a `RESULTS_ENV_VALUE_COERCED` warning that names the field and the normalized value. Such a document SHALL remain readable, and the warning SHALL NOT make the Experiment read-only. A `null`, list or mapping env value SHALL remain a schema error.

Reading SHALL NOT rewrite `results.yaml`. When memon serializes a normalized Results document it SHALL write every env value as a YAML string. Because a number's source spelling is not preserved (`1.0e-5` reads as `"0.00001"`), authors SHALL quote env values whose exact spelling matters.

This tolerance SHALL NOT increment `FS_CONVENTION_VERSION` or the Results file `schema_version`.

#### Scenario: Unquoted numeric env value
- **GIVEN** a Variant whose `provenance.env` contains `LR: 0.000008`
- **WHEN** the Results document is parsed
- **THEN** parsing succeeds and the normalized env value is the string `"0.000008"`
- **AND** the parse warnings contain one `RESULTS_ENV_VALUE_COERCED` warning for `variants.<index>.provenance.env.LR`

#### Scenario: Boolean env value
- **GIVEN** a Variant whose `provenance.env` contains `DEBUG: true`
- **WHEN** the Results document is parsed
- **THEN** the normalized env value is the string `"true"`

#### Scenario: Null env value stays invalid
- **GIVEN** a Variant whose `provenance.env` contains `LR: null`
- **WHEN** the Results document is parsed
- **THEN** parsing fails with an `INVALID_RESULTS_SCHEMA` error for that field

#### Scenario: Serialization writes strings
- **GIVEN** a normalized Results document read from a file with an unquoted numeric env value
- **WHEN** memon serializes that document
- **THEN** the env value is written as a quoted YAML string that reads back as the same string without a warning
