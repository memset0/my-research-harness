## ADDED Requirements

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

The system SHALL maintain an in-memory index of all discovered experiments, projecting key front-matter fields (`id`, `name`, `project`, `status`, `created_at`, `finished_at`, `hypotheses`, `tags`, `wandb`) plus derived metadata (`mtime`, `path`, whether `README.md` exists). The index is the data source for `memon list`, `memon search`, and the web list view.

#### Scenario: Index reflects parsed front matter
- **WHEN** an experiment's `README.md` declares `status: RUNNING` in its front matter
- **THEN** the index entry for that experiment exposes `status = "RUNNING"`

#### Scenario: Missing README still indexed
- **WHEN** a discovered experiment directory has no `README.md`
- **THEN** the index entry for that experiment has `id` and `path` populated, `status` defaults to `UNKNOWN`, and a `hasReadme: false` flag is set

#### Scenario: Index update on poll change
- **WHEN** a poll cycle observes that a `README.md` `mtime` has advanced
- **THEN** the index entry for that experiment is re-parsed and updated within that poll cycle, before the cycle returns
