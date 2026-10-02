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
