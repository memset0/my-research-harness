## Purpose

Defines the generated Results summary of an Experiment: a rebuildable, fingerprint-validated cache under the derived index that combines the Experiment's description file with its member Runs' records and result files into the Variant table, derives effective Variant states and statistics, and fails visibly — for that Experiment only — when its inputs are inconsistent.

## ADDED Requirements

### Requirement: The Results summary is a generated cache, never a source of truth

The Variant table of an Experiment SHALL be generated from three inputs only: its description file, the README of every member Run its README declares, and those Runs' `result.csv` files. The generated summary SHALL be stored at `.memon/index/results/<experiment-id>.json` inside the derived index, SHALL never be tracked by version control, SHALL never be edited by hand or by an agent, and SHALL NOT be read by any writer to decide what to write into a project document. Deleting it SHALL change no API response, CLI output or lint result beyond the cost of regenerating it. The summary SHALL record `experiment_schema_version`, the generator release, `generated_at` (ISO8601 with the writer's offset), the fingerprint of every input and a digest of its own content; a summary whose digest does not match its content SHALL be discarded and regenerated.

#### Scenario: Summary deleted
- **GIVEN** a current summary for `E0001-foo`
- **WHEN** `.memon/index/results/E0001-foo.json` is deleted and the Results table is requested
- **THEN** the response equals the one computed before the deletion and a new summary file is written

#### Scenario: Hand-edited summary
- **GIVEN** a summary file whose cell value was changed by hand
- **WHEN** the Results table is requested
- **THEN** the digest check fails, the summary is regenerated from the inputs and the hand-edited value is not shown

### Requirement: Summary freshness follows input fingerprints

