## MODIFIED Requirements

### Requirement: Index layout and ignore rule

The index directory SHALL contain at most: `.gitignore`, `snapshot.json`, an optional `compact.lock`, temporary files whose names start with `.`, an `events/` directory holding event files named `<ts>-<pid>-<rand>.json` (`<ts>` a 13-digit zero-padded epoch-millisecond ordering key, `<pid>` a process id, `<rand>` 8 lowercase hex characters) and in-flight files whose names start with `.tmp-`, and a `results/` directory holding one generated Results summary per Experiment named `<experiment-id>.json` plus in-flight files whose names start with `.`. Whoever creates the index directory SHALL first write `.memon/index/.gitignore` containing the single pattern `*`, so the index — including every Results summary — is never tracked regardless of the project's own ignore rules; tracked files elsewhere in `.memon/` SHALL be unaffected. Index files SHALL store only project-relative POSIX paths and SHALL NOT store absolute paths, host names or user names. Every timestamp field SHALL be ISO8601 with the writer's local offset.

#### Scenario: First writer creates the directory
- **GIVEN** a git project with tracked `.memon/version.json` and no `.memon/index/`
- **WHEN** a Run status is set through memon
- **THEN** `.memon/index/.gitignore` exists containing `*`, `git status` shows no new untracked or modified path, and `.memon/version.json` is unchanged

#### Scenario: No machine-specific data
- **WHEN** any snapshot, event or Results summary file is inspected
- **THEN** every path in it is project-relative and no host name, user name or absolute path appears

#### Scenario: Summary is never tracked
- **WHEN** the CLI writes `.memon/index/results/E0001-foo.json` in a git project
- **THEN** `git status` shows no new untracked path and `git check-ignore` reports the file as ignored

### Requirement: Snapshot and event formats are versioned

`snapshot.json` and every event file SHALL be JSON objects carrying `index_version` (integer, `2` for FS v9; a later minor release MAY raise it only through a requirement that introduces the new fields). The snapshot SHALL also carry `fs_convention_version`, `generated_at`, `generator` (`release`, `role`), the effective `run_dirs` the walk used together with `run_dirs_source` (`cli`, `central`, `project` or `default`, as reported by the Run-location resolver), `walk` (`verified_at`, `paths`), `merged_events` (the names merged into it) and the maps `runs`, `experiments` and `wiki` keyed by project-relative path. Entries SHALL carry exactly these fields:

- Run: README, directory and `result.csv` fingerprints, `verified_at`, `has_readme`, `status`, `created_at`, `updated_at`, `archived` with its source (`frontmatter`, `sidecar` or `none`), `deprecated`, the eligibility error (or null), the containment verdict, the derived owning Experiment (or null when none or several declare it), the `experiment_schema_version` recorded by its `result.csv` (or null), parse diagnostics summary, and the Run list-row fields the dashboard renders.
- Experiment: folder, `id`, `slug`, `status`, `archived`, declared `runs` verbatim, README fingerprint, the fingerprints of `implementation.yaml`, `investigation.yaml` and the description file `experiment.json`, `verified_at`, and the slim Experiment list-row fields.
- Wiki page: `id`, `kind`, `status`, `title`, `legacy_id`, deprecation, `sources`, fingerprint and `verified_at`.

A persisted fingerprint SHALL consist of inode number, size, modification time and change time (or null for an absent file) and SHALL NOT include the device number. An event SHALL carry `written_at`, `writer` (`release`, `role`, `op`), `upserts` and `removals` for the kinds it touches. A reader SHALL ignore a file whose `index_version` it does not support; a writer SHALL NOT replace a snapshot whose `index_version` is higher than its own, and a compactor MAY delete event files of a lower, unsupported version once they are older than one hour, because the changes they describe are reached through fingerprint validation.

#### Scenario: Unknown newer version
- **GIVEN** a snapshot with `index_version: 3`
- **WHEN** v9.0 central or `memon index compact` runs
- **THEN** it does not use the snapshot, does not overwrite it, and serves reads as if no index existed

#### Scenario: v8 index under v9 tooling
- **GIVEN** an FS v9 project whose index still holds an `index_version: 1` snapshot
- **WHEN** v9 central reads the project
- **THEN** it ignores the v1 snapshot, serves reads from files and replaces the snapshot with an `index_version: 2` rebuild

#### Scenario: Run-location source is recorded
- **GIVEN** a project whose `.memon/project.yml` declares `run_dirs: ["logs/*", "outputs/*/*"]`
- **WHEN** `memon index rebuild` runs without `--run-dir`
- **THEN** the snapshot records those two patterns with `run_dirs_source: "project"`

#### Scenario: Owner is derived, not written back
- **GIVEN** Experiment `E0001-foo` declaring `logs/a-260901-090000`
- **WHEN** the snapshot is produced
- **THEN** that Run entry's owner is `E0001-foo` and the Run README is not modified

#### Scenario: Result schema version is indexed
- **GIVEN** a Run whose `result.csv` records version 2
- **WHEN** its entry is produced
- **THEN** the entry carries the `result.csv` fingerprint and schema version 2

### Requirement: The index can always be rebuilt and checked against disk

A full rebuild SHALL derive a fresh snapshot from the project files alone (the bounded Run walk with the effective `run_dirs`, every Run README and `result.csv`, every Experiment README with its `implementation.yaml`, `investigation.yaml` and `experiment.json` fingerprints, every wiki page), replace the snapshot under the compaction lease, delete the events present when it started, and delete every Results summary whose Experiment no longer exists; it MAY regenerate the remaining summaries and SHALL leave none that it knows to be stale. A verification pass SHALL re-take every entry's fingerprint and re-walk, and report each difference as an `INDEX_DRIFT` record with `kind`, `key`, `field`, the indexed value and the disk value; when the snapshot's `run_dirs` differ from the verifier's effective patterns it SHALL report one `INDEX_DRIFT` record with `kind: "walk"` and `field: "run_dirs"` carrying both pattern lists and both sources. A reader SHALL reuse the snapshot's walk only when its recorded `run_dirs` equal the reader's effective patterns; otherwise it SHALL re-walk (the per-path entries remain usable under their fingerprints). Drift records are diagnostics of the cache, never research findings.

#### Scenario: Declaration edited after the rebuild
- **GIVEN** a snapshot built with the default patterns (`run_dirs_source: "default"`)
- **WHEN** the user adds `.memon/project.yml` with `run_dirs: ["outputs/*/*"]` and runs `memon index status --verify`
- **THEN** it reports an `INDEX_DRIFT` record for `walk` / `run_dirs`, and central re-walks with the declared patterns instead of reusing the recorded walk

#### Scenario: Rebuild after external edits
- **GIVEN** an index whose entries disagree with 20 READMEs and 5 `result.csv` files edited by a script
- **WHEN** a rebuild runs
- **THEN** a subsequent verification reports no `INDEX_DRIFT`

#### Scenario: Summary of a deleted Experiment
- **GIVEN** `.memon/index/results/E0003-old.json` and no Experiment `E0003-old`
- **WHEN** a rebuild runs
- **THEN** that summary file no longer exists
