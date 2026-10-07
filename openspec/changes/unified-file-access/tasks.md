## 1. Adapter and compatibility inventory

- [x] 1.1 Audit central project-file consumers, native filesystem bypasses, file handles, derived-index access, share validation and current writer locking; record the adapter migration map and actual atomicity boundaries in design.md; verify every central surface has a mapped path and no unexplained agent fallback remains.
- [x] 1.2 Define transport-neutral conditional file/list, metadata, range and mutation contracts plus version/error schemas in a minimal dependency boundary; verify present/unchanged/missing/error, same-size edits, directory membership and version/content correspondence tests.
- [x] 1.3 Add access/cache/source configuration normalization and agent connection mapping; verify all four modes, legacy defaults, contradictory declarations, read-only policy and no operator endpoint exposure with configuration tests.

## 2. Shared observations and scheduling

- [x] 2.1 Introduce adapter-backed native and SSHFS operations with one observation state, optional knownVersion and central cached/revalidate/stale-while-revalidate policies; verify different callers' versions, content eviction, byte equality and existing facade compatibility.
- [x] 2.2 Separate successful reuse deadlines, adaptive backoff and failure retry state; verify completion-based timing, changed-read reuse, unchanged doubling, minimum-respecting jitter, manual revalidation, old-generation fencing and honest checkedAt using the shared test clock.
- [x] 2.3 Extend source scheduling with project fairness, operation/byte token budgets, bounded batch member accounting and unknown-length read admission; verify limits, non-starvation, independent healthy sources and physical capacity retained after caller timeout.
- [x] 2.4 Add central logical subscriptions with shared observations, cancellation/lease expiry and bounded directory composition; verify multiple subscribers cause one check, cancellation preserves other interests, uncached native bodies are not retained and no filesystem watcher is introduced.
- [x] 2.5 Generalize bounded memory-disk persistence for SSHFS and agent identity namespaces; verify equal tiered-cache behaviour, memory-only NFS, corrupt dumps, changed source/authority, original check times and no persisted runtime tasks.

## 3. Independent file agent

- [x] 3.1 Add an independently packaged protocol-v1 agent/client with capabilities and mTLS project grants, trust reload and source identity; verify trusted/untrusted/read-only/revoked clients and compatibility with an older baseline agent without central-release coupling.
- [x] 3.2 Implement contained conditional file/list, metadata, bounded range and batch operations with mount-unavailable handling and independent server limits; verify bodyless unchanged replies, same-mtime edits, symlink escape/races, missing versus unavailable, log truncation and oversized requests.
- [x] 3.3 Implement shared source-side writer locking and atomic conditional replacement/create/delete/rename, integrating cooperating native memon writers and requiring explicit per-project upgraded-writer acknowledgment before enabling agent writes; verify two-process conflicts, create races, mode preservation, temp cleanup and explicit noncooperating-writer limitations. Add bounded descendant mtime/hash prerequisites for directory rename and quarantine deletion; verify same-mtime child conflicts, aggregate byte/count limits, containment, replay binding and explicit refusal when an older agent lacks the optional capability.
- [x] 3.4 Add bounded durable request replay and uncertain-crash handling; verify lost response retry, conflicting payload IDs, concurrent duplicates, restart retention, crash after mutation and no unsafe repeated delete/rename.

## 4. Central integration

- [x] 4.1 Route both host-qualified and legacy unqualified project services and all document/result/share/index readers and writers through the new primitives and logical adapter authorities, remove active legacy warmup/cache/polling dependencies and preserve unqualified URLs/DTOs without requiring host; verify temporary agent-backed project parity with native/SSHFS and fail-closed unsupported operations without a fake local root.
- [x] 4.2 Replace native-handle assumptions for logs/assets with bounded range/stream operations and retain separate execution providers for Git/Slurm; implement bounded expiring read-only source/worker handles and opened-file metadata; verify atomic-replacement continuity, expiry, close, principal binding, truncation, binary fidelity, abort/capacity accounting, unavailable execution and project containment.
- [x] 4.3 Connect active background discovery, index validation and Results refresh to shared observations and budgets; verify foreground overlap causes no duplicate check, bounded scan work, external changes become visible and errors never synthesize deletions.
- [x] 4.4 Update effective/pending file-access settings, scheduled-source metrics and freshness DTOs for new policies and budgets; verify owner authorization, conflict-safe config save, no endpoint/credential leaks and original freshness on cached answers.
- [x] 4.5 Update file-access settings and footer rendering; verify component/query-key tests, Web typecheck and AGENTS.md F1 rendered markup/CSS plus desktop/mobile preview without touching live build output.

## 5. Documentation and integration verification

- [x] 5.1 Update generic configuration examples, README and AGENTS.md architecture boundaries with independent agent install/protocol/credential lifecycle and unchanged CLI-only updates; verify neutral examples and no obsolete claim that all local paths bypass caching.
- [x] 5.2 Run temporary end-to-end projects in native uncached, native memory-cached and agent modes, plus injected SSHFS mount-identity coverage, including cached restart, unchanged conditional traffic, mutation conflict, idempotent retry and source outage; verify observed bytes, request/source-work counts and no filesystem convention change.
- [x] 5.3 Run the change-relevant test list (adapter/contracts/config, Store observations/scheduling/persistence, agent auth/containment/mutations/replay, backend project/share/index/stream, Web settings/freshness) and pnpm typecheck; report exact files/cases and results, and validate this change strictly.

- [ ] 5.4 Verify an actual SSHFS mount after platform migration, including restart/cache reuse, unchanged traffic, atomic-replacement streaming, outage/recovery and source-work accounting. Current machine has no FUSE device; explicitly deferred by the user and not satisfied by injected mount fixtures.
