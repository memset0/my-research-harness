# experiment-discovery Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.
## Requirements
### Requirement: Recursive scan from configured project roots

The system SHALL recursively scan every configured project's `root` directory to discover experiment directories, applying both default and user-configured exclude patterns at every level of recursion.

#### Scenario: Single project root with experiments at variable depth
- **WHEN** `config.yml` declares a project with `root: /mnt/p` and the file system contains `/mnt/p/logs/foo-260501-100000/`, `/mnt/p/sub/logs/bar-260502-150000/`, and `/mnt/p/runs/baz-260503-080000/`
- **THEN** all three directories are discovered and registered as experiments under that project

#### Scenario: Default excludes applied
- **WHEN** scanning a project root that contains `.git/`, `node_modules/`, `__pycache__/`, `.venv/`, `venv/`, and `.cache/` subdirectories
- **THEN** none of those directories are descended into, regardless of their contents

#### Scenario: User exclude appended
- **WHEN** a project's `exclude` list in `config.yml` adds `dist`
- **THEN** the effective exclude set is the default set plus `dist`, and `<root>/dist/...` is not descended into

### Requirement: Experiment directory identification by name regex

The system SHALL identify a directory as an experiment if and only if its base name matches the regex `^.+-\d{6}-\d{6}$`, regardless of the name of any ancestor directory.

#### Scenario: Match without `logs/` ancestor
- **WHEN** the path `/mnt/p/anywhere/foo-260501-100000` exists and ancestor names contain neither `logs` nor `runs`
- **THEN** that directory is still identified as an experiment

#### Scenario: Non-matching name ignored
- **WHEN** a directory is named `foo-260501` (only one date segment) or `foo-2026-05-01-100000` (4-digit year)
- **THEN** that directory is not identified as an experiment

### Requirement: Polling with exponential backoff

The system SHALL detect file changes within experiment directories by per-directory polling, never by `inotify`/fs watcher. Each tracked directory has its own poll interval that doubles after each unchanged check, bounded between `poll.min_interval_ms` (default 1000ms) and `poll.max_interval_ms` (default 300000ms), with `poll.backoff_factor` (default 2).

#### Scenario: Cold directory backs off to max
- **WHEN** an experiment directory has not changed for 30 minutes
- **THEN** its poll interval has reached `poll.max_interval_ms` and stays there until a change is observed

#### Scenario: Change resets backoff
- **WHEN** the poller observes that the directory's `mtime` (or any tracked file's `mtime`) has advanced since last poll
- **THEN** the next interval for that directory is reset to `poll.min_interval_ms`

### Requirement: Active-attention reset

The system SHALL reset a directory's poll interval to `poll.min_interval_ms` whenever the user actively engages with that experiment in the web UI (opens detail page, edits README, opens log tail).

#### Scenario: Opening experiment detail page
- **WHEN** the web frontend issues a request that targets a specific experiment
- **THEN** the backend's poller for that experiment's directory has its interval reset to `poll.min_interval_ms` for at least one cycle

### Requirement: In-memory index with front-matter projection

The system SHALL maintain an in-memory index of all discovered experiments. Each indexed entry SHALL carry a top-level `project` string field whose value is the `name` of the `config.yml` project whose `discoverExperiments` call surfaced the directory. The index entry SHALL also carry a projection of front-matter fields (`id`, `name`, `status`, `created_at`, `finished_at`, `hypotheses`, `tags`, `wandb`) and the front-matter `project:` value (now interpreted as an OPTIONAL sub-project label, NOT as the membership key), plus derived metadata (`mtime`, `path`, whether `README.md` exists). Membership filters (`memon list --project <name>`, `ExperimentIndex.list({ project })`, the web `/api/experiments?project=<name>` route) SHALL filter on the top-level `project` field, never on the front-matter projection.

#### Scenario: Top-level project equals config project name
- **WHEN** an experiment at `/mnt/p/logs/foo-260501-100000` is discovered via the project entry `{ name: "p", root: "/mnt/p" }` in `config.yml`
- **THEN** the indexed entry's top-level `project` field equals `"p"`, regardless of what (if anything) the README's front-matter `project:` says

#### Scenario: Membership filter ignores front-matter project
- **GIVEN** an experiment indexed under top-level `project: "sparse-fsdp"` whose README declares front-matter `project: predictive-skip-validation`
- **WHEN** the consumer calls `index.list({ project: "sparse-fsdp" })`
- **THEN** that experiment is in the result set
- **AND** when the consumer calls `index.list({ project: "predictive-skip-validation" })`, the experiment is NOT in the result set

#### Scenario: Index reflects parsed front matter
- **WHEN** an experiment's `README.md` declares `status: RUNNING` in its front matter
- **THEN** the index entry for that experiment exposes `status = "RUNNING"`

#### Scenario: Missing README still indexed
- **WHEN** a discovered experiment directory has no `README.md`
- **THEN** the index entry for that experiment has its top-level `project` set from config, `id` and `path` populated, `status` defaults to `UNKNOWN`, and a `hasReadme: false` flag is set

#### Scenario: Index update on poll change
- **WHEN** a poll cycle observes that a `README.md` `mtime` has advanced
- **THEN** the index entry for that experiment is re-parsed and updated within that poll cycle, before the cycle returns; the top-level `project` field is preserved (it is not derived from the front matter and so cannot drift on edit)

#### Scenario: Front-matter project preserved verbatim (no backfill)
- **GIVEN** an experiment indexed under top-level `project: "sparse-fsdp"` whose README front matter has no `project:` line at all
- **WHEN** the index entry is consumed
- **THEN** the top-level `project` field is `"sparse-fsdp"` AND the front-matter `project` field is empty/null (NOT silently filled in with `"sparse-fsdp"`)

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

### Requirement: Free-text search includes membership project and sub-project

The free-text search over experiments (used by CLI `memon search` and the web list-view's search box) SHALL match against BOTH the top-level `project` field AND the front-matter `project` (sub-project) field, in addition to the existing fields (id, name, command, tags, hypotheses, body when scope=all). Either match SHALL surface the experiment.

#### Scenario: Search by top-level project name
- **GIVEN** experiments indexed under top-level `project: "sparse-fsdp"` whose front-matter `project:` is `"predictive-skip-validation"`
- **WHEN** the user searches for `sparse-fsdp`
- **THEN** every such experiment is returned

#### Scenario: Search by sub-project name
- **GIVEN** the same experiments
- **WHEN** the user searches for `predictive-skip-validation`
- **THEN** the matching experiments are returned (membership unchanged; this is a search match, not a filter switch)

