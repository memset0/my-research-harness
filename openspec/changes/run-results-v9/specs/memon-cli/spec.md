## MODIFIED Requirements

### Requirement: `memon experiment results table` reads results as a selectable flat table

`memon experiment results table <id-or-slug> [--variant <ids>] [--status <statuses>] [--column <paths>] [--group <group>] [--output <fmt>]` SHALL obtain the named Experiment's Results summary (reusing a fresh stored summary or regenerating it from `experiment.json`, the member Run records and their `result.csv` files), project it as a flat table with one row per Variant, and emit the result in the requested format.

**Filters:**

| Flag | Purpose |
|------|---------|
| `--variant <ids>` | Comma-separated Variant IDs to include (default: all) |
| `--status <statuses>` | Comma-separated effective status values (`PLANNED`/`BLOCKED`/`RUNNING`/`COMPLETED`/`FAILED`/`INCONCLUSIVE`/`DROPPED`), matched case-insensitively |
| `--column <paths>` | Comma-separated column paths or group prefixes to include (default: all) |
| `--group <group>` | Column partition filter: `parameter`, `metric`, or `all` (default: `all`) |

Filters are AND-composed. Column ordering preserves the declaration order from `experiment.json`.

**Output formats (`--output`):**

| Format | Behavior |
|--------|----------|
| `json` (default) | Structured object with `experimentId`, `experimentSchemaVersion`, `columns`, `rows`, `meta` |
| `human` | Aligned terminal table with `─` separators |
| `csv` | RFC 4180 CSV; one column per scalar path and one per `(path, stat)` of a stats column; `runs_count` / `attempts_count` as integer columns |
| `markdown` | GFM table with bold Variant IDs |
| `yaml` | Structured YAML mirroring the JSON envelope |

**Row shape (JSON/YAML):** each row SHALL carry `variantId`, `variantName`, the effective `status`, the `declaredStatus` (or null), `runs` (evidence Run paths), `attempts` (the other associated Runs with their statuses), `values` keyed by column path — a scalar, or for a stats cell an object with the column's dimensions and its statistics — and `frozen` (the paths whose values are frozen historical values). The JSON shape of a stats cell is defined by the design.

**Meta shape:** `totalVariants`, `filteredVariants` and the applied `filters`.

**Error contract:**

| Condition | exit code | stderr `error.code` |
|-----------|-----------|---------------------|
| Experiment not found | 4 (`NOT_FOUND`) | `NOT_FOUND` |
| `experiment.json` missing | 4 (`NOT_FOUND`) | `NOT_FOUND` |
| `experiment.json` unreadable or schema-invalid | 1 (`GENERIC`) | `INVALID_RESULTS` |
| a member `result.csv` records another or no `experiment_schema_version` | 1 (`GENERIC`) | `RESULT_SCHEMA_MISMATCH`, with `details.files` (path and recorded version) and `details.upgradeCommand` |
| a member `result.csv` has a duplicate `(path, stat)` pair | 1 (`GENERIC`) | `RESULT_DUPLICATE_ROW`, with `details.files` (path and line numbers) |

Empty filter results are not errors — the command returns zero rows with `meta.filteredVariants: 0`. A failure to store the regenerated summary SHALL NOT change the exit code; it is reported as a `RESULTS_CACHE_FAILED` warning.

#### Scenario: Default JSON output returns all variants
- **WHEN** the user runs `memon experiment results table E0001-foo --output json`
- **THEN** stdout is valid JSON with `rows.length` equal to the number of Variants declared in `experiment.json`
- **AND** each row contains `variantId`, `variantName`, `status`, `declaredStatus`, `runs`, `attempts`, `values` and `frozen`

#### Scenario: --variant filters to specific Variants
- **WHEN** the user runs `memon experiment results table E0001-foo --variant V0001,V0003 --output json`
- **THEN** only rows whose `variantId` is `V0001` or `V0003` appear in `rows`
- **AND** `meta.filters.variants` is `["V0001", "V0003"]`

#### Scenario: --status selects blocked Variants
- **GIVEN** an `experiment.json` with one Variant declared `BLOCKED` and one Variant whose finished evidence Run makes it `COMPLETED`
- **WHEN** the user runs `memon experiment results table E0001-foo --status blocked --output json`
- **THEN** `rows` contains only the `BLOCKED` Variant with `status: "BLOCKED"`
- **AND** `meta.filters.statuses` is `["blocked"]`

