## MODIFIED Requirements

### Requirement: Experiment structured sidecars are schema-versioned sources of truth

Every FS v9 experiment SHALL contain `implementation.yaml`, `investigation.yaml` and the Experiment description file `experiment.json` beside `README.md`. `implementation.yaml` and `investigation.yaml` SHALL keep integer `schema_version: 1` and their independent ordered nested trees with stable IDs, unchanged by FS v9. The description file SHALL hold exactly the human-authored description of the Experiment's results: `experiment_schema_version`, `groups`, `columns` and `variants`; it SHALL NOT repeat any field the README frontmatter owns (`id`, `slug`, `title`, `status`, `archived`, `runs`, `hypotheses`, `tags`, timestamps). Core SHALL define the file name `experiment.json` in one place that every reader and writer uses. `results.yaml` is retired: a v9 bundle SHALL NOT contain it, v9 readers SHALL NOT read it, and lint SHALL report a leftover file as the error `LEGACY_RESULTS_YAML` without deleting it. The Variant table is the generated summary defined by `experiment-results-summary`. These source files, the member Runs' records and `result.csv` files — not generated Markdown and not the summary cache — SHALL be authoritative.

#### Scenario: Agent reads and writes YAML directly
- **WHEN** an agent needs to update an Implementation item, an Investigation item, a column or a Variant declaration
- **THEN** it directly edits `implementation.yaml`, `investigation.yaml` or `experiment.json`
- **AND** it validates the complete Experiment bundle before declaring the work complete

#### Scenario: Leftover results.yaml
- **GIVEN** a v9 bundle that still contains a `results.yaml`
- **WHEN** the bundle is linted and its Results are summarized
- **THEN** lint reports `LEGACY_RESULTS_YAML`, the file is left untouched and its content is not used

#### Scenario: README fields are not repeated
- **GIVEN** a description file that carries a top-level `status` or `runs` key
- **WHEN** the bundle is linted
- **THEN** lint reports `DESCRIPTION_DUPLICATES_README` naming the key and the README value stays authoritative

### Requirement: Results represent pre-run Variants and preserve non-adopted attempts

Variants SHALL be declared in the description file before any Run is launched for them, and a Variant MAY list no Run. Each Variant SHALL list its Runs in `runs` as project-relative Run paths; every listed path SHALL also be declared in the README `runs` (otherwise lint reports `VARIANT_RUN_NOT_EXPERIMENT_MEMBER`), a Run SHALL be listed by at most one Variant (otherwise `RUN_ASSIGNED_TO_MULTIPLE_VARIANTS`), and a declared member listed by no Variant SHALL be reported as `UNASSIGNED_EXPERIMENT_RUN`. A declared status is optional and SHALL be one of `PLANNED`, `BLOCKED`, `DROPPED` or `INCONCLUSIVE`; declaring `RUNNING`, `COMPLETED` or `FAILED` SHALL be the lint error `DERIVED_STATUS_DECLARED`, because those derive from Run records. The effective status vocabulary SHALL be `PLANNED`, `BLOCKED`, `RUNNING`, `COMPLETED`, `FAILED`, `INCONCLUSIVE` and `DROPPED`, which is also its canonical lifecycle order, derived as `experiment-results-summary` specifies. Evidence Runs and the other, non-adopted Runs of a Variant — failed, interrupted, still running or deprecated — SHALL be derived from its `runs` and preserved, never authored as a separate list.

`BLOCKED` SHALL mean a declared Variant that cannot be launched or relaunched until a named prerequisite is met, for example a parent Variant's checkpoint, an allocation, or an upstream fix; the prerequisite belongs in the Variant `description`. Like `PLANNED` it is pre-run: it records no failed outcome, earlier Runs stay listed, and execution evidence overrides it (reported as `VARIANT_STATUS_STALE`). `BLOCKED` SHALL make no field required or forbidden, and the core parser, the CLI, the Backend protocol and the dashboard SHALL all accept it.

