## ADDED Requirements

### Requirement: Slug-uniqueness anomalies

The membership join SHALL surface three v3 slug-uniqueness anomaly
codes in addition to the three binding-class anomalies (`ORPHAN_RUN`,
`PHANTOM_RUN_REF`, `MISMATCH_EXPERIMENT_REF`). These live on the
same `ExperimentMembershipAnomaly` shape (same `code` / `project` /
`runId` / `experimentId` / `message` / `detectedAt` fields) and
appear in the same `/api/anomalies` and `memon doctor` surfaces:

| Code | Severity | Trigger |
|---|---|---|
| `DUPLICATE_EXPERIMENT_SLUG` | error | two exp docs share the same slug — normally impossible (the create-time allocator forbids it), but possible if someone manually copies a file |
| `EXPERIMENT_SLUG_PREFIX_COLLISION` | error | one exp slug is a prefix of another (e.g. `fsdp` and `fsdp-collective`) — ambiguous when resolving run ids by prefix to their parent exp |
| `RUN_SLUG_PREFIX_VIOLATION` | info | a confirmed-member run's slug doesn't start with its parent exp's slug; the CLI emits this as a soft warning at link-time and it surfaces here for already-bound runs too |

Each anomaly emits a record per OFFENDING entity (e.g.
`DUPLICATE_EXPERIMENT_SLUG` emits one record per colliding exp doc,
not one record for the pair).

Run slugs MAY repeat across timestamps within a project — there is
NO `DUPLICATE_RUN_SLUG` code (see `run-discovery` delta in this
change). Only EXPERIMENT slug uniqueness is enforced.

#### Scenario: DUPLICATE_EXPERIMENT_SLUG detected
- **GIVEN** two exp docs `E0001-fsdp` and `E0002-fsdp` (both `slug: fsdp`)
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains TWO `DUPLICATE_EXPERIMENT_SLUG`
  records — one with `experimentId: E0001-fsdp`, one with
  `experimentId: E0002-fsdp` — so per-id views surface the issue

#### Scenario: EXPERIMENT_SLUG_PREFIX_COLLISION detected
- **GIVEN** exp docs `E0001-fsdp` (`slug: fsdp`) and `E0002-fsdp-collective`
  (`slug: fsdp-collective`)
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains
  `EXPERIMENT_SLUG_PREFIX_COLLISION` records naming both exp docs

#### Scenario: RUN_SLUG_PREFIX_VIOLATION detected
- **GIVEN** an exp `E0001-fsdp` whose `runs[]` includes
  `attention-260501-100000` (run slug "attention" doesn't start with
  exp slug "fsdp"), with both sides agreeing on the binding
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `RUN_SLUG_PREFIX_VIOLATION`
  record naming the exp + the run

#### Scenario: Run slug repeat across timestamps does not fire
- **GIVEN** runs `foo-260501-100000` and `foo-260601-200000` both
  bound to `E0001-foo`
- **WHEN** the indexer evaluates anomalies
- **THEN** NO `DUPLICATE_RUN_SLUG` (or any other slug-collision
  anomaly) record is emitted for the pair — run slugs MAY repeat
  across distinct timestamps

## MODIFIED Requirements

### Requirement: Three anomaly classes

The system SHALL detect three classes of inconsistency between the
experiment side and the run side of the bidirectional binding. Each
anomaly is an in-memory record produced by the indexer:

| Code | Trigger |
|---|---|
| `ORPHAN_RUN` | a run dir exists, has empty/no `experiment:` field, and is in no exp's `runs[]` |
| `PHANTOM_RUN_REF` | an exp's `runs[]` lists a name that is not a discovered run dir, or the named dir has no README |
| `MISMATCH_EXPERIMENT_REF` | a run says `experiment: E_a` but `E_a.runs[]` doesn't contain it; OR `E.runs[]` contains a run whose `experiment:` field names a different exp |

Each anomaly record SHALL carry:
- `code` (one of the three above, or one of the slug-uniqueness codes
  defined in the "Slug-uniqueness anomalies" requirement)
- `project` (top-level project name)
- `runId` (when the anomaly involves a run)
- `experimentId` (when the anomaly involves an experiment)
- `message` (human-readable single-sentence description)
- `detectedAt` (ISO8601 with offset)

Note: this requirement was named "Three anomaly classes" historically.
The actual on-the-wire `ExperimentMembershipAnomalyCode` union is now
SIX codes — the three binding codes here plus the three
slug-uniqueness codes. The title is preserved for backward reference
in commit logs and earlier change archives.

#### Scenario: ORPHAN_RUN detected
- **GIVEN** run `foo-260501-100000` with no `experiment:` field, and no
  experiment doc lists it in `runs[]`
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `ORPHAN_RUN` record naming
  `foo-260501-100000`

#### Scenario: PHANTOM_RUN_REF detected
- **GIVEN** an experiment `E0001-foo` with `runs: ["bar-260502-100000"]`
  but `bar-260502-100000` does not exist on disk
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `PHANTOM_RUN_REF` record naming the
  exp and the missing run

#### Scenario: MISMATCH_EXPERIMENT_REF detected
- **GIVEN** run `qux-260503-100000` with `experiment: E0003-baz`, and
  `E0003-baz.runs[]` does NOT contain `qux-260503-100000`
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `MISMATCH_EXPERIMENT_REF` record
  naming both sides

### Requirement: Anomaly stream API

The system SHALL expose:
- `GET /api/anomalies?project=<name>` — list of all current anomalies for
  the named project, ordered by `detectedAt` descending.
- `GET /api/experiments/:id/anomalies` — list of anomalies that touch the
  named experiment.
- SSE / live update channel: an `anomaly` event topic that broadcasts a
  coarse `{ project, count }` signal whenever
  `recomputeAnomalies(project)` runs. Clients receiving the event refetch
  the anomaly list to learn what changed; per-anomaly `{op, record}` is
  NOT supported (see `live-updates` spec for the rationale).

The endpoints SHALL pass the `project` and `id` parameters through
`assertWithinProjectRoots()` before any filesystem access.

#### Scenario: Anomaly list snapshot
- **WHEN** a client GETs `/api/anomalies?project=foo` and the indexer has
  detected three anomalies
- **THEN** the response is a JSON array of three records, ordered by
  `detectedAt` descending

#### Scenario: SSE pushes anomaly recompute signal
- **GIVEN** a client subscribed to the anomaly SSE channel
- **WHEN** the indexer's `recomputeAnomalies('foo')` runs (e.g. triggered
  by a poll-detected exp-doc edit)
- **THEN** the client receives an `anomaly` event with body
  `{project: 'foo', count: <N>}` where `N` is the post-recompute
  anomaly count for the project

#### Scenario: Banner refetches on anomaly event
- **GIVEN** an open anomaly banner showing M anomalies for project foo,
  and the user (or an external process) reconciles one anomaly
- **WHEN** the indexer re-runs `recomputeAnomalies('foo')` and the SSE
  event arrives
- **THEN** the client invalidates the `['anomalies', 'foo']` query and
  refetches `/api/anomalies?project=foo`; the banner re-renders with
  M-1 records (or hides if M was 1)