#### Scenario: --group metric excludes parameter columns
- **WHEN** the user runs `memon experiment results table E0001-foo --group metric --output json`
- **THEN** every column in `columns` is a metric path
- **AND** `meta.filters.columnGroup` is `"metric"`

#### Scenario: --output csv produces RFC 4180 output
- **WHEN** the user runs `memon experiment results table E0001-foo --output csv`
- **THEN** the first line is a comma-separated header: `variant_id,variant_name,status,<column paths...>,runs_count,attempts_count`
- **AND** each subsequent line is a data row with values in the same column order

#### Scenario: --output csv flattens statistics
- **GIVEN** a stats column `metrics.eval.clip` whose cells carry `mean` and `std`
- **WHEN** the user runs `memon experiment results table E0001-foo --output csv`
- **THEN** the header carries one column for each of that path's statistics in place of the single path column

#### Scenario: Missing results.yaml exits NOT_FOUND
- **GIVEN** an unmigrated experiment that has `results.yaml` but no `experiment.json`
- **WHEN** `memon experiment results table <id>` runs
- **THEN** stderr carries `{"error":{"code":"NOT_FOUND",…}}` naming `experiment.json` and the v8-to-v9 migration
- **AND** exit code is 4 and `results.yaml` is not read

#### Scenario: Schema mismatch lists files and the command
- **GIVEN** a member `result.csv` recording version 1 while `experiment.json` records version 2
- **WHEN** `memon experiment results table E0001-foo` runs
- **THEN** it exits 1 with `RESULT_SCHEMA_MISMATCH` whose details list that file with version 1 and the command `memon experiment schema upgrade E0001-foo --to 2`
- **AND** stdout carries no rows

### Requirement: Results summary exposes table shape without cell values

`memon experiment results summary <id-or-slug> [--output <fmt>]` SHALL return the declared columns and the Variant row identities without returning parameter or metric values, Runs, attempts, provenance or frozen values. Each column SHALL include its path, label, type, unit, direction, options when present, stats dimensions when present, default display, and optional column/value descriptions. Each row SHALL include only the Variant `id`, `name`, effective `status` and declared status. It SHALL report `experimentSchemaVersion`. When the summary cannot be generated because of a schema mismatch or a duplicate row, the command SHALL still return the declared columns and Variant identities with declared statuses only, plus the failure code, offending files and upgrade command, and SHALL exit 1.

#### Scenario: Agent inspects Results shape safely
- **WHEN** an Agent runs `memon experiment results summary E0001-example --output json`
- **THEN** stdout contains column and row counts, column schemas, annotations, and Variant identities
- **AND** stdout contains no parameter or metric values, `runs`, `attempts`, provenance or frozen values

### Requirement: Focused Results annotation commands are optional idempotent helpers

`memon experiment results annotation get <id> [--column <path>] [--value <value>]`
SHALL read all annotations or one selected description from `experiment.json`.
`memon experiment results annotation set <id> <column-path> [--value <value>]
--description <markdown>` SHALL atomically add or replace the selected column
description or value description in `experiment.json`, keeping every other key
and value of the document. Set SHALL require a declared column but SHALL NOT
require `--value` to occur in enum `options`. Direct editing of `experiment.json`
SHALL remain supported and documented.

#### Scenario: Existing value description is replaced
- **GIVEN** column `params.precision` already describes value `bf16`
- **WHEN** annotation set targets the same column and value with new Markdown
- **THEN** exactly that description is replaced atomically
- **AND** unrelated keys of `experiment.json` are retained

### Requirement: Structured Experiment document commands are read and check surfaces

The CLI SHALL expose `memon experiment doc show <id> <section>`, `render <id> <section>`, `validate <id>`, and `lint <id>` for v9 Experiment bundles. `section` SHALL be one of `implementation`, `investigation`, or `results`. Human show/render output SHALL use Core's deterministic Markdown projection — for `results`, the projection of the generated summary, or its failure. JSON output SHALL include structured diagnostics. Validate and lint SHALL check `implementation.yaml`, `investigation.yaml`, `experiment.json` and every declared member's `result.csv` (including version agreement and duplicate pairs, and — inside a Git work tree — the `RESULT_FILE_IGNORED` warning of `run-results`) and SHALL exit non-zero when any error diagnostic exists.

