## Purpose

Defines the FS v8 per-project derived index under `.memon/index/`: a rebuildable, fingerprint-validated cache of Run, Experiment and wiki summaries that every memon writer maintains through exclusive event files, that central and the CLI merge and compact, and that is never a source of truth.

## ADDED Requirements

### Requirement: The derived index is a rebuildable cache, never a source of truth

A FS v8 project MAY contain a derived index at `<projectRoot>/.memon/index/`. Project files SHALL remain the only source of truth: every value in the index SHALL be derivable from project files alone, and deleting the whole directory SHALL change no API response, CLI output or lint result beyond the cost of reading the files again. No reader SHALL treat an index entry as evidence that contradicts a file it has read in the same request, and no writer SHALL read the index to decide what to write into a project document.

#### Scenario: Index deleted
- **GIVEN** a project whose `.memon/index/` directory is removed while central is running
- **WHEN** the Experiment list, an Experiment detail, the wiki list and anomalies are requested
- **THEN** each response equals the response computed from the project files, and the index is recreated later without operator action

#### Scenario: Writer does not consult the index
- **WHEN** `memon experiment link` adds a Run path to an Experiment
- **THEN** the declared path and lock check are computed from the Experiment README on disk, not from any index entry

### Requirement: Index layout and ignore rule

The index directory SHALL contain at most: `.gitignore`, `snapshot.json`, an optional `compact.lock`, temporary files whose names start with `.`, and an `events/` directory holding event files named `<ts>-<pid>-<rand>.json` (`<ts>` a 13-digit zero-padded epoch-millisecond ordering key, `<pid>` a process id, `<rand>` 8 lowercase hex characters) and in-flight files whose names start with `.tmp-`. Whoever creates the index directory SHALL first write `.memon/index/.gitignore` containing the single pattern `*`, so the index is never tracked regardless of the project's own ignore rules; tracked files elsewhere in `.memon/` SHALL be unaffected. Index files SHALL store only project-relative POSIX paths and SHALL NOT store absolute paths, host names or user names. Every timestamp field SHALL be ISO8601 with the writer's local offset.

#### Scenario: First writer creates the directory
- **GIVEN** a git project with tracked `.memon/version.json` and no `.memon/index/`
- **WHEN** a Run status is set through memon
- **THEN** `.memon/index/.gitignore` exists containing `*`, `git status` shows no new untracked or modified path, and `.memon/version.json` is unchanged

#### Scenario: No machine-specific data
- **WHEN** any snapshot or event file is inspected
- **THEN** every path in it is project-relative and no host name, user name or absolute path appears

### Requirement: Snapshot and event formats are versioned

`snapshot.json` and every event file SHALL be JSON objects carrying `index_version` (integer, `1` for FS v8). The snapshot SHALL also carry `fs_convention_version`, `generated_at`, `generator` (`release`, `role`), the effective `run_dirs` the walk used together with `run_dirs_source` (`cli`, `central`, `project` or `default`, as reported by the Run-location resolver), `walk` (`verified_at`, `paths`), `merged_events` (the names merged into it) and the maps `runs`, `experiments` and `wiki` keyed by project-relative path. Entries SHALL carry exactly these fields:

- Run: README and directory fingerprints, `verified_at`, `has_readme`, `status`, `created_at`, `updated_at`, `archived` with its source (`frontmatter`, `sidecar` or `none`), `deprecated`, the eligibility error (or null), the containment verdict, the derived owning Experiment (or null when none or several declare it), parse diagnostics summary, and the Run list-row fields the dashboard renders.
- Experiment: folder, `id`, `slug`, `status`, `archived`, declared `runs` verbatim, README fingerprint, the fingerprints of `implementation.yaml`, `investigation.yaml` and `results.yaml`, `verified_at`, and the slim Experiment list-row fields.
- Wiki page: `id`, `kind`, `status`, `title`, `legacy_id`, deprecation, `sources`, fingerprint and `verified_at`.

A persisted fingerprint SHALL consist of inode number, size, modification time and change time (or null for an absent file) and SHALL NOT include the device number. An event SHALL carry `written_at`, `writer` (`release`, `role`, `op`), `upserts` and `removals` for the kinds it touches. A reader SHALL ignore a file whose `index_version` it does not support; a writer SHALL NOT replace a snapshot whose `index_version` is higher than its own.

#### Scenario: Unknown newer version
- **GIVEN** a snapshot with `index_version: 2`
- **WHEN** v8.0 central or `memon index compact` runs
- **THEN** it does not use the snapshot, does not overwrite it, and serves reads as if no index existed

#### Scenario: Run-location source is recorded
- **GIVEN** a project whose `.memon/project.yml` declares `run_dirs: ["logs/*", "outputs/*/*"]`
- **WHEN** `memon index rebuild` runs without `--run-dir`
- **THEN** the snapshot records those two patterns with `run_dirs_source: "project"`

#### Scenario: Owner is derived, not written back
- **GIVEN** Experiment `E0001-foo` declaring `logs/a-260901-090000`
- **WHEN** the snapshot is produced
- **THEN** that Run entry's owner is `E0001-foo` and the Run README is not modified

### Requirement: Every memon Experiment and Run write emits an index event

