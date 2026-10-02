## Purpose

Defines the per-Run result file `result.csv`: the tracked, long-format record of the parameters, metrics and environment values of one whole Run, its reserved rows, typed values (including multi-row statistics), uniqueness and the writers and lint that keep it consistent with its Experiment's description file.

## ADDED Requirements

### Requirement: Each Run records its results in one tracked result file

A Run directory MAY contain one result file `<runDir>/result.csv`. It SHALL be a UTF-8 CSV table whose columns are, in order, `path`, `stat` and `value`. It SHALL describe the whole Run: every value in it applies to the Run as a whole, and step-indexed histories, checkpoints, tracking-service identities and other source facts SHALL NOT be stored in it (they belong to the Run record). The file is research data: memon SHALL NOT add it to any ignore rule, SHALL NOT delete it, and SHALL NOT require it — a Run without results has no result file. The header line and quoting conventions are provisional and defined by the design.

#### Scenario: Minimal result file
- **GIVEN** a FINISHED Run declared by Experiment `E0001-foo`, whose description file has `experiment_schema_version: 1`
- **WHEN** an agent records the metric `metrics.fid = 12.3` for it through memon
- **THEN** `<runDir>/result.csv` exists with the three columns `path`, `stat`, `value`, one reserved schema-version row and one row for the metric

#### Scenario: A Run without results
- **GIVEN** a FAILED Run that never produced measurements
- **WHEN** its Experiment is linted and summarized
- **THEN** the missing `result.csv` produces no diagnostic and the Run is listed without values

### Requirement: Reserved rows carry the Experiment schema version

Paths beginning with `$` SHALL be reserved for memon. Every result file SHALL contain exactly one `$experiment_schema_version` row, with an empty `stat` cell, whose value is a positive integer; it SHALL equal the `experiment_schema_version` of the Experiment that declares the Run for the file to be consistent. Reserved rows SHALL precede value rows. Any other `$` path, a repeated reserved row or a reserved row with a non-empty `stat` SHALL be a lint error. A result file SHALL NOT carry Variant association, Experiment identity or any other copy of facts owned by the Experiment description file or the README.

#### Scenario: Version row is mandatory
- **GIVEN** a `result.csv` with value rows but no `$experiment_schema_version` row
- **WHEN** the Run's result file is linted
- **THEN** lint reports `RESULT_SCHEMA_VERSION_MISSING` and the declaring Experiment's summary fails with `RESULT_SCHEMA_MISMATCH` naming the file

#### Scenario: Unknown reserved path
- **GIVEN** a `result.csv` containing a `$wandb` row
- **WHEN** the file is linted
- **THEN** lint reports `RESULT_RESERVED_PATH_UNKNOWN` naming `$wandb`

### Requirement: Paths express groups under three partitions

A value path SHALL be a non-empty sequence of segments separated by `.`; a group is any proper prefix of a path. The leading segment SHALL be one of the three partitions — parameters, metrics and environment values — whose names are defined by the design. A path SHALL NOT be both a value and a group prefix of another path in the same file. Path segment grammar is provisional and defined by the design; it SHALL reject empty segments and the reserved `$` prefix.

#### Scenario: Grouped parameters
- **WHEN** a result file holds `params.optim.lr` and `params.optim.batch_size`
- **THEN** readers expose both as parameters in the group `params.optim`

#### Scenario: Leaf and group collide
- **GIVEN** a result file holding a value at `metrics.eval` and another at `metrics.eval.fid`
- **WHEN** the file is linted
- **THEN** lint reports `RESULT_PATH_CONFLICT` for `metrics.eval`

### Requirement: Values are typed by the Experiment description file

The type of a value SHALL be the type its path declares in the Experiment's description file: `string`, `number` (a finite decimal), `boolean` (`true` / `false`), `enum` (one of the declared options), `list` (a JSON array written as one line of text in the `value` cell), or `stats`. An empty `value` cell SHALL mean an explicitly missing value. Only `stats` values SHALL span several rows: one row per statistic, all with the same path and distinct `stat` cells. A `stat` SHALL be built from the fixed vocabulary `mean`, `std`, `min`, `max`, `n`, `p50`, `p90`, `p95`, `p99`; for a column that declares both an inner (`across`) and an outer (`over`) dimension it SHALL name an inner and an outer statistic (for example the outer `p99` of each unit's inner `max`). The spelling of a two-level stat is provisional and defined by the design. Every non-`stats` row SHALL have an empty `stat` cell. A row that violates its declared type SHALL be a lint error and SHALL be kept verbatim; a row whose path no column declares SHALL be reported as the lint error `UNDECLARED_RESULT_PATH`, kept, and shown as undeclared.

#### Scenario: Mean and standard deviation of a metric
- **GIVEN** a column `metrics.eval.clip` declared `stats` with `across: sample`
- **WHEN** a result file holds rows for that path with `stat` `mean`, `std` and `n`
- **THEN** readers expose one stats value with those three statistics

#### Scenario: Statistic outside the vocabulary
- **WHEN** a result file holds a `stats` row whose `stat` is `median`
- **THEN** lint reports `RESULT_STAT_UNKNOWN` and the row is kept verbatim

#### Scenario: List value
- **GIVEN** a column `params.data.splits` declared `list`
- **WHEN** a result file holds the value `["train","val"]` on one line
- **THEN** readers expose the list `train`, `val`

### Requirement: Path and statistic pairs are unique

Within one result file each `(path, stat)` pair SHALL occur at most once. A duplicate SHALL be a lint error (`RESULT_DUPLICATE_ROW`) naming the file and both line numbers, and SHALL make the declaring Experiment's summary fail; readers SHALL NOT pick one of the duplicates.

#### Scenario: Duplicate metric row
- **GIVEN** a result file with two rows for `metrics.eval.fid` with an empty `stat`
- **WHEN** the declaring Experiment is summarized
- **THEN** the summary fails with `RESULT_DUPLICATE_ROW` naming the file and both lines

### Requirement: memon writers upsert result rows atomically

Every memon write to a result file SHALL replace the file atomically (complete temporary file, then rename), SHALL insert or replace exactly the targeted `(path, stat)` rows and SHALL keep every other row byte-for-byte in its original order; prior values are preserved only by version control history. A writer creating a result file SHALL first write the reserved `$experiment_schema_version` row with the current version of the declaring Experiment. A writer SHALL refuse with `BAD_STATE` when the Run is declared by no Experiment or by more than one, and SHALL refuse with `RESULT_SCHEMA_MISMATCH` when the file's recorded version differs from the description file's (naming the upgrade command). A write carrying an expected content hash that no longer matches SHALL fail with `CONFLICT` and write nothing.

#### Scenario: Upsert keeps unrelated rows
- **GIVEN** a result file with rows for `metrics.eval.fid` and `metrics.eval.is`
- **WHEN** memon sets `metrics.eval.fid` to `11.9`
- **THEN** the `fid` row holds `11.9`, the `is` row is byte-identical and in the same position, and no other file changes

#### Scenario: Orphan Run
- **GIVEN** a Run that no Experiment declares
- **WHEN** memon is asked to write a result value for it
- **THEN** the write fails with `BAD_STATE` naming `memon experiment link` and no file is created

#### Scenario: Stale version
- **GIVEN** a result file recording version 1 while its Experiment's description file is at version 2
- **WHEN** memon is asked to write a value into it
- **THEN** the write fails with `RESULT_SCHEMA_MISMATCH` naming `memon experiment schema upgrade` and the file is unchanged