A summary SHALL be reused only when its recorded input set equals the current input set (the description file plus every declared member's README and result file, absent files recorded as absent) and every recorded fingerprint equals the current one; otherwise it SHALL be regenerated before it is served. Readers outside central SHALL re-take every input fingerprint on every request. Central SHALL read the description file itself on every Results request and MAY decide the member inputs' freshness from derived-index entries validated within the member windows that already govern Experiment detail member facts, with the same exceptions: an explicit refresh re-takes every member fingerprint and a central write to the Experiment or one of its Runs invalidates. Regeneration SHALL replace the summary file atomically; concurrent regenerations SHALL be safe because content is a deterministic function of the inputs.

#### Scenario: A Run result changes
- **GIVEN** a current summary and a script that rewrites one member's `result.csv`
- **WHEN** the Results table is requested from the CLI
- **THEN** the changed fingerprint causes regeneration and the new value is shown

#### Scenario: Central within the window
- **GIVEN** central served the Results of an Experiment 20 s ago and a member's `result.csv` changed 10 s ago
- **WHEN** the Results are requested again without an explicit refresh
- **THEN** the description file is read again and the member change appears no later than its window, or immediately on an explicit refresh

### Requirement: Effective Variant status combines declarations and Run records

Each Variant's effective status SHALL be derived as follows: a declared `DROPPED` or `INCONCLUSIVE` SHALL be the effective status; otherwise, among the member Runs listed in the Variant's `runs`, any `PENDING`, `RUNNING` or `INTERRUPTED` Run SHALL make it `RUNNING`, else any evidence Run SHALL make it `COMPLETED`, else any `FAILED` Run SHALL make it `FAILED`, else listed Runs that are all `UNKNOWN` or deprecated SHALL make it `INCONCLUSIVE`; a Variant without listed member Runs SHALL take its frozen historical status when it has one, else `BLOCKED` when declared `BLOCKED`, else `PLANNED`. An `INTERRUPTED` Run SHALL never make a Variant `FAILED`. When execution evidence overrides a declared `PLANNED` or `BLOCKED`, the summary SHALL report the `VARIANT_STATUS_STALE` warning. The summary SHALL expose both the effective and the declared status.

#### Scenario: Interrupted Run keeps the Variant in progress
- **GIVEN** a Variant whose only listed Run is `INTERRUPTED`
- **WHEN** the summary is generated
- **THEN** the Variant's effective status is `RUNNING`, never `FAILED`

#### Scenario: Retry after failure
- **GIVEN** a Variant listing one `FAILED` and one `FINISHED` Run, neither deprecated
- **WHEN** the summary is generated
- **THEN** the Variant is `COMPLETED`, the finished Run is its evidence and the failed Run is listed among its other Runs

#### Scenario: Blocked Variant starts running
- **GIVEN** a Variant declared `BLOCKED` that lists a `RUNNING` Run
- **WHEN** the summary is generated
- **THEN** the effective status is `RUNNING` and a `VARIANT_STATUS_STALE` warning names the Variant

### Requirement: Evidence Runs and other Runs are derived

A Variant's evidence Runs SHALL be the member Runs in its `runs` whose status is `FINISHED` and which are not deprecated; every other Run in its `runs` SHALL be listed among its other Runs together with its status (and, when the Run record has one, its stop reason). Only evidence Runs SHALL contribute measured values. No list of adopted Runs or of attempts SHALL be authored separately from a Variant's `runs`.

#### Scenario: Deprecated finished Run
- **GIVEN** a `FINISHED` Run listed by `V0002` that is deprecated
- **WHEN** the summary is generated
- **THEN** the Run is listed among `V0002`'s other Runs and contributes no value

### Requirement: Values are aggregated across a Variant's evidence Runs

For each declared column and each undeclared path recorded by an evidence Run, a Variant cell SHALL hold the value of its single evidence Run, or — when several evidence Runs report the path — statistics across those Runs computed automatically for numeric values (and for each statistic of a one-level `stats` value, as an outer level over Runs): `n`, `mean`, `min`, `max`, `sum` and every percentile of the vocabulary (linear interpolation), and, when at least two Runs contribute, `std` and `var` (sample, n−1), `sem` and the Student-t `ci95_lo`/`ci95_hi`. Such a cell SHALL be displayed by default as `mean ± std (n)`. Non-numeric values that all evidence Runs agree on SHALL be shown once; disagreeing ones SHALL be marked as mixed with the per-Run values available. Values the summary cannot aggregate further SHALL be shown per Run and marked as not aggregated. A frozen historical value declared in the description file SHALL fill a cell only when no evidence Run reports that `(path, stat)`, and SHALL be marked as frozen. A Variant MAY declare planned parameter and env values: a planned value SHALL be shown for a Variant without evidence, and an evidence Run whose recorded value differs from the planned one SHALL produce the warning `VARIANT_PARAM_MISMATCH` and the cell SHALL be marked as differing from the plan.

#### Scenario: Three seeds
- **GIVEN** a Variant with three evidence Runs reporting `metrics.eval.fid` as 10, 11 and 12
- **WHEN** the summary is generated
- **THEN** the Variant's `metrics.eval.fid` cell is a stats value with `mean` 11, `std` 1, `min` 10, `max` 12 and `n` 3, displayed by default as `11 ± 1 (3)`

#### Scenario: Actual parameter differs from the plan
- **GIVEN** `V0004` plans `params.optim.lr` 0.0001 and its evidence Run records 0.0002
- **WHEN** the summary is generated
- **THEN** the cell shows 0.0002 marked as differing from the planned 0.0001 and a `VARIANT_PARAM_MISMATCH` warning names `V0004`

#### Scenario: Frozen value without Run directory
- **GIVEN** a Variant whose description carries a frozen `metrics.eval.fid` value and which lists no member Run
- **WHEN** the summary is generated
- **THEN** the cell shows the frozen value marked as frozen

### Requirement: Inconsistent inputs fail the summary for that Experiment only

The summary of an Experiment SHALL fail as a whole, without partial data, when any member `result.csv` records an `experiment_schema_version` that differs from the description file's or records none (`RESULT_SCHEMA_MISMATCH`), or when any member result file contains a duplicate `(path, stat)` pair (`RESULT_DUPLICATE_ROW`). The failure SHALL list every offending file (project-relative) with its recorded version or duplicate lines and, for a version mismatch, the exact upgrade command `memon experiment schema upgrade <experiment-id> --to <version>`. An unreadable or schema-invalid description file SHALL fail it as `INVALID_RESULTS` with diagnostics. The failure of one Experiment's summary SHALL NOT affect any other Experiment, the Experiment's other sections, or any list.

#### Scenario: One stale result file
- **GIVEN** `E0001-foo` at version 2 whose 40 member result files record version 2 except `logs/b-260901-100000/result.csv`, which records version 1
- **WHEN** its Results are requested
- **THEN** the request fails with `RESULT_SCHEMA_MISMATCH` listing that file with version 1 and the command `memon experiment schema upgrade E0001-foo --to 2`
- **AND** no Variant row is returned

#### Scenario: Other Experiments unaffected
- **GIVEN** `E0001-foo` fails with `RESULT_SCHEMA_MISMATCH`
- **WHEN** the Results of `E0002-bar` and the Experiment list are requested
- **THEN** both succeed as before

### Requirement: Central and the CLI rebuild summaries

The CLI SHALL compute a summary from the inputs whenever the stored one is stale or absent and SHALL write the regenerated summary best-effort (a write failure is reported as the warning `RESULTS_CACHE_FAILED` and never changes the command's result). Central SHALL regenerate stale summaries on request and in its background validation of active Projects. `memon experiment results rebuild` SHALL regenerate summaries explicitly. memon writers of summary inputs SHALL NOT be required to regenerate summaries; freshness is guaranteed by fingerprints.

#### Scenario: Read-only cache directory
- **GIVEN** `.memon/index/results/` is not writable
- **WHEN** `memon experiment results table E0001-foo` runs
- **THEN** it prints the correct table, exits 0 and its JSON result carries a `RESULTS_CACHE_FAILED` warning