#### Scenario: Failed first launch and successful retry
- **GIVEN** a planned Variant whose first Run fails and whose second Run finishes, both in its `runs`
- **WHEN** the summary is generated
- **THEN** the Variant is `COMPLETED` with the second Run as evidence
- **AND** the failed Run is preserved among its other Runs

#### Scenario: A blocked Variant is readable
- **GIVEN** a description file in which one Variant declares `BLOCKED`, lists no Run, and has a description naming the parent checkpoint it waits for
- **WHEN** the description file is parsed and the Experiment bundle is linted
- **THEN** parsing succeeds without errors and the Variant's effective status is `BLOCKED`

#### Scenario: A derived status cannot be declared
- **GIVEN** a Variant declaring `status: COMPLETED`
- **WHEN** the bundle is linted
- **THEN** lint reports `DERIVED_STATUS_DECLARED` and the effective status is still derived from Run records

#### Scenario: Variant lists a non-member Run
- **GIVEN** a Variant whose `runs` contains a path the README `runs` does not declare
- **WHEN** the bundle is linted
- **THEN** lint reports `VARIANT_RUN_NOT_EXPERIMENT_MEMBER` and the summary does not use that Run

### Requirement: Enum columns declare allowed options

Every result column declared in the description file with type `enum` SHALL declare a non-empty unique `options` list. A recorded value for that column — in a member Run's `result.csv`, a declared Variant value or a frozen historical value — SHALL be one of the declared options. The schema SHALL NOT require every option to appear in at least one Variant.

#### Scenario: Unused enum option remains valid
- **GIVEN** `options: ["fp32", "bf16", "fp8"]` and current Runs record only fp32 and bf16
- **WHEN** the description file and member result files are linted
- **THEN** validation succeeds

### Requirement: Results columns may carry sparse supplemental Markdown annotations

The description file MAY carry annotations keyed by column path. Each declared column MAY independently provide a Markdown `description`, a partial Markdown `value_descriptions` mapping, or both. No column or value description is required. Value descriptions SHALL NOT define or restrict the allowed domain, SHALL NOT be required to cover enum `options`, and MAY name a value that is added later.

Adding or changing annotations SHALL NOT change `experiment_schema_version` or `FS_CONVENTION_VERSION`.

#### Scenario: A future enum value is documented sparsely
- **GIVEN** a parameter enum currently declares `options: ["fp32", "bf16"]`
- **WHEN** the annotations of that column describe only `bf16` and future `fp4`
- **THEN** description file validation succeeds
- **AND** no description is required for `fp32`

### Requirement: Structured sections share deterministic readable projections

Core SHALL expose one normalized model and deterministic display/Markdown projection. CLI, standalone Web, and central-through-Backend Web SHALL use that same projection. Specialized components SHALL consume sanitized normalized Implementation and Investigation models and the generated Results summary rather than parse generated Markdown. The Results projection SHALL be rendered from the summary and SHALL render a failed summary as its error (code, offending files, upgrade command) instead of a table. A valid current payload MUST NOT be rendered through the legacy Method/Plan/Caveats fallback.

#### Scenario: CLI and web projection agree
- **WHEN** the same valid v9 Experiment is read by CLI, standalone Web, and central through a Backend
- **THEN** all expose equivalent canonical section order, Implementation/Investigation hierarchy, Results Variants with effective statuses, IDs, dependencies, links, outcomes, and diagnostics
- **AND** deprecated Plan/Caveats sections are absent unless preserved as explicitly unsupported source content

### Requirement: Variant provenance environment values are strings

A Variant's environment values in the description file SHALL map environment variable names to string values, and the normalized model SHALL expose only string env values. A reader SHALL accept a JSON number or boolean env value, normalize it to its canonical string — the shortest spelling that round-trips the number, or `"true"` / `"false"` — and SHALL report a `RESULTS_ENV_VALUE_COERCED` warning that names the field and the normalized value. Such a description file SHALL remain readable, and the warning SHALL NOT make the Experiment read-only. A `null`, array or object env value SHALL be a schema error.

Reading SHALL NOT rewrite the description file. When memon serializes a normalized description it SHALL write every env value as a JSON string. The v8-to-v9 migration SHALL convert every non-string v8 env value to its canonical string and report the conversions.

