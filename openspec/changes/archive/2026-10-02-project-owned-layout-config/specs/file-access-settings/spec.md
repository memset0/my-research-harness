## ADDED Requirements

### Requirement: Central Project configuration is deployment-only
A central (or standalone `serve`) Project entry SHALL describe deployment only: `name`, `root`, `host`, `storage`, `storage_group`, `persistent_cache`, `read_only` and `execution`. The project layout keys `run_dirs`, `include`, `exclude` and `github` belong to the project's tracked `.memon/project.yml`. During the deprecation window a central entry that still sets a layout key SHALL keep loading, its value SHALL keep taking precedence over the declaration, and configuration loading SHALL log one `CENTRAL_LAYOUT_DEPRECATED` warning per process for each such Project and key, naming the key and the `memon project init --from-central` migration. Loading SHALL NOT read or write any project file to produce this warning. Documentation and the example configuration SHALL show layout keys only in `.memon/project.yml`.

#### Scenario: Deprecated central key keeps working
- **GIVEN** a central entry for `project-a` with `exclude: [scratch]`
- **WHEN** the configuration is loaded twice in one process
- **THEN** loading succeeds, the Project's `exclude` is `[scratch]`, and exactly one `CENTRAL_LAYOUT_DEPRECATED` warning naming `project-a` and `exclude` is written to stderr

#### Scenario: Deployment-only entry
- **GIVEN** a central entry with only `name`, `root`, `host`, `storage` and `execution`
- **WHEN** the configuration is loaded
- **THEN** no `CENTRAL_LAYOUT_DEPRECATED` warning is written
