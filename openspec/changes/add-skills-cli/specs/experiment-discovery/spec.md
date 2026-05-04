## ADDED Requirements

### Requirement: Archived runs are skipped by default

The discovery layer SHALL treat the presence of an empty file `.archived` directly inside an experiment run directory (`<runDir>/.archived`) as a signal that the run is archived. `discoverExperiments` SHALL accept an optional `includeArchived: boolean` parameter (default `false`); when `false`, every directory whose base name matches the experiment regex AND which contains `.archived` SHALL be excluded from the result. When `true`, those directories SHALL be included and their index entries SHALL carry `archived: true`.

The web backend's runtime and the CLI's `list` / `scan` / `show` / `search` / `journal read` / `doctor` commands SHALL all flow through this same `discoverExperiments` call so the archive filter applies uniformly.

#### Scenario: Default discovery hides archived runs
- **GIVEN** experiment dirs `foo-260501-100000/` (with `.archived`) and `bar-260502-150000/` (without)
- **WHEN** `discoverExperiments(root)` runs without `includeArchived`
- **THEN** the result contains `bar-260502-150000` only; `foo-260501-100000` is absent

#### Scenario: includeArchived: true exposes both with a flag
- **WHEN** `discoverExperiments(root, { includeArchived: true })` runs against the same fixture
- **THEN** both experiments are returned; the archived one's index entry has `archived: true`, the other has `archived: false`

#### Scenario: README mtime is unchanged by archive toggle
- **GIVEN** a run with a known README mtime
- **WHEN** the run is archived (i.e., `.archived` is created) and the discovery scan runs
- **THEN** the README's mtime is identical to its value before archiving (only the sidecar file's existence changed)

#### Scenario: Existing default excludes still apply on top of archive filter
- **WHEN** a run dir matches the experiment regex AND contains `.archived` AND lives under a `__pycache__/` ancestor
- **THEN** discovery skips it (no double-counting; either filter excludes it independently)
