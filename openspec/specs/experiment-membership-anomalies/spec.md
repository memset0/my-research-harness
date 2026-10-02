# experiment-membership-anomalies Specification

## Purpose
Detects inconsistencies in Experiment-declared Run membership, such as declared Run paths that are missing or ambiguous, the same path claimed by several Experiments, and Experiment slug-uniqueness violations, and reports them without repairing anything. An unassigned Run is valid and is not an anomaly. It serves the owner through `GET /api/anomalies`, the `anomaly` SSE topic and a dashboard banner, recomputed whenever declarations change; detection lives in `@memon/core` membership code.

## Requirements

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

### Requirement: Web banner for anomalies

The web list page SHALL render a yellow-bordered card pinned at the top
of the experiment-card grid whenever the project has at least one
anomaly. The card:
- Shows a count summary in its header (`⚠ 3 issues need resolution`)
- Lists each anomaly's message in a scrollable body (`max-h-[20vh]
  overflow-y-auto`)
- Provides a `Copy all` action button anchored to the top-right of the
  card header (via shadcn's `CardAction` slot) that copies the
  anomalies as plain text formatted for paste into an agent prompt

The banner SHALL NOT provide a `Hide` button or any per-session
dismissal affordance. Users resolve anomalies by acting on them (CLI,
linking the run to an exp, etc.), not by hiding the banner.

When the project has zero anomalies, the card SHALL NOT render.

#### Scenario: Empty anomaly state hides banner
- **WHEN** `/api/anomalies?project=foo` returns `[]`
- **THEN** the banner card is not rendered

#### Scenario: Copy all formats anomalies for agent paste
- **WHEN** the user clicks Copy all on a banner showing 2 anomalies
- **THEN** the system clipboard contains a single text block listing
  each anomaly with `code`, the relevant ID(s), and `message`, prefixed
  by a header naming the project and timestamp

#### Scenario: Copy all is the only header action
- **WHEN** the banner renders
- **THEN** the only action button in the card header is `Copy all`,
  rendered with the shadcn `data-slot="card-action"` attribute so it
  occupies the header's right column

### Requirement: Slug-uniqueness anomalies

The membership join SHALL surface three v3 slug-uniqueness anomaly
codes in addition to the declaration anomalies (`PHANTOM_RUN_REF`,
`MISMATCH_EXPERIMENT_REF`). These live on the
same `ExperimentMembershipAnomaly` shape (same `code` / `project` /
`runId` / `experimentId` / `message` / `detectedAt` fields) and
appear in the same `/api/anomalies` surface and in structural lint:

| Code | Severity | Trigger |
|---|---|---|
| `DUPLICATE_EXPERIMENT_SLUG` | error | two exp docs share the same slug — normally impossible (the create-time allocator forbids it), but possible if someone manually copies a file |
| `EXPERIMENT_SLUG_PREFIX_COLLISION` | error | one exp slug is a prefix of another (e.g. `fsdp` and `fsdp-collective`) — ambiguous when resolving run ids by prefix to their parent exp |
| `RUN_SLUG_PREFIX_VIOLATION` | info | a declared member run's slug doesn't start with its declaring exp's slug; the CLI emits this as a soft warning at link-time and it surfaces here for already-declared runs too |

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
  exp slug "fsdp"), declared by no other Experiment
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `RUN_SLUG_PREFIX_VIOLATION`
  record naming the exp + the run

#### Scenario: Run slug repeat across timestamps does not fire
- **GIVEN** runs `foo-260501-100000` and `foo-260601-200000` both
  declared by `E0001-foo`
- **WHEN** the indexer evaluates anomalies
- **THEN** NO `DUPLICATE_RUN_SLUG` (or any other slug-collision
  anomaly) record is emitted for the pair — run slugs MAY repeat
  across distinct timestamps

### Requirement: FS v7 validation checks declarations rather than intersections
For FS v7, declaration validation SHALL replace the v6 bidirectional three-class model and confirmed-member intersection. It SHALL report malformed/unsafe paths, missing or unreadable targets, duplicate paths in one Experiment and the same path claimed by multiple Experiments. It SHALL NOT classify an unassigned Run or the absence of a Run parent field as an ownership anomaly. Unrelated Experiment identity checks remain in force.

#### Scenario: Two owners claim one path
- **WHEN** two Experiments list the same canonical Run path
- **THEN** validation reports both owners and refuses an operation that would create that conflict

#### Scenario: Missing member is not erased
- **WHEN** a declared member directory is missing
- **THEN** validation reports the missing target and preserves its declared membership for repair

### Requirement: Declaration anomaly records

The indexer SHALL produce in-memory anomaly records from Experiment declarations alone:

| Code | Trigger |
|---|---|
| `PHANTOM_RUN_REF` | an Experiment `runs[]` entry resolves to no Run directory, or to an ambiguous legacy base name |
| `MISMATCH_EXPERIMENT_REF` | the same Run path is declared by more than one Experiment |

Whether a project-relative `runs[]` path resolves to a Run directory SHALL be decided by checking that path directly beneath the project root (contained, non-escaping, and a directory), not by looking it up in the result of the Run walk; directories hidden from the walk by excludes or by `run_dirs` patterns SHALL still count as existing. An existing declared directory without a README SHALL NOT be reported as `PHANTOM_RUN_REF`; it is a member whose Run record carries the existing README-less Run classification (`hasReadme: false`, synthesized identity, README-less lint). A path that is missing, not a directory, malformed or escapes the project SHALL be reported as `PHANTOM_RUN_REF`. Legacy base-name references (no `/`) SHALL continue to resolve through discovered Runs.

`ORPHAN_RUN` remains in the wire code union for compatibility but SHALL NOT be emitted: an unassigned Run is valid. A legacy Run `experiment` field is reported by Run structural lint, never as a membership anomaly. Each record SHALL carry `code` (one of the codes above or a slug-uniqueness code), `project`, `runId` (the declared reference) when a Run is involved, `experimentId` when an Experiment is involved, a one-sentence `message` and `detectedAt` (ISO8601 with offset).

#### Scenario: PHANTOM_RUN_REF detected
- **GIVEN** an experiment `E0001-foo` with `runs: ["logs/bar-260502-100000"]` but that directory does not exist
- **WHEN** the indexer evaluates anomalies
- **THEN** the anomaly set contains a `PHANTOM_RUN_REF` record naming the exp and the missing path, and the declaration is kept

#### Scenario: Declared path hidden from the walk is not a phantom
- **GIVEN** a Project excluding `outputs` and an experiment declaring `outputs/sweep/a-260901-090000`, which exists
- **WHEN** the indexer evaluates anomalies
- **THEN** no `PHANTOM_RUN_REF` names that path and the Experiment lists it as a confirmed member

#### Scenario: Declared directory without README
- **GIVEN** an experiment declaring `logs/r-260901-090000`, an existing directory with no README
- **WHEN** the indexer evaluates anomalies
- **THEN** no `PHANTOM_RUN_REF` names that path and the member's Run record reports `hasReadme: false`

#### Scenario: Duplicate owners detected
- **GIVEN** `E0001-foo` and `E0002-bar` both declare `logs/qux-260503-100000`
- **WHEN** the indexer evaluates anomalies
- **THEN** each Experiment gets a `MISMATCH_EXPERIMENT_REF` record for that path and neither lists it as a confirmed member

#### Scenario: Unassigned Run is not an anomaly
- **GIVEN** a Run that no Experiment declares
- **WHEN** the indexer evaluates anomalies
- **THEN** no anomaly record names that Run

### Requirement: Anomaly recompute on declaration change

The system SHALL re-evaluate a project's anomalies whenever an Experiment document changes, is created or is deleted, and whenever a Run directory appears or disappears. Editing a Run README SHALL NOT change ownership, so it needs no ownership recompute beyond refreshing that Run's displayed data.

#### Scenario: Declaration moves a Run
- **GIVEN** `E0001` declares `logs/r-260501-100000`
- **WHEN** the path is removed from `E0001.runs[]` and added to `E0002.runs[]`
- **THEN** the next recompute shows the Run under `E0002` only, with no anomaly
