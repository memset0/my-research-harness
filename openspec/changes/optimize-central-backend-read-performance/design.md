## Context

The split deployment now serves large NFS-backed Projects through a loopback Backend and an SSH-forwarded central gateway. Measurements show that the extra gateway hop contributes hundreds of milliseconds at most, while repeated Backend detail requests remain multi-second. The current Backend read service calls recursive Run discovery, parses all Runs, discovers Experiments, and recomputes membership for every read family. A separate filesystem monitor scans on exponential backoff only to produce events; it does not populate the read service. The legacy standalone runtime already demonstrates the intended pattern: a warm `RunIndex`, file/directory caches, and one per-path polling controller.

Representative baseline evidence from a large Project:

- A repeated Experiment detail is roughly 2.9–3.3 seconds at the Backend and 3.4 seconds through central despite a 74 KB response.
- A repeated Run detail is roughly 2.4 seconds at the Backend despite a 2.3 KB response.
- Full Run snapshot work is dominated by recursive discovery: roughly 2.3–4.1 seconds for 482 Runs, versus about 0.1 seconds for Experiment discovery and 2 ms for membership.
- Unconstrained `**/*` discovery is roughly 2.9 seconds on the NFS tree; known Run roots complete in about 10 ms. The excluded matches are nested/no-README false positives in the observed deployment.

## Goals / Non-Goals

**Goals:**

- Make warm list/detail reads independent of Project tree size except for response construction.
- Use one coherent Project generation for reads, monitor invalidation, mutations, and events.
- Preserve security boundaries, DTO validation, atomic mutation semantics, and last-known-good behavior.
- Make every relevant cache/backoff policy explicit and observable.
- Provide a reversible machine-local include optimization before the Backend release lands.

**Non-Goals:**

- Caching authenticated responses at Caddy or a shared external cache.
- Changing filesystem convention v6, public URL shapes, Host identity, or Backend tokens.
- Returning partial Project data merely to improve headline latency.
- Loading arbitrary Project contents into the central process.

## Decisions

### Backend owns a per-Project snapshot store

Introduce one long-lived store per Backend process keyed by Project name. Each immutable generation contains parsed Runs and Experiments, `Map` indexes by ID, membership/anomalies, hypotheses, and journal data. A refresh builds a complete candidate off to the side and atomically swaps it only after validation succeeds.

This reuses the standalone runtime's proven index/cache model while keeping the framework-neutral Backend package independent of Next. Caching in central was rejected because it would duplicate cluster state, complicate mutation consistency, and retain much larger Host payloads across a trust boundary.

### Refreshes are single-flight with bounded I/O

Each Project has at most one `refreshPromise`. Cold callers await it; warm callers read the current generation. Dirty warm snapshots may be served while one background refresh is running, except an operation that requires read-after-write confirmation waits for the committed generation. Run README parsing uses a configurable bounded worker pool rather than the current sequential loop or unbounded `Promise.all`.

### Discovery respects configured roots and avoids recursive broad globs

Machine-local `include` patterns are the immediate safe control for known Project layouts. The maintained implementation must also preserve general configurations: snapshot refresh may use configured patterns or retained known paths, but it cannot assume every Project uses one fixed directory. The monitor and read store use the same discovery function/config so they cannot disagree about which Runs exist.

### Monitor becomes an invalidation producer, not a second cache

The filesystem monitor keeps its per-Project exponential backoff (`min × factor`, capped at `max`) but sends detected signatures/dirty signals to the snapshot store. It does not own a disconnected payload. On a change, it resets the interval, refreshes/coalesces the snapshot, and publishes events only after the new generation is readable. On failure it retains the prior signatures and snapshot.

### Mutations use write-through or exact dirty marking

After an optimistic-lock mutation commits, simple resource changes update the indexed entry when safe; structural changes mark the Project dirty and await one refresh. Event publication happens after that step. This prevents a successful write followed by a stale read or an event that causes clients to refetch the old generation.

### HTTP remains private and no-store

Backend and central JSON responses remain authenticated `no-store`; browser/proxy caches are not the source of truth. Server-side snapshots are process-local parsed-state caches with filesystem/event invalidation. Optional safe timing data may use aggregate logs, runtime health, or a bounded `Server-Timing` header, but never absolute paths or credentials.

### Existing cache policies remain distinct

- Backend Project snapshot: process lifetime; atomic generations; monitor/mutation invalidation; last-known-good on error.
- Backend monitor: per Project exponential polling; live configuration currently supplies min/max/factor; no read-triggered full scan.
- Browser TanStack Query: default 60-second stale/refetch interval with SSE invalidation; per-feature overrides remain explicit.
- Central Host/Project registry: process memory; metadata/tunnel/events and aggregation update it; it stores only safe summaries.
- Log indexes: per-process in-flight/index map, with filesystem metadata validation where persisted.
- Git status and terminal pane state: short feature-specific TTL/poll intervals; unrelated to Project discovery.
- SSH and daemon backoff: connection/process recovery only; not a data cache.

## Risks / Trade-offs

- [Stale data during quiet-monitor backoff] → Mutations write through immediately, UI attention can request refresh, SSE invalidates browser queries, and the monitor resets after change.
- [NFS burst from cold bounded concurrency] → Cap workers, coalesce refreshes, benchmark metadata pressure, and keep per-Project isolation.
- [Partial candidate snapshot] → Validate the entire candidate and atomically swap; retain last known good on any error.
- [Memory growth from parsed Run bodies] → Record generation size/counts, avoid duplicating generations after swap, and consider summary/detail separation only if measured memory requires it.
- [Overly narrow local include] → Back up configuration, compare excluded matches/README presence/duplicate IDs, and retain the previous config for immediate rollback.

## Migration Plan

1. Record cold/warm stage baselines and response sizes for list, Experiment detail, and Run detail.
2. Back up the machine-local Backend config and narrow include patterns only after verifying excluded matches are not valid Runs; restart and measure the reversible improvement.
3. Implement and test the shared snapshot store, direct indexes, bounded refresh, and safe observability.
4. Connect filesystem monitor and mutations to snapshot invalidation/write-through; run failure and concurrency tests.
5. Run large-Project Backend/central/browser benchmarks and security regression gates.
6. Commit implementation separately, advance the Minor in `release: vMAJOR.MINOR.PATCH`, push the exact revision, and reinstall the Backend.
7. Roll back by activating the prior Backend release and restoring the backed-up local include configuration if correctness or latency regresses.
