## 1. Baseline and Reversible Configuration Optimization

- [x] 1.1 Measure repeated central and direct-Backend list, Experiment detail, and Run detail TTFB/total/bytes/cache headers; record evidence separating gateway overhead from Backend work.
- [x] 1.2 Time Run discovery, Run parsing, Experiment discovery, and membership independently on the large live Project; verify the dominant stage and compare broad versus constrained include patterns without changing data.
- [ ] 1.3 Back up the owner-only Backend config, apply the verified machine-local include patterns, restart the candidate Backend, and verify excluded matches have no README/no unique valid Run while list/detail latency improves and rollback restores the prior config.
- [ ] 1.4 Inventory every active cache/backoff layer with owner, key, lifetime, freshness trigger, invalidation trigger, and failure behavior; verify the maintained design and runtime evidence agree.
- [ ] 1.5 Enable compression on the gateway-owned SSH forward after plain/compressed live comparison, restart central, and verify large JSON transfer time improves without changing response bytes or tunnel isolation.

## 2. Shared Backend Project Snapshot

- [ ] 2.1 Implement a framework-neutral per-Project snapshot store containing Runs, Experiments, ID indexes, membership, hypotheses, journal, anomalies, generation metadata, and safe timing/count diagnostics; verify atomic generation tests.
- [ ] 2.2 Implement single-flight cold/dirty refresh with bounded Run-read concurrency and last-known-good retention; verify concurrent callers cause one refresh and failures never publish partial state.
- [ ] 2.3 Migrate all Project list/detail/results/files/hypotheses/journal/anomaly reads to the snapshot store and direct indexes; verify warm requests invoke no recursive discovery or unrelated parsing.
- [ ] 2.4 Add memory/count/refresh/hit/coalescing observability without paths or secrets; verify redaction and bounded diagnostic tests.

## 3. Freshness, Mutation, and Event Integration

- [ ] 3.1 Change the filesystem monitor to invalidate/refresh the shared store using the configured per-Project exponential backoff; verify quiet backoff, change reset, Project isolation, and no disconnected second payload.
- [ ] 3.2 Connect successful mutations to exact write-through or dirty refresh before event publication; verify read-after-write coherence, optimistic conflicts, and one Host-qualified event.
- [ ] 3.3 Verify external Run/Experiment/document additions, changes, and deletions atomically advance the owning generation while transient NFS failures retain last-known-good data.

## 4. Central and Browser Behavior

- [ ] 4.1 Add safe end-to-end stage timing for Backend service, central proxy, transfer, and browser rendering; verify it distinguishes cache hit, cold refresh, coalesced refresh, and stale serving.
- [ ] 4.2 Audit public response shapes and TanStack Query keys/stale/refetch/SSE invalidation so multiple observers share type-compatible cached values; verify navigation does not duplicate large requests or render stale cross-Host data.
- [ ] 4.3 Verify central retains no Project body cache, authenticated JSON remains `no-store`, and the gateway adds less than the specified warm p95 budget without weakening header/token boundaries.

## 5. Performance Gates and Release

- [ ] 5.1 Add a large-Project benchmark fixture covering cold/warm list, Experiment detail, Run detail, concurrent refresh, and bounded memory/file descriptors; verify the spec latency budgets.
- [ ] 5.2 Run core/backend/CLI/Web typecheck, lint, focused security tests, snapshot/event/mutation integration tests, and production desktop/mobile browser checks; fix all in-scope failures.
- [ ] 5.3 Commit implementation changes separately, advance the Backend/CLI Minor in a `release: vMAJOR.MINOR.PATCH` commit, push the exact revision, reinstall the Backend, and verify release/revision/digest/readiness.
- [ ] 5.4 Re-run live cold/warm measurements after deployment, compare with the baseline, observe cache freshness and NFS load, and retain a tested prior-release/config rollback.