#### Scenario: Unquoted numeric env value
- **GIVEN** a Variant whose env contains `"LR": 0.000008`
- **WHEN** the description file is parsed
- **THEN** parsing succeeds, the normalized env value is the string `"0.000008"` and one `RESULTS_ENV_VALUE_COERCED` warning names that field

#### Scenario: Null env value stays invalid
- **GIVEN** a Variant whose env contains `"LR": null`
- **WHEN** the description file is parsed
- **THEN** parsing fails with a schema error for that field

## ADDED Requirements

### Requirement: The description file declares typed columns and groups by path

The description file SHALL declare an ordered list of result columns. Each column SHALL be addressed by a unique result path (the same path a `result.csv` row uses, under one of the three partitions for parameters, metrics and environment values) and SHALL declare its type (`string`, `number`, `boolean`, `enum`, `list` or `stats`) and a display label; it MAY declare a unit, a direction (`higher` or `lower` is better, or none), enum options, a default display choice, a default visibility and, for `stats`, the dimension the statistics are taken across (`across`) and optionally the outer dimension (`over`). `groups` MAY give display metadata (label, description, default visibility) to a path prefix; a group without an entry is still a group. Declaration order SHALL be the default display order within each group. A column's `display` SHALL be one vocabulary statistic or one of the templates `mean±std`, `mean±sem`, `mean (min–max)`, `mean [ci95]`, `p50 (p25–p75)` and `p50/p99`; its `hidden` flag (or a group's) gives the default visibility, and the `env` partition is hidden by default. Declaring a column is optional (results are written first and described later); a declaration adds label, type, unit, direction, options and display to a recorded path. The description file SHALL NOT be a project-wide column dictionary; every Experiment describes its own paths. Unknown keys SHALL be preserved verbatim by memon writers.

#### Scenario: Stats column with a default display
- **GIVEN** a column `metrics.serve.latency_ms` of type `stats` with `across: request`, `over: gpu`, unit `ms`, direction `lower` and a default display of the outer `p99` of the inner `max`
- **WHEN** the Results table renders
- **THEN** that column shows each Variant's outer-`p99`-of-inner-`max` latency in `ms` and lower values rank better

#### Scenario: Group metadata
- **GIVEN** a `groups` entry labelling `params.optim` as "Optimizer"
- **WHEN** the column controls render
- **THEN** the `params.optim` node of the column tree is labelled "Optimizer"

### Requirement: Variant declarations carry plan state, declared values and frozen history

Each Variant in the description file SHALL declare a unique id `V<NNNN>` and a name, and MAY declare a description, a declared status (see the Variant status requirement), declared parameter and env values (keyed by path, typed by the columns), provenance (`repo`, `commit`, `entry`, `recipe`, plus preserved extra keys), its `runs`, and a frozen historical block. A frozen block SHALL hold read-only values (path, stat, value) recorded before FS v9 that no Run directory can carry, the historical status, the Run paths they were attributed to, and their source; memon writers SHALL NOT add to it except through the v8-to-v9 migration and schema upgrades. Duplicate Variant ids SHALL be a lint error.

#### Scenario: Historical value kept without a Run
- **GIVEN** a v8 Variant whose metric belonged to a Run directory that no longer exists
- **WHEN** the project is migrated to v9
- **THEN** the value is kept in that Variant's frozen block in the description file and shown, marked frozen, in the Results table

### Requirement: The Results pointer names the description file

The canonical one-line pointer of the README `## Results` section SHALL name the description file as the editable source and SHALL state that the Results table is generated from Run result files. A v8 pointer naming `results.yaml` SHALL be reported by v9 lint as `MANAGED_SECTION_NOT_STUB` and SHALL be rewritten by the v8-to-v9 migration. The exact pointer text is defined by core.

#### Scenario: New Experiment pointer
- **WHEN** `memon experiment create` scaffolds a v9 bundle
- **THEN** its `## Results` section contains exactly the v9 pointer naming `experiment.json`
