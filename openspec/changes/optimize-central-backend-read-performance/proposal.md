## Why

Central Project pages and individual Run/Experiment detail requests remain multi-second on large NFS-backed Projects even though the authenticated SSH/gateway hop adds only a small fraction of the latency. The Backend currently performs full recursive Run discovery and reparses the whole Project for every read, while its exponential-backoff filesystem monitor maintains a separate snapshot that the read service cannot reuse.

## What Changes

- Add stage-level latency and cache observability for Project discovery, parsing, membership, serialization, proxying, transfer, and browser rendering without exposing paths or credentials.
- Replace per-request full Project scans with one bounded in-memory Project snapshot shared by list, detail, results, files, hypotheses, journal, and anomaly reads.
- Feed external filesystem monitoring and successful mutations into exact snapshot invalidation/refresh, preserving last-known-good data during transient NFS failures.
- Add direct ID indexes and portable-resource lookups so Run and Experiment detail requests do not scan unrelated resources.
- Bound cold refresh concurrency and collapse concurrent refreshes for the same Project into one in-flight operation.
- Define explicit freshness, stale-serving, browser query, central registry, log-index, Git, terminal, and reconnect backoff policies so “cache” and “polling” no longer refer to unrelated mechanisms.
- Support machine-local Project include patterns as an immediate, reversible way to avoid scanning unrelated tree regions while the shared snapshot is rolled out.
- Add large-Project benchmarks and production browser checks with latency budgets for cold and warm list/detail navigation.

## Capabilities

### New Capabilities

- `project-read-performance`: Defines cached Project snapshots, exact invalidation, request coalescing, observability, and latency budgets for Backend reads through central.

### Modified Capabilities

- `cluster-backend-api`: Project read routes use the shared snapshot and ID indexes instead of triggering independent full scans.
- `live-updates`: Filesystem and mutation events refresh/invalidate the same data served by reads while retaining last-known-good state on transient failure.

## Impact

- Affects Backend Project discovery/read services, filesystem monitor integration, mutation publication, central proxy timing, browser query policies, and machine-local Project include configuration.
- Does not change Host-qualified identity, Backend token boundaries, public route shapes, filesystem convention v6, or the loopback SSH transport.
- Backend/CLI artifact changes require a Minor release and exact-revision reinstall under the established release policy.
