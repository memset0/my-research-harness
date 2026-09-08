# Historical implementation record

This is the pre-closeout checklist, including superseded designs and unchecked verification. It is retained as evidence, not the final delivered contract. No unchecked item is retrospectively asserted to have passed.

## Transfer to central file access

The unfinished items below are transferred to `centralize-project-file-access`; unchecked boxes remain historical evidence, not claims of completed verification. Do not continue the old remote-Backend cache design or archive it after the centralization change without rebasing its deltas.

| Old task | Disposition and replacement |
| --- | --- |
| 2.4 | Retained goal; primitive Store metrics replace domain snapshot observability (new tasks 2.7, 6.2). |
| 3.1 | Superseded mechanism; shared per-operation scheduler replaces the Backend monitor (2.5, 5.2). |
| 3.2 | Retained write coherence; exact cache invalidation replaces Backend event publication (3.7). |
| 3.3 | Retained external-change/error behavior; verified through primitive states and frontend polling (8.1, 8.3). |
| 4.1 | Retained latency visibility; physical I/O and queue metrics replace proxy-stage instrumentation (2.7, 8.2). |
| 4.2 | Retained query isolation; unified heartbeat and semantic versions replace SSE (5.1–5.5). |
| 4.3 | Superseded no-central-cache/gateway budget; central owns primitive content cache, authorization remains required (2.1, 4.2). |
| 5.1 | Retained representative performance proof through focused cold/warm I/O scenarios, not another permanent benchmark suite (8.2). |
| 5.2 | Retained development-side focused checks and browser proof; no remote suites (8.1, 8.4, 8.5). |
| 5.4 | Replaced by isolated candidate measurements and prepared rollback; public cutover requires later user approval (8.2, 8.6). |

Completed authentication/share fixes remain required behavior. Completed remote snapshots/compression describe the old deployed service, not a requirement to retain that architecture in the candidate.

## 1. Baseline and Reversible Configuration Optimization

- [x] 1.1 Measure repeated central and direct-Backend list, Experiment detail, and Run detail TTFB/total/bytes/cache headers; record evidence separating gateway overhead from Backend work.
- [x] 1.2 Time Run discovery, Run parsing, Experiment discovery, and membership independently on the large live Project; verify the dominant stage and compare broad versus constrained include patterns without changing data.
- [x] 1.3 Back up the owner-only Backend config, apply the verified machine-local include patterns, restart the candidate Backend, and verify excluded matches have no README/no unique valid Run while list/detail latency improves and rollback restores the prior config.
- [x] 1.4 Inventory every active cache/backoff layer with owner, key, lifetime, freshness trigger, invalidation trigger, and failure behavior; verify the maintained design and runtime evidence agree.
- [x] 1.5 Enable compression on the gateway-owned SSH forward after plain/compressed live comparison, restart central, and verify large JSON transfer time improves without changing response bytes or tunnel isolation.

## 2. Shared Backend Project Snapshot

- [x] 2.1 Implement a framework-neutral per-Project snapshot store containing Runs, Experiments, ID indexes, membership, hypotheses, journal, anomalies, generation metadata, and safe timing/count diagnostics; verify atomic generation tests.
- [x] 2.2 Implement single-flight cold/dirty refresh with bounded Run-read concurrency and last-known-good retention; verify concurrent callers cause one refresh and failures never publish partial state.
- [x] 2.3 Migrate all Project list/detail/results/files/hypotheses/journal/anomaly reads to the snapshot store and direct indexes; verify warm requests invoke no recursive discovery or unrelated parsing.
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
- [x] 5.3 Commit implementation changes separately, advance the Backend/CLI Minor in a `release: vMAJOR.MINOR.PATCH` commit, push the exact revision, reinstall the Backend, and verify release/revision/digest/readiness.
- [ ] 5.4 Re-run live cold/warm measurements after deployment, compare with the baseline, observe cache freshness and NFS load, and retain a tested prior-release/config rollback.

## 6. Central Share and Browser Authentication Repair

- [x] 6.1 Route central share CRUD through the composed Next handler, keep Host selection exact, and return the canonical `/share/<host>/<project>/<token>` public URL with useful Backend error propagation.
- [x] 6.2 Make share create/revoke depend on the dedicated `shares` capability and remain available when Project-data `mutations` are disabled; retain owner-only actor authorization and exact Backend validation.
- [x] 6.3 Remove `WWW-Authenticate` from browser-facing 401 responses while retaining preemptive Basic credential acceptance, and prevent anonymous login pages from opening the global SSE connection.
- [x] 6.4 Add focused Backend, central bridge, share route, middleware/auth, and event-subscription regressions; run affected package tests, Web/Backend typecheck, OpenSpec validation, synthetic central e2e, and a production build.
