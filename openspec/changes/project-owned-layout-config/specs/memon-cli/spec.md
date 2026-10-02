## ADDED Requirements

### Requirement: `memon project` migrates and checks layout from central configuration
`memon project init` SHALL accept `--from-central <config-path>` with `--project <name>` (and `--host <id>` when the name is ambiguous across Hosts). It SHALL read only that central Project entry, validate it, and create `.memon/project.yml` (exclusive create, never staged or committed) containing `schema_version: 1` and every layout key (`run_dirs`, `include`, `exclude`, `github`) the entry sets, with `github` paths as written; `run_dirs` SHALL fall back to the global `--run-dir` patterns and then the FS v8 default when the entry has none. An unreadable or invalid configuration, an unknown Project or an ambiguous name SHALL exit 2 with `BAD_REQUEST` and create nothing; an existing declaration SHALL exit 9 with `CONFLICT`. Without `--from-central` the existing behaviour is unchanged; `--project`/`--host` without `--from-central` SHALL exit 2.

`memon project lint` SHALL validate every layout key of the declaration (`PROJECT_DECLARATION_INVALID`, exit 1) and report the effective layout with each key's source. With `--from-central <config-path> --project <name>` it SHALL also report one `CENTRAL_LAYOUT_DEPRECATED` warning diagnostic per layout key that central entry sets, stating whether it conflicts with the declaration and that the central value wins; such warnings SHALL NOT change the exit code.

#### Scenario: Init from central
- **GIVEN** a central configuration whose Project `project-a` sets `run_dirs: ["outputs/*/*"]`, `exclude: [scratch]` and `github: [{owner: acme, repo: project-a, path: .}]`
- **WHEN** `memon project init --project-root . --from-central config.yml --project project-a` runs
- **THEN** it exits 0 and `.memon/project.yml` loads as `schema_version: 1` with exactly those three keys and values

#### Scenario: Init from central for an unknown Project
- **WHEN** `memon project init --from-central config.yml --project missing` runs
- **THEN** it exits 2 with `BAD_REQUEST` and no file is created

#### Scenario: Lint reports a deprecated central key
- **GIVEN** `.memon/project.yml` declaring `exclude: [tmp]` and a central entry for `project-a` declaring `exclude: [scratch]`
- **WHEN** `memon project lint --from-central config.yml --project project-a` runs
- **THEN** it exits 0, reports a `CENTRAL_LAYOUT_DEPRECATED` warning for `exclude` marked as a conflict, and the effective `exclude` is `[scratch]` from source `central`

#### Scenario: Lint rejects an invalid layout key
- **GIVEN** `.memon/project.yml` declaring `exclude: scratch` (not a list)
- **WHEN** `memon project lint` runs
- **THEN** it exits 1 and reports `PROJECT_DECLARATION_INVALID` naming `exclude`

## MODIFIED Requirements

### Requirement: CLI Run walks accept declared Run locations
The CLI SHALL read the project declaration `.memon/project.yml` of the selected project root and SHALL also accept a repeatable global `--run-dir <pattern>` option with the meaning and validation of the Project `run_dirs` setting. The effective patterns of an invocation SHALL be the `--run-dir` patterns when given (overriding the declaration as a whole), else the declaration's `run_dirs`, else the FS v8 default patterns `logs/*`, `outputs/*` and `experiments/*`. Every Run walk the invocation performs (project scan, run listing/show/search, Run target resolution by base name and `memon index` walks) SHALL expand only the effective patterns. An invalid `--run-dir` pattern SHALL fail with `BAD_REQUEST` (exit code 2) naming `--run-dir` before the project is read; an invalid declaration SHALL fail a walking command with `BAD_REQUEST` (exit code 2) naming `.memon/project.yml` even when `--run-dir` is given, because `--run-dir` supplies only `run_dirs` and the walk still resolves `include` and `exclude` from the declaration. Resolution of a project-relative Run path SHALL NOT depend on the patterns.

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

#### Scenario: Flag keeps the declaration's other layout keys
- **GIVEN** `.memon/project.yml` declares `run_dirs: ["outputs/*/*"]` and `exclude: ["scratch-*"]`
- **WHEN** `memon --run-dir 'logs/*' scan .` runs with Runs at `logs/<run>` and `logs/scratch-<run>`
- **THEN** only `logs/*` is expanded, the `run_dirs` source is `cli`, and `logs/scratch-<run>` is excluded

#### Scenario: Invalid declaration fails even with the flag
- **GIVEN** `.memon/project.yml` declares an unknown key `walk_depth: 3`
- **WHEN** `memon --run-dir 'logs/*' scan .` runs
- **THEN** the command exits with code 2 and a `BAD_REQUEST` error naming `.memon/project.yml` (`PROJECT_DECLARATION_INVALID`), and walks nothing

#### Scenario: Invalid pattern
- **WHEN** `memon --run-dir 'logs/**' scan .` runs
- **THEN** the command exits with code 2 and a `BAD_REQUEST` error naming `--run-dir`

#### Scenario: Path target ignores the patterns
- **WHEN** `memon --run-dir 'logs/*' run resolve-exp outputs/group/r-260901-090000` names an existing Run directory
- **THEN** the Run resolves even though the declared patterns would not discover it
