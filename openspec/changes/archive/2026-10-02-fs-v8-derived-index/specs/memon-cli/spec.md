## ADDED Requirements

### Requirement: `memon index` maintains and inspects the derived index

The CLI SHALL provide `memon index status`, `memon index compact` and `memon index rebuild`, each taking `--project-root <p>` and `--format json|human`. They SHALL read and write only `<p>/.memon/index/` (plus the reads of project files a rebuild or verification needs), SHALL NOT write any project document or the FS marker, SHALL NOT be journaled, and SHALL NOT require central.

- `status [--verify] [--strict]`: report whether the index exists, its `index_version`, `generated_at` and age, the `run_dirs` and source recorded in the snapshot next to the invocation's effective `run_dirs` and source, entry counts per kind, the number and age of the oldest unmerged event, unparsable events and the current lease holder. `--verify` additionally re-takes every entry's fingerprint and re-walks, listing `INDEX_DRIFT` records and `RUN_OUTSIDE_RUN_DIRS` notices; `--strict` exits 1 when any drift is found. A missing index is reported, not an error (exit 0).
- `compact`: merge unmerged events into the snapshot under the lease without reading project documents. An unexpired lease held by another process SHALL exit 9 with `CONFLICT`.
- `rebuild [--audit-run-dirs] [--dry-run]`: rebuild the index from the project files under the lease (exit 9 when the lease is held). `--audit-run-dirs` adds the list of Run-shaped directories the effective patterns do not discover; `--dry-run` computes and reports without writing any file.

Run-walking `memon index` commands SHALL use the effective `run_dirs` of the invocation (global `--run-dir`, else `.memon/project.yml`, else the v8 default).

#### Scenario: Status on a project without index
- **WHEN** `memon index status --project-root . --format json` runs on a v8 project with no `.memon/index/`
- **THEN** it exits 0 and reports `present: false`

#### Scenario: Verify detects drift
- **GIVEN** a Run README edited by a script after the last compaction and outside any validation
- **WHEN** `memon index status --verify --strict --project-root .` runs
- **THEN** it lists an `INDEX_DRIFT` record for that Run's `status` and exits 1

#### Scenario: Rebuild is idempotent
- **WHEN** `memon index rebuild --project-root .` runs twice without project changes
- **THEN** both snapshots have the same entries and no events remain

### Requirement: `memon project` creates and checks the project declaration

The CLI SHALL provide `memon project init` and `memon project lint`, each taking `--project-root <p>` and `--format json|human`, neither requiring central, reading the FS marker or being journaled.

- `init` SHALL create `<p>/.memon/project.yml` with exclusive create, containing `schema_version: 1` and a `run_dirs` list equal to the global `--run-dir` patterns when given, otherwise the FS v8 default `["logs/*", "outputs/*", "experiments/*"]`. When the file already exists it SHALL exit 9 with `CONFLICT` and leave the file unchanged. It SHALL write nothing else (no index, marker or ignore file) and SHALL NOT stage or commit; its result names the created path so the user can review and commit it.
- `lint` SHALL validate the declaration (`PROJECT_DECLARATION_INVALID` for each error) and report the effective `run_dirs` and their source; a missing file is reported as `present: false` with exit 0; any error exits 1.

#### Scenario: Init on a fresh project
- **WHEN** `memon project init --project-root .` runs on a project without `.memon/project.yml`
- **THEN** it exits 0, the file contains `schema_version: 1` and the three default patterns, and no other file changes

#### Scenario: Init refuses to overwrite
- **GIVEN** an existing `.memon/project.yml`
- **WHEN** `memon project init --project-root .` runs
- **THEN** it exits 9 with `CONFLICT` and the file is byte-identical

#### Scenario: Init with declared patterns
- **WHEN** `memon --run-dir 'outputs/*/*' project init --project-root .` runs
- **THEN** the created file declares `run_dirs: ["outputs/*/*"]`

