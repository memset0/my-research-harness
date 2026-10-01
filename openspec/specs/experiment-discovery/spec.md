# experiment-discovery Specification

## Purpose
TBD - created by archiving change add-memon-mvp. Update Purpose after archive.

## Requirements

### Requirement: Experiment doc discovery scans `docs/experiments/`

For every configured project root, the system SHALL scan
`<projectRoot>/docs/experiments/*.md` to discover experiment docs. Each
file matching the pattern `E<NNNN>-<slug>.md` (4-digit zero-padded `NNNN`,
kebab-case `slug`) SHALL be parsed per the `experiment-readme` capability
and added to the in-memory experiment index.

Files in `docs/experiments/` not matching the `E<NNNN>-<slug>.md` pattern
SHALL be ignored (no warning, no index entry). Subdirectories under
`docs/experiments/` SHALL NOT be descended into.

#### Scenario: Single project with multiple experiment docs
- **GIVEN** a project root with `docs/experiments/E0001-foo.md`,
  `docs/experiments/E0002-bar-baz.md`, and an unrelated
  `docs/experiments/notes.md`
- **WHEN** the indexer scans
- **THEN** the experiment index contains entries for `E0001-foo` and
  `E0002-bar-baz`; `notes.md` is silently ignored

#### Scenario: Subdir ignored
- **WHEN** `docs/experiments/draft/E9999-wip.md` exists
- **THEN** the indexer does NOT include `E9999-wip` (it is one level too
  deep)

### Requirement: Polling with exponential backoff for experiment docs

The experiment index SHALL be kept current by polling the contents of
`<projectRoot>/docs/experiments/` (directory mtime + per-file mtimes) on
the same exponential-backoff schedule used for run discovery. fs watchers
are not used.

#### Scenario: New exp doc appears
- **GIVEN** the dir mtime of `docs/experiments/` advances because the
  user created a new file
- **WHEN** the next poll runs
- **THEN** the new file is parsed and added to the index within that
  poll cycle

#### Scenario: Cold dir backs off to max
- **WHEN** `docs/experiments/` has not changed for 30 minutes
- **THEN** its poll interval has reached `poll.max_interval_ms` and stays
  there until a change is observed

### Requirement: Active-attention reset for experiments

The system SHALL reset the experiment-doc poll interval to
`poll.min_interval_ms` whenever the user actively engages with the
experiment in the web UI (opens the exp detail page, edits the exp doc,
adds or resolves a warning).

#### Scenario: Opening exp detail resets poll
- **WHEN** the web frontend issues a request that targets a specific
  experiment id
- **THEN** the backend's poller for `docs/experiments/<id>.md` has its
  interval reset to `poll.min_interval_ms` for at least one cycle

### Requirement: Free-text search includes experiment fields

The free-text search over experiments SHALL match against `title`,
`slug`, body content, and the `tags[]` and `hypotheses[]` arrays. The
removed `project` (sub-project) field is NOT a search target in v3.

#### Scenario: Search matches title
- **GIVEN** an experiment with `title: "Zero terminal-SNR brightness study"`
- **WHEN** the user searches `brightness`
- **THEN** that experiment is in the result set

### Requirement: Membership derives from Experiment declarations

The system SHALL compute, for each experiment, its member Runs from its `runs[]` declarations only. A declared path that resolves to exactly one Run directory under a supported Run root, and that no other Experiment declares, is a confirmed member; a legacy bare base name counts only when it is unique. A Run README `experiment` field SHALL NOT add, remove or redirect membership. The join SHALL still produce the anomalies per `experiment-membership-anomalies` and the effective times per `experiment-readme`. A displayed parent for a Run is the single Experiment that declares it, or none.

#### Scenario: Confirmed member shows in membership
- **GIVEN** `E0001.runs: ["logs/r1-260501-100000"]` and that Run directory exists without an `experiment` field
- **WHEN** the join runs
- **THEN** `E0001`'s confirmed members include `logs/r1-260501-100000` and no anomaly is emitted

#### Scenario: Legacy Run-side claim is ignored
- **GIVEN** Run `logs/r2-260501-100000` still carries `experiment: E0001` but no Experiment declares it
- **WHEN** the join runs
- **THEN** it is not a member of `E0001`, it has no displayed parent, and only Run lint reports the obsolete field

### Requirement: Generated timestamps carry the local offset

Every timestamp memon generates for a scan result, a membership anomaly, a synthesized Run `created_at`, a code-review `updated_at`, a commit-mark `updatedAt`, a rename `updated_at` or a project-store metric SHALL be ISO8601 with the writer's local timezone offset (`YYYY-MM-DDTHH:MM:SS±HH:MM`). None of them SHALL be a UTC `Z` timestamp. All of them SHALL come from one shared formatter so their shape cannot drift.

#### Scenario: Scan result is stamped with a local offset

- **WHEN** a project root is scanned
- **THEN** the result's `scannedAt` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$`

#### Scenario: Membership anomaly default detection time

- **WHEN** membership is computed without an explicit detection time
- **THEN** every anomaly's `detectedAt` carries a numeric offset and no `Z` suffix

#### Scenario: Code-review toggle writes a local timestamp

- **WHEN** a code-review commit or todo item is toggled through the central document service
- **THEN** the `updated_at` written to disk carries a numeric offset and no `Z` suffix
