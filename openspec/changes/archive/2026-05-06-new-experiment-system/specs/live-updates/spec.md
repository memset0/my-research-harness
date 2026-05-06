## ADDED Requirements

### Requirement: Experiment-doc and anomaly SSE topics

The system SHALL extend the live-updates SSE channel with two new event
topics in v3 and rename the existing one. The `useMemonEvents()` hook
(and the underlying `/api/events` SSE stream) SHALL fan out three
event topics in v3:
- `run-change` (replaces v2's `experiment-change` for run-doc edits)
- `experiment-change` (NEW: experiment-doc edits, creates, deletes,
  binds)
- `anomaly` (NEW: per `experiment-membership-anomalies`)

The `experiment-change` event payload SHALL include `{ id, op,
projectName }` where `op` is one of `set` (create or edit), `delete`,
or `bind` (link/unlink). The `anomaly` event payload SHALL include
`{ op: "add" | "remove", record }` where `record` is the anomaly
object.

The `useMemonEvents()` hook SHALL invalidate the matching TanStack
Query caches on each topic:
- `run-change` → `['runs']`, `['run', evt.id]`,
  `['experiment', evt.parentExperimentId]` (when known)
- `experiment-change` → `['experiments']`, `['experiment', evt.id]`
- `anomaly` → `['anomalies', evt.record.project]`

#### Scenario: Experiment edit propagates within ~1s
- **GIVEN** the user has an exp detail page open in tab A
- **WHEN** the same exp doc is saved from tab B (or a CLI command)
- **THEN** within ~1 second, tab A's exp page re-renders with the new
  body content, no manual refresh required

#### Scenario: Anomaly add pushes a banner update
- **GIVEN** the user is on a project list page with the anomaly banner
  empty
- **WHEN** an external process creates an orphan run in that project
- **THEN** the indexer detects the orphan, an SSE `anomaly` event with
  `op: "add"` is pushed, and the banner card appears at the top of
  the grid within ~1 second

#### Scenario: Anomaly resolve pushes a banner update
- **GIVEN** the banner shows 1 `MISMATCH_EXPERIMENT_REF` anomaly
- **WHEN** the user runs `memon experiment link` to reconcile
- **THEN** the indexer re-evaluates, an `anomaly` event with
  `op: "remove"` is pushed, and the banner card disappears (since
  count drops to 0)

## MODIFIED Requirements

### Requirement: Cache invalidation on experiment-change

The `useMemonEvents()` hook SHALL invalidate TanStack Query caches when
events arrive on the three v3 topics. The mapping is described in the
ADDED requirement above; the v2 single-topic mapping is replaced by the
multi-topic mapping.

The legacy `experiment-change` topic name continues to exist for
backward compatibility within this change's window — the backend emits
both the v2 `experiment-change` (for run edits, mirroring v2 behavior)
and the new `run-change` topic during a transition window. Frontend
code SHALL prefer subscribing to `run-change` going forward and treat
the legacy topic as a deprecated alias.

#### Scenario: Run edit propagates to relevant queries
- **WHEN** an underlying run README is edited (locally or remotely)
- **THEN** within ~1 second, the run's parent experiment detail page
  (if open) and any list view refresh; the `['run', id]` query and the
  `['experiment', parentId]` query are both invalidated

#### Scenario: Toast on remote experiment create
- **WHEN** an `experiment-change` event with `op: 'set'` is received
  for an experiment id NOT previously in the local cache
- **THEN** a `toast.info('New experiment: <id>')` appears for ~3
  seconds with a `View` action that navigates to the exp detail page