#### Scenario: Lint rejects an unknown key
- **GIVEN** `.memon/project.yml` with an extra key `walk_depth`
- **WHEN** `memon project lint --project-root .` runs
- **THEN** it exits 1 and reports `PROJECT_DECLARATION_INVALID` naming `walk_depth`

## MODIFIED Requirements

### Requirement: CLI Run walks accept declared Run locations
The CLI SHALL read the project declaration `.memon/project.yml` of the selected project root and SHALL also accept a repeatable global `--run-dir <pattern>` option with the meaning and validation of the Project `run_dirs` setting. The effective patterns of an invocation SHALL be the `--run-dir` patterns when given (overriding the declaration as a whole), else the declaration's `run_dirs`, else the FS v8 default patterns `logs/*`, `outputs/*` and `experiments/*`. Every Run walk the invocation performs (project scan, run listing/show/search, Run target resolution by base name and `memon index` walks) SHALL expand only the effective patterns. An invalid `--run-dir` pattern SHALL fail with `BAD_REQUEST` (exit code 2) naming `--run-dir` before the project is read; an invalid declaration SHALL fail a walking command with `BAD_REQUEST` (exit code 2) naming `.memon/project.yml` unless `--run-dir` is given. Resolution of a project-relative Run path SHALL NOT depend on the patterns.

#### Scenario: Declared scan
- **WHEN** `memon --run-dir 'logs/*' scan .` runs in a project with Runs at `logs/<run>` and `outputs/<group>/<run>`
- **THEN** the snapshot contains the `logs/<run>` Runs and not the `outputs/<group>/<run>` Runs

#### Scenario: Default scan
- **WHEN** `memon scan .` runs without `--run-dir` in a project without `.memon/project.yml` and with Runs at `logs/<run>` and `outputs/<group>/<run>`
- **THEN** the snapshot contains the `logs/<run>` Runs and not the `outputs/<group>/<run>` Runs

#### Scenario: Declaration-driven scan
- **GIVEN** `.memon/project.yml` declares `run_dirs: ["logs/*", "outputs/*/*"]`
- **WHEN** `memon scan .` runs without `--run-dir`
- **THEN** the snapshot contains both the `logs/<run>` and the `outputs/<group>/<run>` Runs

#### Scenario: Flag overrides the declaration
- **GIVEN** `.memon/project.yml` declares `run_dirs: ["outputs/*/*"]`
- **WHEN** `memon --run-dir 'logs/*' scan .` runs
- **THEN** only `logs/*` is expanded

#### Scenario: Invalid pattern
- **WHEN** `memon --run-dir 'logs/**' scan .` runs
- **THEN** the command exits with code 2 and a `BAD_REQUEST` error naming `--run-dir`

#### Scenario: Path target ignores the patterns
- **WHEN** `memon --run-dir 'logs/*' run resolve-exp outputs/group/r-260901-090000` names an existing Run directory
- **THEN** the Run resolves even though the declared patterns would not discover it


### Requirement: CLI remains direct and independent of central cache
Remote CLI commands SHALL read/write project files directly and retain existing filesystem formats, status permissions and optimistic-lock behavior. They SHALL not require a central connection, a persistent cache daemon, or cache notification integration. Every successful CLI Experiment or Run write SHALL publish its derived-index event directly in the project, best-effort, without contacting central; an event failure SHALL be reported as an `INDEX_EVENT_FAILED` warning and SHALL NOT change the command's exit code. CLI read commands SHALL NOT depend on the derived index. Backend serving/lifecycle commands SHALL be removed while central memon serve remains available in the central installation.

#### Scenario: Offline CLI
- **WHEN** central is unavailable
- **THEN** local experiment and Wiki CLI operations continue without cache synchronization, and Experiment/Run writes still leave their index events in the project

#### Scenario: Index event failure
- **WHEN** `memon experiment link` succeeds but its index event cannot be written
- **THEN** the command exits 0 and its JSON result carries an `INDEX_EVENT_FAILED` warning