The CLI SHALL NOT expose item-level create, update, delete, reorder, or status-mutation commands for the YAML trees or for Variant and column declarations. Agents may edit those source files directly. The focused Results annotation upsert, `memon run result set` and `memon experiment schema upgrade` are the only result-related write helpers and SHALL NOT become required write gates for the definition.

#### Scenario: Managed section renders for a human
- **WHEN** the user runs `memon --project-root . --format human experiment doc render E0001-example results`
- **THEN** stdout contains the Core-generated human-readable Results Markdown
- **AND** no source file is modified

#### Scenario: Strict lint preserves incompatible content
- **GIVEN** an Experiment README has an unsupported `## Plan` body
- **WHEN** `memon --project-root . --format json experiment doc lint E0001-example` runs
- **THEN** it exits non-zero with an `UNKNOWN_H2_SECTION` error
- **AND** the README remains byte-unchanged and readable

#### Scenario: Lint covers member result files
- **GIVEN** a member `result.csv` with a value of the wrong type for its declared column
- **WHEN** `memon experiment doc lint E0001-example` runs
- **THEN** it exits non-zero and reports the file, the path and the expected type

### Requirement: `memon experiment` subcommand family

The CLI SHALL expose `memon experiment` as a parent command with the following subcommands. All write subcommands SHALL emit JSON status objects on stdout (`{"ok":true, ...}`) on success and structured error JSON on failure; all read subcommands SHALL default to JSON output and support `--format human` for tabular output.

```
memon experiment ls               [--project-root <p>]
memon experiment show             <id-or-slug> [--project-root <p>]
memon experiment create           <slug> [--title <t>] [--hypotheses <H,H,...>]
                                  [--from-run <run-dir>] [--project-root <p>]
memon experiment rename           <id-or-slug> <new-slug> [--project-root <p>]
memon experiment link             <id> <run-dir-or-id> [--project-root <p>]
memon experiment unlink           <id> <run-dir-or-id> [--project-root <p>]
memon experiment delete           <id> [--force] [--project-root <p>]
memon experiment results table    <id-or-slug> [--variant <ids>] [--status <statuses>]
                                  [--column <paths>] [--group <group>] [--output <fmt>]
memon experiment results summary  <id-or-slug> [--output <fmt>]
memon experiment results rebuild  [<id-or-slug>] [--all]
memon experiment results annotation get|set ...
memon experiment schema upgrade   <id-or-slug> --to <N> [--apply]
memon experiment doc show|render|validate|lint ...
memon experiment warning add      <id> [--run <run-dir>] --category <cat>
                                  --message <text> [--expected-mtime <ms>]
                                  [--expected-hash <sha1>]
memon experiment warning resolve  <id> <rowId> --note <text>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning reopen   <id> <rowId> [--note <text>]
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning delete   <id> <rowId>
                                  [--expected-mtime <ms>] [--expected-hash <sha1>]
memon experiment warning list     <id> [--status open|resolved|all]
```

The `id` argument SHALL accept either the canonical `E<NNNN>-<slug>` form or the slug alone (when the slug uniquely identifies an experiment). The `link`/`unlink` `<run-dir-or-id>` argument and `--from-run` accept a project-relative Run path or a unique Run ID; an ambiguous ID is rejected with its candidate paths. These commands edit the Experiment declaration only. The `--run <run-dir>` option on `warning add` populates the `Run` column of the new row; absence means the warning is exp-scoped (rendered as `—`).

The `experiment create` and `experiment rename` commands' behaviors are detailed in the `experiment-edit` capability; the `experiment link` / `unlink` / `delete` commands' behaviors are detailed there as well. `experiment schema upgrade` is detailed in `experiment-schema-upgrade`.

The `experiment warning *` write commands SHALL:
- Use the section-bound writer for `## Warnings` defined in `experiment-readme`.
- Record a `[WARNING]` detail in the automatic invocation per write, including the `run` attribution.

#### Scenario: `experiment ls` returns JSON list
- **WHEN** the user runs `memon experiment ls --project-root <p>`
- **THEN** stdout is JSON `{"experiments": [...]}` with one entry per exp doc, including effective times computed from member runs

