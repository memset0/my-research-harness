## ADDED Requirements

### Requirement: Recursive scan from configured project roots

The system SHALL recursively scan every configured project's `root`
directory to discover **run directories**, applying both default and
user-configured exclude patterns at every level of recursion.

#### Scenario: Single project root with runs at variable depth
- **WHEN** `config.yml` declares a project with `root: /mnt/p` and the file
  system contains `/mnt/p/logs/foo-260501-100000/`,
  `/mnt/p/sub/logs/bar-260502-150000/`, and `/mnt/p/runs/baz-260503-080000/`
- **THEN** all three directories are discovered and registered as runs
  under that project

#### Scenario: Default excludes applied
- **WHEN** scanning a project root that contains `.git/`, `node_modules/`,
  `__pycache__/`, `.venv/`, `venv/`, and `.cache/` subdirectories
- **THEN** none of those directories are descended into, regardless of
  their contents

### Requirement: Run directory identification by name regex

The system SHALL identify a directory as a run if and only if its base
name matches the regex `^.+-\d{6}-\d{6}$`, regardless of the name of any
ancestor directory.

#### Scenario: Match without `logs/` ancestor
- **WHEN** the path `/mnt/p/anywhere/foo-260501-100000` exists and ancestor
  names contain neither `logs` nor `runs`
- **THEN** that directory is still identified as a run

#### Scenario: Non-matching name ignored
- **WHEN** a directory is named `foo-260501` (only one date segment) or
  `foo-2026-05-01-100000` (4-digit year)
- **THEN** that directory is not identified as a run

### Requirement: Polling with exponential backoff

The system SHALL detect file changes within run directories by per-directory
polling, never by `inotify`/fs watcher. Each tracked directory has its own
poll interval that doubles after each unchanged check, bounded between
`poll.min_interval_ms` (default 1000ms) and `poll.max_interval_ms` (default
300000ms), with `poll.backoff_factor` (default 2).

#### Scenario: Cold directory backs off to max
- **WHEN** a run directory has not changed for 30 minutes
- **THEN** its poll interval has reached `poll.max_interval_ms` and stays
  there until a change is observed

#### Scenario: Change resets backoff
- **WHEN** the poller observes that the directory's `mtime` (or any tracked
  file's `mtime`) has advanced since the last poll
- **THEN** the next interval for that directory is reset to
  `poll.min_interval_ms`

### Requirement: Active-attention reset

The system SHALL reset a directory's poll interval to
`poll.min_interval_ms` whenever the user actively engages with the run in
the web UI (opens the parent experiment page with this run expanded, edits
the run README, opens log tail).

#### Scenario: Opening parent experiment page with run expanded
- **WHEN** the web frontend loads `/p/<project>/e/<E-id>?run=<run-dir>`
- **THEN** the backend's poller for the named run dir has its interval
  reset to `poll.min_interval_ms` for at least one cycle

### Requirement: In-memory run index

The system SHALL maintain an in-memory index of all discovered runs. Each
indexed entry SHALL carry:
- a top-level `project` string field set from the `config.yml` project's
  `name` whose `discoverRuns` call surfaced the directory (membership is
  structural, never derived from frontmatter — `project:` field on the run
  side is gone in v3)
- a projection of frontmatter fields per `run-readme` capability
  (`id`, `name`, `status`, `created_at`, `updated_at`, `finished_at`,
  `experiment`, `host`, `pid`, `gpus`, `wandb`, `entry`, `command`)
- derived metadata (`mtime`, `path`, `hasReadme`, `archived`)

Membership filters (`memon list --project <name>`,
`/api/runs?project=<name>`) SHALL filter on the top-level `project` field.

#### Scenario: Top-level project equals config project name
- **WHEN** a run at `/mnt/p/logs/foo-260501-100000` is discovered via the
  project entry `{ name: "p", root: "/mnt/p" }`
- **THEN** the indexed entry's top-level `project` field equals `"p"`

#### Scenario: Missing README still indexed
- **WHEN** a discovered run directory has no `README.md`
- **THEN** the index entry has top-level `project` from config, `id` and
  `path` populated, `status: UNKNOWN`, `hasReadme: false`,
  `created_at` derived from the dir-name timestamp,
  `updated_at` equal to `created_at`

#### Scenario: Index update on poll change
- **WHEN** a poll cycle observes that a `README.md` `mtime` has advanced
- **THEN** the index entry is re-parsed within that cycle; the top-level
  `project` field is preserved (it cannot drift on edit since the
  frontmatter `project:` field is gone in v3)

### Requirement: Run slug uniqueness within a project

Run slugs SHALL be unique within a project. The slug part of a run's
directory name (the part before `-<YYMMDD>-<HHMMSS>`) SHALL be unique
across the project's run set. The indexer SHALL detect collisions and
surface a `DUPLICATE_RUN_SLUG` parse warning naming both colliding
paths.

#### Scenario: Duplicate slug surfaces warning
- **GIVEN** two run dirs `foo-260501-100000` and `foo-260502-130000`
- **WHEN** the indexer finishes a project scan
- **THEN** the parse-warning list contains a `DUPLICATE_RUN_SLUG` entry
  naming both run paths; both runs are still in the index

### Requirement: Archived runs are skipped by default

The discovery layer SHALL treat the presence of an empty file `.archived`
directly inside a run directory (`<runDir>/.archived`) as a signal that
the run is archived. `discoverRuns` SHALL accept an optional
`includeArchived: boolean` parameter (default `false`); when `false`,
runs with `.archived` SHALL be excluded. When `true`, those runs SHALL be
included with `archived: true`.

#### Scenario: Default discovery hides archived runs
- **GIVEN** run dirs `foo-260501-100000/` (with `.archived`) and
  `bar-260502-150000/` (without)
- **WHEN** `discoverRuns(root)` runs without `includeArchived`
- **THEN** the result contains `bar-260502-150000` only

#### Scenario: includeArchived: true exposes both with a flag
- **WHEN** `discoverRuns(root, { includeArchived: true })` runs
- **THEN** both runs are returned; the archived one's index entry has
  `archived: true`, the other has `archived: false`

### Requirement: Free-text search includes membership project

Free-text search over runs SHALL match against the top-level
`project` field. The free-text search (used by CLI `memon search` for
runs and the web list-view's search box) SHALL match against
membership project in addition to id, name, command, and body. The
legacy front-matter sub-project search match is removed in v3.

#### Scenario: Search by project name
- **GIVEN** runs indexed under top-level `project: "sparse-fsdp"`
- **WHEN** the user searches for `sparse-fsdp`
- **THEN** every such run is returned

## REMOVED Requirements

### Requirement: Front-matter project preservation (v2)

**Reason**: V3 removes the run frontmatter `project:` field entirely. The
parser ignores it; the index entry no longer projects it; search no longer
matches against it.

**Migration**: The `v2-to-v3.md` migration guide instructs the agent to
strip the field from every run README. Information that was carried by
that label is on the user to relocate (typically into `tags` on the
parent experiment, or into the experiment slug itself).
