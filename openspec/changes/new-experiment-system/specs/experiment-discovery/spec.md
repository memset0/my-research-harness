## ADDED Requirements

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

### Requirement: Membership computation joins exp and run indices

The system SHALL maintain a join over the experiment index and the run
index that produces, for each experiment, a list of confirmed member
runs. A run is considered a confirmed member iff:
1. The run's frontmatter `experiment:` field equals the experiment's `id`
   (`E<NNNN>-<slug>`).
2. The experiment's frontmatter `runs[]` contains the run's dir base
   name.

The join SHALL produce two side outputs alongside the member list:
- The set of anomalies for the experiment, per
  `experiment-membership-anomalies`.
- The effective times (`effective_created_at`, `effective_updated_at`)
  per `experiment-readme`.

#### Scenario: Confirmed member shows in membership
- **GIVEN** run `r1` with `experiment: E0001` and `E0001.runs: ["r1"]`
- **WHEN** the join runs
- **THEN** `E0001`'s confirmed members include `r1`; no anomaly is
  emitted for the pair

#### Scenario: One-sided claim surfaces anomaly, not membership
- **GIVEN** run `r2` with `experiment: E0001` but `E0001.runs[]` omits
  `r2`
- **WHEN** the join runs
- **THEN** `E0001`'s confirmed members do NOT include `r2`; the anomaly
  set contains `MISMATCH_EXPERIMENT_REF` for the pair

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

## REMOVED Requirements

### Requirement: Recursive scan from configured project roots (v2)

**Reason**: V2's discovery scanned the project root for "experiment
directories" (what v3 calls runs). That run-side discovery moves to the
new `run-discovery` capability. The `experiment-discovery` capability
now describes how the **experiment doc layer** is discovered.

**Migration**: No user action; the indexer code now scans both surfaces.

### Requirement: Experiment directory identification by name regex (v2)

**Reason**: That regex (`^.+-\d{6}-\d{6}$`) identifies runs in v3 and
moves to `run-discovery`.

**Migration**: No user action.

### Requirement: Polling with exponential backoff (v2 — for run dirs)

**Reason**: The polling schedule for run dirs moves to `run-discovery`.
The above `### Requirement: Polling with exponential backoff for
experiment docs` is the v3 analogue for the new layer.

**Migration**: No user action.

### Requirement: Active-attention reset (v2 — for run dirs)

**Reason**: Active-attention reset for run dirs moves to
`run-discovery`. The above `### Requirement: Active-attention reset for
experiments` is the v3 exp-side analogue.

**Migration**: No user action.

### Requirement: In-memory index with front-matter projection (v2)

**Reason**: The in-memory index for runs moves to `run-discovery`. The
v3 experiment index is a parallel structure; the join between them is
covered by the new `### Requirement: Membership computation joins exp
and run indices` above.

**Migration**: No user action.

### Requirement: Archived runs are skipped by default (v2)

**Reason**: This is a run-side concern and moves to `run-discovery`.
Experiment docs do not have an archive concept in v3.

**Migration**: No user action.

### Requirement: Free-text search includes membership project and sub-project (v2)

**Reason**: The sub-project search target is removed entirely in v3 (the
sub-project field on runs is gone). Search of run records still matches
against the top-level membership project, per `run-discovery`. Search of
experiment records is described above.

**Migration**: User-facing impact: searches that previously matched on
sub-project labels no longer return results. Users should use tags on
the experiment doc as the v3 grouping mechanism.
