## Purpose

Defines how an Experiment versions its own result schema with `experiment_schema_version` and how one command upgrades every member Run's `result.csv` and the description file together — previewed, backed up, atomic, verified and rolled back on failure.

## ADDED Requirements

### Requirement: Each Experiment has one result-schema version

The Experiment description file (`experiment.json`) SHALL declare `experiment_schema_version`, a positive integer that starts at 1. It versions the meaning and location of this Experiment's recorded result values only; it is unrelated to `FS_CONVENTION_VERSION`, and no memon file format version SHALL be written into `result.csv` or the description file besides it. Every member Run's `result.csv` and the Experiment's summary SHALL record the same value. A change that renames, moves, re-types, re-scales or deletes values already recorded SHALL increase the version by exactly one and SHALL ship an upgrade transform; adding a column, an annotation, a label, a unit or a display choice for values not yet recorded SHALL NOT change it.

#### Scenario: Renaming a recorded path
- **GIVEN** `E0001-foo` at version 1 whose member result files record `metrics.fid`
- **WHEN** the author renames the column to `metrics.eval.fid`
- **THEN** the change requires version 2 and an upgrade transform from 1 to 2

#### Scenario: Adding a new metric
- **WHEN** the author declares a new column for values no Run has recorded yet
- **THEN** the version stays unchanged

### Requirement: Upgrade transforms live in the Experiment directory

An upgrade from version `N` to `N+1` SHALL be described by exactly one file under `docs/experiments/<experiment-id>/schema-upgrades/` named `<N>-to-<N+1>` plus an extension: either a declarative JSON transform `<N>-to-<N+1>.json` (the preferred form) whose operations are `rename` and `move` (a path or group prefix), `scale` (a linear factor and offset with an optional new unit), `delete` and `default` (fill a value where the pair is absent), or, for complex cases, one Python script `<N>-to-<N+1>.py` that memon runs as `python3 <script> <input.csv> <output.csv>` and that reads one result table and writes the transformed table without touching any other file. A declarative transform SHALL also apply to the description file — its column paths, frozen historical values and declared values — whenever the description file itself still records the older version. A Python transform SHALL be applied to the description file's frozen historical values and declared values presented as a result table, while the author edits its column definitions and raises its version. Transforms SHALL be tracked with the Experiment.

#### Scenario: Missing step
- **GIVEN** an Experiment at version 1 with `schema-upgrades/2-to-3.json` but no `1-to-2` transform
- **WHEN** an upgrade to version 3 is requested
- **THEN** the command fails with `BAD_REQUEST` naming the missing `1-to-2` step and changes nothing

### Requirement: One command upgrades an Experiment safely

`memon experiment schema upgrade <experiment> --to <N>` SHALL, without `--apply`, read the description file and every member result file, apply the consecutive transforms in memory and print a per-file diff summary without writing anything. With `--apply` it SHALL: refuse with `BAD_STATE` when any member Run is `RUNNING`; back up every file it will change outside the tracked tree; rewrite each member result file and the description file atomically, transforming each from the version it records to `N` (a file already at `N` is left unchanged); verify that every member result file and the description file now record `N`, parse, and contain no duplicate pair; and on any failure restore every file from the backup and exit non-zero. A file changed by another writer between the read and its replacement SHALL abort and roll back the whole upgrade. The rewrite SHALL be an ordinary visible change of tracked files that the user commits. A member Run without a result file SHALL be skipped.

#### Scenario: Dry run
- **WHEN** `memon experiment schema upgrade E0001-foo --to 2` runs without `--apply`
- **THEN** it lists every file that would change with its row-level differences and no file is written

#### Scenario: Running member blocks the upgrade
- **GIVEN** a member Run with status `RUNNING`
- **WHEN** the upgrade runs with `--apply`
- **THEN** it exits with `BAD_STATE` naming that Run and no file is written

#### Scenario: Verification failure rolls back
- **GIVEN** a transform that produces a duplicate `(path, stat)` pair in one file
- **WHEN** the upgrade runs with `--apply`
- **THEN** verification fails, every changed file is restored byte-for-byte from the backup, and the command exits non-zero naming the file

#### Scenario: Successful upgrade unblocks the summary
- **GIVEN** an Experiment whose summary fails with `RESULT_SCHEMA_MISMATCH` because its description file was raised to version 2
- **WHEN** the upgrade to 2 is applied successfully
- **THEN** every member result file records version 2 and the next summary succeeds
