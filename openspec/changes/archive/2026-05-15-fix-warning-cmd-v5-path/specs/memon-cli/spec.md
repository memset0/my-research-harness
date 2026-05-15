## ADDED Requirements

### Requirement: memon experiment warning subcommands resolve exp-id via v5-aware discovery

The CLI's `memon experiment warning {add, list, resolve, reopen, delete}` subcommands SHALL resolve their first positional argument when it matches `^E\d{4}-[a-z0-9][a-z0-9-]*$` (the canonical exp-id form, `EXP_ID_RE`) by calling the core library's `discoverExperiments(projectRoot, projectName)` and selecting the returned record whose `.id` equals the supplied id, then using that record's `.path` field as the read/write target (already the absolute path to the exp doc README under the v5 folder layout, with the legacy v4 file form supported as a transitional `LEGACY_LAYOUT` fallback). The CLI SHALL NOT construct the README path manually as `join(projectRoot, 'docs', 'experiments', '${id}.md')` — that hard-coded form was correct under v4 but silently 404s on v5 layouts. When `discoverExperiments` returns no record matching the supplied id, the CLI SHALL exit with `NOT_FOUND` and stderr message `experiment "<id>" not found in <projectRoot>`. The run-dir-form branch (first argument does not match `EXP_ID_RE`, treated as a v2 run-dir base name, resolved via `scanProjectRoot`) SHALL remain unchanged.

#### Scenario: warning add resolves exp-id to v5 folder README
- **GIVEN** a project root with `docs/experiments/E0001-foo/README.md` containing the canonical `## Warnings` table header
- **WHEN** the user runs `memon experiment warning add E0001-foo --run bar-260501-100000 --category result --message "loss diverges" --project-root <root>`
- **THEN** the CLI writes the new row to `docs/experiments/E0001-foo/README.md` (the v5 location)
- **AND** the JOURNAL `[WARNING]` event carries `` `E0001-foo` op=add ... run=bar-260501-100000 ... ``
- **AND** the response is `{"ok":true,"rowId":"w_...","mtime":...}`

#### Scenario: warning add resolves exp-id to legacy v4 file during migration
- **GIVEN** a project root mid-migration with `docs/experiments/E0001-foo.md` still in legacy file form (no folder yet — the migration has not run for this id)
- **WHEN** the user runs `memon experiment warning add E0001-foo --category result --message "..." --project-root <root>`
- **THEN** the CLI writes the new row to `docs/experiments/E0001-foo.md` (the legacy file location, since `discoverExperiments` reports it under the `LEGACY_LAYOUT` fallback)
- **AND** the operation succeeds (no NOT_FOUND)

#### Scenario: warning add against non-existent exp-id returns NOT_FOUND
- **GIVEN** a project root with no `docs/experiments/E0099-*` folder or file
- **WHEN** the user runs `memon experiment warning add E0099-missing --category result --message "..."`
- **THEN** the CLI exits with `NOT_FOUND` and stderr names the missing id
- **AND** no file is written
- **AND** no JOURNAL event is appended

#### Scenario: warning list reads via v5-aware discovery
- **GIVEN** a project root with `docs/experiments/E0001-foo/README.md` containing one warning row
- **WHEN** the user runs `memon experiment warning list E0001-foo`
- **THEN** stdout is `{"ok":true,"warnings":[{...one row...}],"mtime":...,"hash":...}`
