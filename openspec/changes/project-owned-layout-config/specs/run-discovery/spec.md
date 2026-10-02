## ADDED Requirements

### Requirement: Project declaration carries the project layout
The project declaration `.memon/project.yml` (`schema_version: 1`) SHALL accept, besides `run_dirs`, the optional layout keys `include` (list of project-relative globs), `exclude` (list of names or globs) and `github` (list of `{owner, repo, path}` mappings), validated by the same schema as the matching central Project keys; a `github` `path` SHALL additionally be relative and SHALL NOT escape the project root. Any other key SHALL remain `PROJECT_DECLARATION_INVALID` naming the key.

The effective value of each layout key SHALL be resolved independently by the first present source, never merged: CLI `--run-dir` (only for `run_dirs`), then the central Project entry (deprecated), then `.memon/project.yml`, then the default (`run_dirs`: the FS v8 default; `include`: every path; `exclude`: none beyond the built-in excludes; `github`: none). A list is present when it is non-empty. A resolver SHALL report the source of each key (`cli`, `central`, `project`, `default`). When a central key is present and the declaration declares the same key with a different value, the central value SHALL be used and a `CENTRAL_LAYOUT_DEPRECATED` conflict warning SHALL be logged once per process for that root and key. Run discovery (and every walk built on it) SHALL apply the effective `include` and `exclude`, and code preview SHALL use the effective `github` mappings. An invalid declaration SHALL fail any resolution that falls through to it and SHALL be ignored when the central entry supplies every layout key.

#### Scenario: Exclude only in the project
- **GIVEN** no central `exclude` and `.memon/project.yml` declaring `exclude: [scratch]`
- **WHEN** Runs exist at `logs/a-260901-090000` and `logs/scratch/b-260901-090000` and the Project declares `run_dirs: ["logs/*", "logs/*/*"]`
- **THEN** discovery returns only `logs/a-260901-090000` and reports `exclude` from source `project`

#### Scenario: Layout only in central
- **GIVEN** the central Project entry sets `exclude: [scratch]` and the project has no declaration
- **WHEN** the Project is walked
- **THEN** `scratch` is excluded with source `central`

#### Scenario: Both sources agree
- **GIVEN** the central entry and `.memon/project.yml` both declare `exclude: [scratch]`
- **WHEN** the Project is walked
- **THEN** `scratch` is excluded with source `central` and no conflict warning is logged

#### Scenario: Sources conflict
- **GIVEN** the central entry declares `exclude: [scratch]` and `.memon/project.yml` declares `exclude: [tmp]`
- **WHEN** the Project is walked
- **THEN** only `scratch` is excluded, the source is `central`, and one `CENTRAL_LAYOUT_DEPRECATED` conflict warning names `exclude`

#### Scenario: GitHub path escaping the project
- **GIVEN** `.memon/project.yml` declares `github: [{owner: acme, repo: x, path: ../other}]`
- **WHEN** the declaration is loaded
- **THEN** loading fails with `PROJECT_DECLARATION_INVALID` naming `github`
