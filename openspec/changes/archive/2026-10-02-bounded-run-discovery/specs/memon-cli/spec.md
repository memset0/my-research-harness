## ADDED Requirements

### Requirement: CLI Run walks accept declared Run locations
Because the CLI has no project-level configuration source, the CLI SHALL accept a repeatable global `--run-dir <pattern>` option with the meaning and validation of the Project `run_dirs` setting. When given, every Run walk the invocation performs (project scan, run listing/show/search and Run target resolution by base name) SHALL expand only those patterns; when omitted, walks SHALL stay unbounded. An invalid pattern SHALL fail with `BAD_REQUEST` (exit code 2) before the project is read. Resolution of a project-relative Run path SHALL NOT depend on the patterns.

#### Scenario: Declared scan
- **WHEN** `memon --run-dir 'logs/*' scan .` runs in a project with Runs at `logs/<run>` and `outputs/<group>/<run>`
- **THEN** the snapshot contains the `logs/<run>` Runs and not the `outputs/<group>/<run>` Runs

#### Scenario: Invalid pattern
- **WHEN** `memon --run-dir 'logs/**' scan .` runs
- **THEN** the command exits with code 2 and a `BAD_REQUEST` error naming `--run-dir`

#### Scenario: Path target ignores the patterns
- **WHEN** `memon --run-dir 'logs/*' run resolve-exp outputs/group/r-260901-090000` names an existing Run directory
- **THEN** the Run resolves even though the declared patterns would not discover it