#### Scenario: `experiment warning add` requires a run for run-scoped
- **WHEN** the user runs `memon experiment warning add E0001 --run bar-260501-100000 --category result --message "..."`
- **THEN** the new row's `Run` cell is `bar-260501-100000`, the `[WARNING]` event has `run: "bar-260501-100000"`, and stdout is `{"ok":true,"rowId":"...","mtime":...}`

#### Scenario: `experiment warning add` without --run is exp-scoped
- **WHEN** the same command runs without `--run`
- **THEN** the new row's `Run` cell is `—`, the `[WARNING]` event has `run: null`

#### Scenario: `experiment rename` is listed in the subcommand family
- **WHEN** the user runs `memon experiment --help`
- **THEN** the printed subcommand list includes `rename <id-or-slug> <new-slug>` between `create` and `link`
- **AND** the detailed behavior of the command is detailed in the `experiment-edit` capability

#### Scenario: Results and schema commands are listed
- **WHEN** the user runs `memon experiment --help`
- **THEN** the printed list includes the `results` group (`table`, `summary`, `rebuild`, `annotation`) and `schema upgrade`

## ADDED Requirements

### Requirement: `memon run result` reads, upserts and lints a Run's result file

The CLI SHALL expose `memon run result get <run> [--path <path-or-prefix>]`, `memon run result set <run> [<path>[:<stat>]=<value>...] [--from <csv-file|->] [--unset <path>[:<stat>]...] [--expected-hash <sha256>]` and `memon run result lint <run>`, each with `--project-root` and `--format json|human`. `get` SHALL print the parsed rows (reserved rows separately) and diagnostics without writing. `set` SHALL upsert the given rows with the atomic upsert, ownership and version rules of `run-results`, creating the file with the current version row when absent (and, when it creates a file that the project's ignore rules exclude, still writing it and reporting the `RESULT_FILE_IGNORED` warning of `run-results` without editing any ignore file), and SHALL print the new content hash; it SHALL validate every value against the declared column type before writing and SHALL write nothing when any value is invalid (exit 2, `BAD_REQUEST`). An orphan or multiply-declared Run SHALL exit 1 with `BAD_STATE`; a version mismatch SHALL exit 1 with `RESULT_SCHEMA_MISMATCH`; a stale `--expected-hash` SHALL exit 9 with `CONFLICT`. `lint` SHALL report the `run-results` diagnostics (including the `RESULT_FILE_IGNORED` warning) and exit 1 on any error. `set` accepts `<path>=<value>` and `<path>:<stat>=<value>` assignments, `--from` a CSV file (or `-` for stdin) with the three result columns, and `--unset <path>[:<stat>]` to remove a pair. `get` and `lint` SHALL NOT be journaled; `set` SHALL record its invocation receipt and publish a derived-index event like other Run writes.

#### Scenario: Recording two statistics
- **GIVEN** `logs/a-260901-090000` declared by `E0001-foo` whose column `metrics.eval.clip` is `stats`
- **WHEN** the agent runs `memon run result set logs/a-260901-090000 metrics.eval.clip:mean=0.31 metrics.eval.clip:std=0.02`
- **THEN** the file holds exactly one row for each of the two statistics and the command exits 0 with the new hash

#### Scenario: Invalid value writes nothing
- **GIVEN** a column `metrics.eval.fid` of type `number`
- **WHEN** `memon run result set <run> metrics.eval.fid=abc` runs
- **THEN** it exits 2 with `BAD_REQUEST` naming the path and the file is unchanged

### Requirement: `memon experiment results rebuild` regenerates Results summaries

`memon experiment results rebuild [<id-or-slug>] [--all] [--project-root <p>]` SHALL regenerate the Results summary of the named Experiment, or of every Experiment with `--all`, from the source files and replace each summary atomically under `.memon/index/results/`. It SHALL write nothing else, SHALL NOT read or advance the FS marker, SHALL NOT be journaled and SHALL NOT require central. Each Experiment's outcome (regenerated, unchanged, or failed with its code and offending files) SHALL be reported separately; a failure of one Experiment SHALL NOT stop the others, and the command SHALL exit 1 when any Experiment failed.

#### Scenario: Rebuild all with one failure
- **GIVEN** three Experiments of which one has a schema mismatch
- **WHEN** `memon experiment results rebuild --all` runs
- **THEN** two summaries are written, the third Experiment is reported with `RESULT_SCHEMA_MISMATCH` and its files, and the command exits 1