After every successful write of an Experiment or Run document performed by memon (create, link, unlink, status, archive, README write, warning write, delete, rename, deprecate, Run record), on any surface (CLI node, central, standalone), the writer SHALL publish one event describing the resulting entries and removals. Publishing SHALL create a uniquely named temporary file with exclusive create, write it completely, then rename it to its final event name; it SHALL NOT append to or modify any existing index file. Publishing SHALL NOT require central, a lock or the FS marker. A publishing failure SHALL NOT fail, roll back or change the exit code of the primary write; it SHALL be reported as an `INDEX_EVENT_FAILED` warning on the operation's result.

#### Scenario: Concurrent writers on two nodes
- **WHEN** two CLI nodes set the status of two different Runs of the same project at the same moment
- **THEN** two distinct event files exist afterwards and both changes are visible after merging

#### Scenario: Read-only index directory
- **GIVEN** `.memon/index/events/` is not writable
- **WHEN** `memon run status set` succeeds in writing the Run README
- **THEN** the command exits 0, the README is updated and the result carries an `INDEX_EVENT_FAILED` warning

#### Scenario: Readers never see partial events
- **WHEN** a reader lists `events/` while a writer is publishing
- **THEN** it ignores dot-prefixed files and every listed event parses completely

### Requirement: Merging and compaction are idempotent and lossless by name

The merged view SHALL be the snapshot with unmerged events applied in file-name order, where an event entry replaces the current entry unless the current entry's fingerprint has a newer change time, and a removal applies unless the current entry was verified after the event was written; owners SHALL be recomputed after merging. Compaction SHALL hold a lease (`compact.lock`, exclusive create, with an expiry of at most 120 s; an expired lease MAY be taken over by renaming it away), write the merged view to a temporary file and rename it over `snapshot.json`, record the merged names in `merged_events`, and then delete exactly those event files. It SHALL NOT delete events it did not merge, and SHALL remove abandoned temporary files older than one hour. Repeating a compaction with no new events SHALL produce an equivalent snapshot.

#### Scenario: Event created during compaction survives
- **WHEN** a writer publishes an event after a compactor listed `events/`
- **THEN** that event is not deleted and is applied by the next merge

#### Scenario: Lease held
- **GIVEN** an unexpired `compact.lock` owned by central
- **WHEN** `memon index compact` runs
- **THEN** it exits 9 with `CONFLICT` and changes no index file

### Requirement: Index entries are validated before they outlive their window

Every entry SHALL carry the time it was last verified against its file. A reader SHALL NOT serve an entry older than the window that applies to its consumer without re-taking the file's fingerprint; when the fingerprint differs the entry SHALL be reloaded from the file. List-class consumers MAY use the central windows (60 s, 300 s for Runs with a terminal status), so an external edit reaches every central list within 5 minutes while the Project is active; detail consumers SHALL read the requested document itself on every request. A Run directory created outside memon SHALL appear in walk-based lists after the next walk validation, at most 60 s later while the Project is active.

#### Scenario: Script rewrites a Run status
- **GIVEN** a Run indexed as `RUNNING`
- **WHEN** a launch script rewrites its README to `status: FINISHED` without memon
- **THEN** central lists show `FINISHED` within 60 s while the Project is active, and the Run detail shows it on the next request

#### Scenario: git pull rewrites READMEs
- **WHEN** a pull changes 50 tracked Run READMEs
- **THEN** each changed entry is reloaded after its fingerprint is re-taken and no stale value survives past its window

### Requirement: A damaged or missing index degrades to file reads

If `snapshot.json` is missing, unreadable, not valid JSON, fails its schema or has an unsupported version, readers SHALL behave as if the index were empty and read project files on demand, without reporting an error to the page or command; central SHALL schedule a rebuild. An unparsable event file older than 60 s SHALL be skipped and reported by `memon index status`, and SHALL NOT block other events.

#### Scenario: Truncated snapshot
- **GIVEN** `snapshot.json` truncated by a full disk
- **WHEN** the Experiment list is requested
- **THEN** the list is computed from files with the same content as without an index, and a later rebuild replaces the snapshot

### Requirement: The index can always be rebuilt and checked against disk

A full rebuild SHALL derive a fresh snapshot from the project files alone (the bounded Run walk with the effective `run_dirs`, every Run README, every Experiment README with its YAML fingerprints, every wiki page), replace the snapshot under the compaction lease and delete the events present when it started. A verification pass SHALL re-take every entry's fingerprint and re-walk, and report each difference as an `INDEX_DRIFT` record with `kind`, `key`, `field`, the indexed value and the disk value; when the snapshot's `run_dirs` differ from the verifier's effective patterns it SHALL report one `INDEX_DRIFT` record with `kind: "walk"` and `field: "run_dirs"` carrying both pattern lists and both sources. A reader SHALL reuse the snapshot's walk only when its recorded `run_dirs` equal the reader's effective patterns; otherwise it SHALL re-walk (the per-path entries remain usable under their fingerprints). Drift records are diagnostics of the cache, never research findings.

#### Scenario: Declaration edited after the rebuild
- **GIVEN** a snapshot built with the default patterns (`run_dirs_source: "default"`)
- **WHEN** the user adds `.memon/project.yml` with `run_dirs: ["outputs/*/*"]` and runs `memon index status --verify`
- **THEN** it reports an `INDEX_DRIFT` record for `walk` / `run_dirs`, and central re-walks with the declared patterns instead of reusing the recorded walk

#### Scenario: Rebuild after external edits
- **GIVEN** an index whose entries disagree with 20 READMEs edited by a script
- **WHEN** a rebuild runs
- **THEN** a subsequent verification reports no `INDEX_DRIFT`
