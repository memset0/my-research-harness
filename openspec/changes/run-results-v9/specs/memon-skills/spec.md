## ADDED Requirements

### Requirement: Skills author v9 Results through the description file and Run result files

Bundled skills SHALL declare result columns, groups and Variants — including each Variant's `runs`, which SHALL stay a subset of the README `runs` — in the Experiment description file `experiment.json` before launching a Run for a new comparison condition, and SHALL validate the bundle with `memon experiment doc lint` after editing it. They SHALL record a Run's parameters, metrics and environment values with `memon run result set` (or by a direct edit of `result.csv` that keeps the reserved version row, unique `(path, stat)` pairs and declared types), SHALL record statistics as `stats` rows rather than packed strings such as `mean ± std` or JSON text, and SHALL NOT write step histories, checkpoints or tracking identities into `result.csv`. Skills SHALL NOT read, create, edit or delete Results summaries under `.memon/index/results/` and SHALL obtain Variant tables only through `memon experiment results table` or `summary`. A change that renames, moves, re-types, re-scales or deletes recorded values SHALL be made by raising `experiment_schema_version` with a transform under `schema-upgrades/` and running `memon experiment schema upgrade` — first without `--apply`, then with `--apply` only after the user approves the reported diff. On `RESULT_SCHEMA_MISMATCH` a skill SHALL report the listed files and the upgrade command instead of editing the result files one by one. `memon-migrate-fs` SHALL cover the v8-to-v9 step using its guide; the FS preflight is unchanged.

#### Scenario: Recording seed statistics
- **WHEN** an execution skill reports a metric measured over 500 samples with mean 0.31 and standard deviation 0.02
- **THEN** it records `stats` rows with `mean`, `std` and `n` for that path, not the string `0.31 ± 0.02`

#### Scenario: Schema mismatch during a read
- **WHEN** a skill's `memon experiment results table` call fails with `RESULT_SCHEMA_MISMATCH`
- **THEN** the skill reports the listed files and the upgrade command to the user and does not edit any `result.csv` by hand

#### Scenario: Summary cache is off limits
- **WHEN** a skill needs the Variant table
- **THEN** it calls `memon experiment results table` and never opens `.memon/index/results/`
