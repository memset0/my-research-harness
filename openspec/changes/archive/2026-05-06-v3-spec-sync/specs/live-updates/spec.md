## MODIFIED Requirements

### Requirement: Cache invalidation on experiment-change

The `useMemonEvents()` hook SHALL invalidate TanStack Query caches when
events arrive on the three v3 topics. The mapping is described in the
"Experiment-doc and anomaly SSE topics" requirement; the v2 single-topic
mapping is replaced by the multi-topic mapping.

The v3 wiring drops the legacy `experiment-change` deprecated alias for
run edits — `experiment-change` events on the SSE wire mean
exp-doc events ONLY. Frontend code that previously listened to
`experiment-change` for run edits SHALL migrate to `run-change`. There
is no transition window beyond the v3 cutover.

#### Scenario: Run edit propagates to relevant queries
- **WHEN** an underlying run README is edited (locally or remotely)
- **THEN** within ~1 second, the run's parent experiment detail page
  (if open) and any list view refresh; the `['run', id]` query is
  invalidated AND, when the run carries an `experiment` parent id, the
  `['experiment', parentId]` query is also invalidated

#### Scenario: Toast on remote experiment-doc create
- **WHEN** an `experiment-change` event with `op: 'set'` is received
  for an experiment doc id NOT previously in the local cache
- **THEN** a `toast.info('New experiment: <id>')` appears for ~3
  seconds with a `View` action that navigates to the exp detail page

### Requirement: Experiment-doc and anomaly SSE topics

The system SHALL extend the live-updates SSE channel with three v3
event topics. The `useMemonEvents()` hook (and the underlying
`/api/events` SSE stream) SHALL fan out exactly three topics:

- `run-change` (NEW name; replaces v2's `experiment-change` for run-doc
  edits — no alias retained)
- `experiment-change` (NEW semantics: experiment-doc edits, creates,
  deletes, binds — repurposed from the v2 run-edit topic)
- `anomaly` (NEW: per `experiment-membership-anomalies`)

The `experiment-change` event payload SHALL include `{ id, op,
projectName }` where `op` is one of `set` (create or edit), `delete`,
or `bind` (link/unlink).

The `anomaly` event payload SHALL include `{ project: string, count:
number }` where `count` is the anomaly count for the project AFTER
the recompute that triggered the event. Per-anomaly granularity
(`{ op, record }`) is explicitly NOT supported — clients receive the
coarse signal and refetch `/api/anomalies?project=…` for the diff.
Rationale: implementation simplicity (no need to diff anomaly sets
across recomputes); the anomaly list is small enough that a refetch
is cheap (<50ms locally).

The `useMemonEvents()` hook SHALL invalidate the matching TanStack
Query caches on each topic:
- `run-change` → `['runs']`, `['run', evt.id]`,
  `['experiment', evt.parentExperimentId]` (when known)
- `experiment-change` → `['experiments']`, `['experiment', evt.id]`
- `anomaly` → `['anomalies', evt.project]`

#### Scenario: Experiment-doc edit propagates within ~1s
- **GIVEN** the user has an exp detail page open in tab A
- **WHEN** the same exp doc is saved from tab B (or a CLI command)
- **THEN** within ~1 second, tab A's exp page re-renders with the new
  body content, no manual refresh required

#### Scenario: Anomaly recompute pushes a banner refetch
- **GIVEN** the user is on a project list page with the anomaly banner
  showing N records
- **WHEN** the indexer's `recomputeAnomalies(project)` runs (e.g.
  triggered by a poll-detected exp-doc edit)
- **THEN** an `anomaly` event with `{ project, count }` is pushed; the
  banner invalidates `['anomalies', project]` and refetches the list;
  the banner re-renders with the updated record set within ~1 second

#### Scenario: Run edit carries parent experiment id when bound
- **GIVEN** a run with `frontMatter.experiment = "E0001-foo"`
- **WHEN** the run README is edited
- **THEN** the SSE `run-change` event payload SHALL include
  `parentExperimentId: "E0001-foo"`; the hook invalidates BOTH
  `['run', id]` AND `['experiment', "E0001-foo"]`
