## ADDED Requirements

### Requirement: CLI Run walks accept a depth bound
Because the CLI has no project-level configuration source, the CLI SHALL accept a global `--run-depth <1|2>` option with the meaning of the Project `run_depth` setting. When given, every Run walk the invocation performs (project scan, run listing/show/search and Run target resolution by base name) SHALL apply that bound; when omitted, walks SHALL stay unbounded. Any other value SHALL fail with `BAD_REQUEST` before the project is read. Resolution of a project-relative Run path SHALL NOT depend on the bound.

#### Scenario: Bounded scan
- **WHEN** `memon --run-depth 1 scan .` runs in a project with Runs at `logs/<run>` and `outputs/<group>/<run>`
- **THEN** the snapshot contains the `logs/<run>` Runs and not the `outputs/<group>/<run>` Runs

#### Scenario: Invalid bound
- **WHEN** `memon --run-depth 3 scan .` runs
- **THEN** the command exits with a `BAD_REQUEST` error naming `--run-depth`

#### Scenario: Path target ignores the bound
- **WHEN** `memon --run-depth 1 run resolve-exp outputs/group/r-260901-090000` names an existing Run directory
- **THEN** the Run resolves even though the bounded walk would not discover it
