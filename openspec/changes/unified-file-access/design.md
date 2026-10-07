## Context

See proposal.md for motivation. The existing projectFs facade routes native direct calls or scheduled SSHFS calls using an async project context. The Store already provides observations, coalescing, attention leases, worker isolation and periodic dumps. Native file handles, direct fs imports, central share validation and derived-index maintenance can bypass that facade; simply adding an HTTP read method would leave agent projects incomplete.

The in-process Backend package remains the domain layer. Existing Run-launch and scheduler proposals describe separate CLI execution; this file agent does not implement their execution backends. Repository constraints require polling, offset-bearing on-disk timestamps, shared optimistic locks, containment and no external database.

## Goals / Non-Goals

**Goals:** Make access transport replaceable without changing domain semantics; make repeated validation bounded and observable; keep the remote protocol independent of business releases; preserve old configurations and native CLI operation.

**Non-Goals:** Host cutover, research-data migration, replication, block synchronization, filesystem event watchers, distributed transactions or a remote command executor. The explicitly rejected synchronization alternative is not part of this design.

## Decisions

### 1. Configuration separates transport and cache policy

Use an operator-only `access` object: `kind: filesystem | sshfs | agent`, `cache: none | memory | memory-disk`, and a configured `source` identity for shared budgets. The supported combinations are filesystem/none, filesystem/memory, sshfs/memory or memory-disk, and agent/memory or memory-disk; remote defaults use memory-disk. Retain SSHFS memory-only for legacy compatibility. Agent entries select an operator-configured connection and remote project ID; they do not pretend a remote path is a central local root.

Normalize legacy storage/local to filesystem/none and sshfs to its existing memory/persistent policy. Reject contradictory old/new settings. Layout remains in .memon/project.yml and execution remains a separate configured provider. New agent-aware services must use logical project identities and relative paths; no fs proxy fallback is allowed in an agent context.

### 2. One conditional operation contract

Adapters implement `read(relativePath, { knownVersion? })`, conditional `list`, `stat`, bounded `readRange`, and explicit mutation primitives. Results distinguish present, unchanged and missing; errors remain errors. File validators are hashes of bytes actually read; directory validators hash normalized sorted entries. Metadata signatures are only cheap hints. This replaces separate check-then-read calls, which add a round trip and a race.

Use HTTP GET/ETag/If-None-Match for agent whole-file reads and equivalent envelopes for batch/list operations. The version is opaque to central. A bodyless result is legal only when central retains matching content or the caller requires only a version comparison. Metadata equality cannot authorize a strong unchanged response, range recombination or conditional write.

Do not introduce stability-probe loops incompatible with the existing Store contract. Agent reads provide versions of observed bytes; atomic replacement produces complete old/new files, but external in-place writes may produce inconsistent observed data. Reconciliation is by later checks and visible parse errors.

### 3. Unified observation state

Key by authenticated source namespace, source identity, project ID, normalized relative path, operation and representation/range parameters. One state holds accepted content where cacheable, version, checkedAt, nextCheckAt, retryAt, error, in-flight work and interest. Content may be evicted independently of identity and version.

SSHFS and agent share the bounded memory-disk implementation. Persist only successful values, validators and original observation times; restore no tasks, listeners, leases or retries. Source identity changes invalidate persisted reuse. Credential changes must reauthorize before cache delivery. Share revocation checks never use ordinary stale-content policy.

Expose central read consistency as `cached`, `revalidate` and `stale-while-revalidate`; defaults retain existing foreground behaviour. Cached answers retain checkedAt. Revalidation can skip reuse timing but must join equivalent work and obey source budgets. A stale result must be marked as such; known central writes invalidate exact file and parent-list dependencies and fence pre-write completions with a generation.

### 4. Timing and source budgets are separate

Every successful check, changed or unchanged, sets nextCheckAt from completion. Changed observations reset the adaptive interval; unchanged checks grow it with factor 2. Generic subscriptions default to 1 s minimum / 5 min maximum; retain legacy configured Wiki/default periods during normalization. Jitter cannot schedule earlier than the minimum. Failure retry uses a separate deadline and never advances checkedAt. Attention affects demand/priority without converting cache hits into source checks.

Use one dispatch scheduler per source group with concurrency admission and token buckets for operations and read bytes. A batch consumes member-operation tokens. Known-size reads reserve estimated bytes and reconcile actual usage; unknown-size content uses bounded streaming with byte admission and a configured maximum body size. Maintain fair per-project queues and a guaranteed background share. Composite walks never hold physical slots while awaiting child work. Blocked syscalls retain capacity until truly complete.

Rate defaults remain explicit operator choices: concurrency retains 10, optional operation/byte caps use 0 for unlimited until configured. This avoids imposing an arbitrary breaking throughput cap while making enforcement configurable and testable.

### 5. Logical subscriptions are central consumers

Provide a small subscribe/unsubscribe convenience over conditional operations. Multiple subscribers use one state and deadline; cancellation removes only that interest. Native uncached ordinary reads remain direct, while explicit subscriptions retain minimal versions/scheduling state without a body cache. Directory discovery is bounded composition of direct-child listings, never an unbounded recursive watch.

Adapt active central project validation and Results/index refresh to the same scheduler; audit the old BackendFilesystemMonitor before changing it because an exported class is not proof of active production use. Keep resource semantic versions independent of file hashes and checks. Browser refresh remains TanStack Query polling rather than new SSE subscriptions.

### 6. Standalone file agent and stable protocol

Create a minimal independently packaged file agent with no dependency on @memon/backend or business parsers. Extract only necessary transport-neutral containment, atomic replacement and writer-lock primitives into a minimal shared package/module. Advertise protocol major 1, source identity and bounded capabilities; baseline includes directory and range access because current logs/media cannot be served by whole-file reads alone.

Use mTLS with project-scoped identity grants; store trust and credential references in ignored operator config. Atomically reload validated TLS/trust/grant configuration through an explicit local control action, not a filesystem watcher. Unauthorized callers fail before I/O. Configured mount identity prevents vanished mounts being interpreted as empty fallback directories. Verify real containment for existing paths and nearest existing parents for creates, and design the source operation boundary to withstand symlink replacement races.

Central never sends an arbitrary root, executable or shell command. Keep protocol major compatibility independent of MEMON_RELEASE; no automatic agent fleet deployment or restart accompanies central release. Git and Slurm continue through explicit execution providers.

### 7. Conditional mutations and replay

Carry expectedMtime + expectedHash or create-if-absent to the source. Serialize validation and atomic replacement under a lock protocol compatible with local memon writers. A hash check followed by rename without shared locking is not compare-and-swap. Audit current writer locks before adopting a protocol; do not claim protection from arbitrary noncooperating editors or jobs.

Use durable bounded request records keyed by authenticated caller/request ID and payload digest, with not-started/pending/completed states and explicit uncertainty after crash. Source capacity and the writer lock are acquired while not-started; pending becomes durable before data effects. Admission failure may retry the same bound ID, and completed replies bypass source admission. A retry joins pending work or replays completion; a conflicting digest fails. For the crash window between filesystem mutation and result journaling, reconcile only when operation-specific evidence is conclusive; otherwise return uncertain and require a central reread, never blindly rerun. No offline central write-back queue. Business multi-file operations retain scoped recovery and partial-failure reporting.

### 8. Audit all file consumers before enabling agent projects

Inventory raw fs calls, realpath checks, share-file access, derived-index writers, atomic temp/rename helpers, log file handles, asset streams and subprocess cwd assumptions. Route them through relative adapter primitives or retain explicitly separate execution providers. In-memory Stats/Dirent compatibility may bridge old callers, but unsupported operations must fail closed. Preserve authorization and optimistic-lock metadata in public DTOs.

### 9. Apply audit findings and accepted compatibility decision

The first apply audit found the following concrete migration boundaries:

| Surface | Current access | Required adapter boundary |
| --- | --- | --- |
| Backend project/document/Run/index readers | Mostly projectFs, but root-oriented domain helpers | Logical source/project authority and relative read/list/stat operations |
| Core Run result writer | Injected mutation fs plus direct nodeFs.realpath and ownership discovery | Adapter containment and source-aware owner discovery; conditional source replacement |
| Derived index | projectFs filesystem port plus root-based paths | Adapter-backed events/snapshots/results and shared validation budget |
| Shares | Central/standalone runtime validates by native project root | Authorized fresh agent share-file access; never ordinary stale grant reuse |
| Log line index | Native createReadStream and local pathname | Bounded range reader and local derived line-index state keyed by source |
| Backend assets | projectFs.open followed by native FileHandle.createReadStream | Adapter byte streaming with range and source-budget accounting |
| Web document assets and thumbnails | Native realpath/stat/createReadStream; local ffmpeg opens a pathname | Adapter-backed bytes/ranges and a separate bounded local media-input strategy; the agent does not execute ffmpeg |
| Executable body components | Explicit project execution context with root-based input paths | Preserve execution-provider separation and translate resource identities without a local mount fallback |
| Git/Slurm | Explicit execution provider | Remain separate; agent never runs commands |
| BackendFilesystemMonitor | Exported native scanner; no central production caller found in targeted search | Verify use sites and adapt if retained; do not assume it drives live freshness |

`readDocumentState` reads bytes/stat, `assertDocumentLock` compares supplied fingerprints, and a later `replaceDocumentAtomic` performs replacement. `writeRunResult` likewise checks an optional expected hash before a later replacement. These are optimistic preflight checks, not a shared cross-process lock around validation and rename. The current source therefore cannot supply the shared writer-lock protocol assumed by decision 7 without changing native memon writer behaviour.

The user selected the recommended shared-lock rollout: new CLI writers and the agent use the same protocol; enabling agent writes requires an operator acknowledgment that project memon writers have been upgraded. Until that acknowledgment, agent access is read-only. Old direct CLI writers cannot be detected reliably by scanning a shared filesystem, so central MUST NOT claim it automatically verified their absence. The independent file-agent lifecycle remains unchanged. The writer-lock format has its own compatibility version and is not coupled to routine business releases. Non-memon direct writers remain outside this guarantee.

The protocol foundation is implemented in the independent `@memon/file-protocol` package with no business-library dependency. Task 1.2 covers executable request/result schemas, binary-safe conditional content and listing validators, range extent validation, mutation preconditions, compatibility and the upgraded-writer enablement guard. This is a contract/helper implementation, not a deployed agent or integrated writer lock. Verification: file-protocol protocol.test.ts 21/21 passed; package build and package typecheck passed; root pnpm typecheck passed; Biome on the new package/root reference passed; strict change validation passed. No full suite, remote tests, release or live deployment was performed.

A temporary-project apply probe demonstrated a second boundary: after the current backend `resolveContained` validates `docs/file.txt`, replacing `docs` with an escaping symlink before the native read redirects the read outside the project. The probe used only disposable neutral fixtures and removed them afterward. Node's current filesystem interface does not expose directory-relative open/rename primitives needed to preserve the stronger source-side race isolation in remote-file-protocol. The user approved retaining race isolation with a native source kernel. Implement the standalone agent in Go using os.Root directory-relative primitives on native platforms (not GOOS=js). os.Root is the source-side equivalent of resolveContained: every request is normalized and every actual open/create/rename stays anchored to the configured authority. A preliminary realpath may resolve legacy in-root absolute symlinks, but the final operation still uses os.Root on a contained relative path. Build with a maintained patched Go toolchain; distribute a standalone binary and keep protocol-v1 independent of central releases. Node CLI writers use the same project-level lock directory format, and the native helper can hold it over a local transaction.

## Risks / Trade-offs

- Strong validation may reread NFS bytes even when no network body is sent -> separate metadata hints, content validation and measured source bytes; never weaken equality silently.
- Adapter conversion is cross-cutting -> mode-parity tests, bypass inventory and staged implementation; no live cutover before agent-backed reads, streams and mutations pass.
- Noncooperating external writers cannot be serialized by a memon lock -> state the guarantee and keep conflict/reconciliation visible.
- Multi-file views are not snapshots -> validate input fingerprints as today and retry through bounded future checks.
- Authentication or source changes can invalidate cache eligibility -> identity-aware keys and authorization before delivery.
- Replay cannot infer every crash outcome -> explicit uncertain status and safe reread rather than an exactly-once claim.

## Migration Plan

1. Introduce normalized configuration and adapter contracts while preserving native/SSHFS behaviour; run parity and legacy-config tests.
2. Add shared observations, conditional reads, budgets and cache persistence with deterministic clocks and temporary projects.
3. Implement independently packaged agent/client, TLS grants, mutation locking/replay and bounded streams; verify using local temporary agent projects.
4. Route every central consumer, background validator and settings/freshness view through the configured adapter; complete rendered-output checks for UI changes.
5. Keep live deployment facts only in LOCAL.md. Actual cluster agent installation and host migration are separate operator rollout actions. Rollback restores the previous central config/release and source mapping; no project file-format migration is required.

### Apply ownership: logical path boundary

Native path operations retain their existing implementations. Explicit `memon-file:/<connection>/<project>` URIs represent logical file authorities and are never passed to native filesystem calls or command cwd. The apply phase owns the following path imports, in addition to its new packages and workspace wiring:

- `packages/core/src/project-file-cache.ts`
- `packages/core/src/project-resource.ts`
- `packages/core/src/atomic-write.ts`
- `packages/core/src/config/path-policy.ts`
- `packages/core/src/config/permissions.ts`
- `packages/core/src/config/load.ts`
- `packages/core/src/config/central-layout.ts`
- `packages/core/src/discovery/deprecation.ts`
- `packages/core/src/discovery/read.ts`
- `packages/core/src/discovery/archive.ts`
- `packages/core/src/discovery/discover.ts`
- `packages/core/src/experiments/discover.ts`
- `packages/core/src/experiments/id.ts`
- `packages/core/src/experiments/rename.ts`
- `packages/core/src/experiments/run-path.ts`
- `packages/core/src/experiments/mutations.ts`
- `packages/core/src/experiments/membership.ts`
- `packages/core/src/experiments/documents.ts`
- `packages/core/src/fs-version/paths.ts`
- `packages/core/src/fs-version/write.ts`
- `packages/core/src/git/command.ts`
- `packages/core/src/git/files.ts`
- `packages/core/src/git/commit-marks.ts`
- `packages/core/src/journal/invocation.ts`
- `packages/core/src/journal/read.ts`
- `packages/core/src/log/cache.ts`
- `packages/core/src/migrations/v3-to-v4.ts`
- `packages/core/src/migrations/v6-to-v7.ts`
- `packages/core/src/migrations/digests-to-wiki.ts`
- `packages/core/src/migrations/v7-to-v8.ts`
- `packages/core/src/migrations/v8-to-v9.ts`
- `packages/core/src/shares/paths.ts`
- `packages/core/src/shares/write.ts`
- `packages/core/src/wiki/discover.ts`
- `packages/core/src/wiki/review.ts`
- `packages/core/src/wiki/staleness.ts`
- `packages/core/src/components/cache.ts`
- `packages/core/src/components/execute.ts`
- `packages/core/src/project-scan/context.ts`
- `packages/core/src/project-scan/scan.ts`
- `packages/core/src/project-scan/resolve-run.ts`
- `packages/core/src/runs/mutations.ts`
- `packages/core/src/project-file-store/containment.ts`
- `packages/core/src/project-file-store/store.ts`
- `packages/core/src/project-file-store/runtime.ts`
- `packages/core/src/project-file-store/persistence.ts`
- `packages/core/src/derived-index/paths.ts`
- `packages/core/src/derived-index/entries.ts`
- `packages/core/src/derived-index/mutation-events.ts`
- `packages/core/src/derived-index/merge.ts`
- `packages/core/src/derived-index/rebuild.ts`
- `packages/core/src/derived-index/validate.ts`
- `packages/core/src/project-declaration/paths.ts`
- `packages/core/src/project-declaration/schema.ts`
- `packages/core/src/project-declaration/lint.ts`
- `packages/core/src/project-declaration/layout.ts`
- `packages/core/src/results/ignore.ts`
- `packages/core/src/results/summary-cache.ts`
- `packages/core/src/results/writer.ts`
- `packages/core/src/results/bundle-lint.ts`
- `packages/core/src/results/schema-upgrade.ts`
- `packages/backend/src/filesystem-monitor.ts`
- `packages/backend/src/execution-service.ts`
- `packages/backend/src/stream-service.ts`
- `packages/backend/src/document-service.ts`
- `packages/backend/src/mutation-service.ts`
- `packages/backend/src/containment.ts`
- `packages/backend/src/run-path.ts`
- `packages/backend/src/request-scope.ts`
- `packages/backend/src/indexed-documents.ts`
- `packages/backend/src/indexed-runs.ts`
- `packages/backend/src/indexed-experiments.ts`
- `packages/backend/src/derived-index-mirror.ts`
- `packages/backend/src/git-service.ts`
- `packages/backend/src/read-index.ts`
- `packages/backend/src/results-summary.ts`
- `packages/backend/src/project-service.ts`
- `apps/web/lib/server/runtime.ts`
- `apps/web/lib/server/runtime-config-path.ts`
- `apps/web/lib/server/experiment-results-views-store.ts`
- `apps/web/lib/server/file-access-settings.ts`
- `apps/web/lib/server/path-safety.ts`
- `apps/web/lib/server/resolve-submodule-cwd.ts`
- `apps/web/lib/server/standalone-dto.ts`
- `apps/web/lib/server/standalone-experiment-mutation-route.ts`
- `apps/web/lib/server/standalone-mutation-refresh.ts`
- `apps/web/lib/server/standalone-resource.ts`
- `apps/web/lib/server/ui-preferences-store.ts`
- `apps/web/lib/server/reports.ts`
- `apps/web/lib/server/runtime/dir-cache.ts`
- `apps/web/lib/server/runtime/wiki-cache.ts`
- `apps/web/lib/server/translation/cache.ts`
- `apps/web/lib/server/translation/codex.ts`
- `apps/web/app/api/hypotheses/route.ts`
- `apps/web/app/api/log-files/route.ts`
- `apps/web/app/api/journal/route.ts`
- `apps/web/app/api/readme/route.ts`
- `apps/web/app/api/code-preview/route.ts`
- `apps/web/app/api/doc-assets/[project]/[...path]/route.ts`

### Apply refinements: file metadata and directory operations

The file protocol includes symlink metadata (`lstat`) and canonical project-relative resolution (`resolve`) because existing containment and discovery callers require them. Ordinary metadata stays separate from content equality. Opaque entry identities support conditional directory rename and unlink without interpreting business documents. The user accepted directory identity checks plus same-authority rename to a quarantine name before central, bounded member-by-member cleanup; no recursive tree content hash or recursive agent RPC is introduced. The user subsequently approved bounded descendant file fingerprint prerequisites to avoid treating directory identity as proof that observed document bytes remain unchanged on coarse-timestamp filesystems. Symlink unlink operates on the entry itself rather than following its final target. A failed cleanup can leave a quarantined directory for explicit recovery, and is never described as one atomic multi-file transaction.

Central contexts now distinguish cached, due-and-fresh, explicit revalidation and stale-while-revalidate policies. Logical interests use one polling channel per authority/path, independent subscriber validators, leases and bounded pending listener delivery. Generic logical polling starts at 1 second and backs off to 5 minutes, with only positive jitter. Uncached native bodies are retained only for a callback dispatch. Source admission uses separate operation and byte buckets, conservative bounded whole-file reservations, project rotation, and a background operation share; it does not replace the successful-observation deadline.

The new source limits are `operationsPerSecond`, `operationBurst`, `bytesPerSecond`, `byteBurst`, `maxReadBytes` and `backgroundShare`; owner settings persist them with existing revision checks. `byteBurst` must cover `maxReadBytes`. CLI update builds the lightweight JavaScript protocol dependency before core/CLI, and backs up its dist for rollback; it never builds, installs or restarts the Go agent.

The live central process was confirmed to run outside the source checkout before rebuilding core dist for integration tests. No production output, running configuration or remote installation has been changed by apply.

### Apply ownership: checkpoint paths

The following paths belong to this change; baseline was clean and no unrelated changes were included. Implementation remains in progress.

- `AGENTS.md`
- `README.md`
- `apps/web/app/api/code-preview/route.ts`
- `apps/web/app/api/doc-assets/[project]/[...path]/route.ts`
- `apps/web/app/api/hypotheses/route.ts`
- `apps/web/app/api/journal/route.ts`
- `apps/web/app/api/log-files/route.ts`
- `apps/web/app/api/readme/route.ts`
- `apps/web/components/file-access-settings-panel.tsx`
- `apps/web/lib/file-access-api.ts`
- `apps/web/lib/server/central/direct-runtime.ts`
- `apps/web/lib/server/experiment-results-views-store.ts`
- `apps/web/lib/server/file-access-settings.test.ts`
- `apps/web/lib/server/file-access-settings.ts`
- `apps/web/lib/server/path-safety.ts`
- `apps/web/lib/server/reports.ts`
- `apps/web/lib/server/resolve-submodule-cwd.ts`
- `apps/web/lib/server/runtime-config-path.ts`
- `apps/web/lib/server/runtime.ts`
- `apps/web/lib/server/runtime/dir-cache.ts`
- `apps/web/lib/server/runtime/wiki-cache.ts`
- `apps/web/lib/server/source-materialization.ts`
- `apps/web/lib/server/standalone-dto.ts`
- `apps/web/lib/server/standalone-experiment-mutation-route.ts`
- `apps/web/lib/server/standalone-mutation-refresh.ts`
- `apps/web/lib/server/standalone-resource.ts`
- `apps/web/lib/server/translation/cache.ts`
- `apps/web/lib/server/translation/codex.ts`
- `apps/web/lib/server/ui-preferences-store.ts`
- `apps/web/package.json`
- `apps/web/test/browser/file-access-settings-panel.test.tsx`
- `config.example.yml`
- `openspec/changes/unified-file-access/.openspec.yaml`
- `openspec/changes/unified-file-access/design.md`
- `openspec/changes/unified-file-access/proposal.md`
- `openspec/changes/unified-file-access/specs/central-cluster-routing/spec.md`
- `openspec/changes/unified-file-access/specs/cluster-backend-lifecycle/spec.md`
- `openspec/changes/unified-file-access/specs/file-access-settings/spec.md`
- `openspec/changes/unified-file-access/specs/file-operation-scheduler/spec.md`
- `openspec/changes/unified-file-access/specs/project-file-store/spec.md`
- `openspec/changes/unified-file-access/specs/remote-file-protocol/spec.md`
- `openspec/changes/unified-file-access/specs/runtime-cache/spec.md`
- `openspec/changes/unified-file-access/tasks.md`
- `package.json`
- `packages/backend/package.json`
- `packages/backend/src/containment.ts`
- `packages/backend/src/derived-index-mirror.ts`
- `packages/backend/src/document-service.ts`
- `packages/backend/src/execution-service.ts`
- `packages/backend/src/file-access-errors.test.ts`
- `packages/backend/src/filesystem-monitor.ts`
- `packages/backend/src/git-service.ts`
- `packages/backend/src/http/errors.ts`
- `packages/backend/src/indexed-documents.ts`
- `packages/backend/src/indexed-experiments.ts`
- `packages/backend/src/indexed-runs.ts`
- `packages/backend/src/mutation-service.ts`
- `packages/backend/src/project-service.ts`
- `packages/backend/src/read-index.ts`
- `packages/backend/src/request-scope.ts`
- `packages/backend/src/results-summary.ts`
- `packages/backend/src/run-path.ts`
- `packages/backend/src/stream-service.ts`
- `packages/backend/tsconfig.json`
- `packages/cli/src/commands/update.test.ts`
- `packages/cli/src/commands/update.ts`
- `packages/cli/src/lib/invocation.ts`
- `packages/core/package.json`
- `packages/core/src/atomic-write.ts`
- `packages/core/src/backend-protocol.ts`
- `packages/core/src/components/cache.ts`
- `packages/core/src/components/execute.ts`
- `packages/core/src/config/central-layout.ts`
- `packages/core/src/config/file-access.test.ts`
- `packages/core/src/config/load.ts`
- `packages/core/src/config/path-policy.ts`
- `packages/core/src/config/permissions.ts`
- `packages/core/src/derived-index/entries.ts`
- `packages/core/src/derived-index/merge.ts`
- `packages/core/src/derived-index/mutation-events.ts`
- `packages/core/src/derived-index/paths.ts`
- `packages/core/src/derived-index/rebuild.ts`
- `packages/core/src/derived-index/validate.ts`
- `packages/core/src/discovery/archive.ts`
- `packages/core/src/discovery/deprecation.ts`
- `packages/core/src/discovery/discover.ts`
- `packages/core/src/discovery/read.ts`
- `packages/core/src/experiments/discover.ts`
- `packages/core/src/experiments/documents.ts`
- `packages/core/src/experiments/id.ts`
- `packages/core/src/experiments/membership.ts`
- `packages/core/src/experiments/mutations.ts`
- `packages/core/src/experiments/rename.ts`
- `packages/core/src/experiments/run-path.ts`
- `packages/core/src/file-writer-lock.test.ts`
- `packages/core/src/file-writer-lock.ts`
- `packages/core/src/fs-version/paths.ts`
- `packages/core/src/fs-version/write.ts`
- `packages/core/src/git/command.ts`
- `packages/core/src/git/commit-marks.ts`
- `packages/core/src/git/files.ts`
- `packages/core/src/index.ts`
- `packages/core/src/journal/append.ts`
- `packages/core/src/journal/invocation.ts`
- `packages/core/src/journal/read.ts`
- `packages/core/src/log/cache.ts`
- `packages/core/src/log/line-index.ts`
- `packages/core/src/migrations/digests-to-wiki.ts`
- `packages/core/src/migrations/v3-to-v4.ts`
- `packages/core/src/migrations/v6-to-v7.ts`
- `packages/core/src/migrations/v7-to-v8.ts`
- `packages/core/src/migrations/v8-to-v9.ts`
- `packages/core/src/mount-table.ts`
- `packages/core/src/project-declaration/layout.ts`
- `packages/core/src/project-declaration/lint.ts`
- `packages/core/src/project-declaration/paths.ts`
- `packages/core/src/project-declaration/schema.ts`
- `packages/core/src/project-file-cache.ts`
- `packages/core/src/project-file-context.ts`
- `packages/core/src/project-file-store.scheduling.test.ts`
- `packages/core/src/project-file-store/agent-adapters.ts`
- `packages/core/src/project-file-store/agent-handle.ts`
- `packages/core/src/project-file-store/agent-integration.test.ts`
- `packages/core/src/project-file-store/agent-mutations.ts`
- `packages/core/src/project-file-store/budgets.test.ts`
- `packages/core/src/project-file-store/budgets.ts`
- `packages/core/src/project-file-store/conditional.ts`
- `packages/core/src/project-file-store/containment.ts`
- `packages/core/src/project-file-store/contract.ts`
- `packages/core/src/project-file-store/fs-facade.ts`
- `packages/core/src/project-file-store/index.ts`
- `packages/core/src/project-file-store/metrics.ts`
- `packages/core/src/project-file-store/persistence.ts`
- `packages/core/src/project-file-store/runtime.ts`
- `packages/core/src/project-file-store/scheduler.ts`
- `packages/core/src/project-file-store/source-budget-runtime.ts`
- `packages/core/src/project-file-store/state.ts`
- `packages/core/src/project-file-store/store.ts`
- `packages/core/src/project-file-store/subscriptions.test.ts`
- `packages/core/src/project-file-store/subscriptions.ts`
- `packages/core/src/project-io.ts`
- `packages/core/src/project-resource.ts`
- `packages/core/src/project-scan/context.ts`
- `packages/core/src/project-scan/resolve-run.ts`
- `packages/core/src/project-scan/scan.ts`
- `packages/core/src/results/bundle-lint.ts`
- `packages/core/src/results/ignore.ts`
- `packages/core/src/results/schema-upgrade.ts`
- `packages/core/src/results/summary-cache.ts`
- `packages/core/src/results/writer.ts`
- `packages/core/src/runs/mutations.ts`
- `packages/core/src/schemas.ts`
- `packages/core/src/shares/paths.ts`
- `packages/core/src/shares/read.ts`
- `packages/core/src/shares/write.ts`
- `packages/core/src/types.ts`
- `packages/core/src/wiki/discover.ts`
- `packages/core/src/wiki/review.ts`
- `packages/core/src/wiki/staleness.ts`
- `packages/core/tsconfig.json`
- `packages/file-agent/README.md`
- `packages/file-agent/cmd/memon-file-agent/main.go`
- `packages/file-agent/go.mod`
- `packages/file-agent/internal/agent/admission.go`
- `packages/file-agent/internal/agent/admission_test.go`
- `packages/file-agent/internal/agent/files.go`
- `packages/file-agent/internal/agent/files_test.go`
- `packages/file-agent/internal/agent/replay.go`
- `packages/file-agent/internal/agent/replay_test.go`
- `packages/file-agent/internal/agent/server.go`
- `packages/file-agent/internal/agent/server_test.go`
- `packages/file-agent/package.json`
- `packages/file-protocol/package.json`
- `packages/file-protocol/src/client.test.ts`
- `packages/file-protocol/src/client.ts`
- `packages/file-protocol/src/index.ts`
- `packages/file-protocol/src/paths.test.ts`
- `packages/file-protocol/src/paths.ts`
- `packages/file-protocol/src/protocol.test.ts`
- `packages/file-protocol/tsconfig.build.json`
- `packages/file-protocol/tsconfig.json`
- `packages/file-protocol/vitest.config.ts`
- `packages/test-utils/native/tls-fixture/main.go`
- `packages/test-utils/src/file-agent.ts`
- `packages/test-utils/src/index.ts`
- `packages/test-utils/src/tls.ts`
- `pnpm-lock.yaml`
- `scripts/go-package.mjs`
- `tsconfig.json`

### Accepted compatibility decision: one primitive access layer

The user approved unifying the legacy unqualified entry as well, and explicitly
requested that both entries use the new primitives. Host is an optional namespace,
not a selector for file access or cache semantics. Preserve unqualified URLs and
legacy response projections while composing their services inside the same
project contexts, conditional observations, source budgets and writer locks as
host-qualified requests. All four transports work without a host field. Remove
legacy startup scans and independent parsed caches/polling from active requests;
resolve legacy resource IDs on demand, rejecting ambiguous matches. Share checks
remain fresh and execution remains a separate provider. No synthetic host is
required in operator configuration or exposed to legacy clients.

Implementation and integration verification remain in progress; no apply
completion, release or archive is claimed.

The checkpoint includes real source tests for bodyless conditional replies,
remapped-source rejection before mutation, Node/Go competing writers, durable
replay after a process crash, bounded range transport, namespace separation and
central logical interests. Source replay payloads include the authenticated
principal and expected authority. Agent credential/policy reloads reuse unchanged
anchored roots so revocation does not re-open project storage. Central credential
failures discard their client instance for the next authorized attempt, allowing
operator credential replacement without coupling it to business releases.

Latest selected verification: file protocol/client/path (30 cases before the latest
compatibility/error-brand refinements); native Go kernel with race detection;
core config (89 cases), file store/scheduling (35 cases), budgets/interests (6 cases),
real-agent facade and cross-process lock (8 cases); backend project/document/
mutation/stream/Results/index (68 cases), source error mapping (12 cases); Web
settings/direct runtime (27 cases), settings component (5 cases), document assets
(9 cases). These are development subsets, not a full gate. The isolated worker's
range/body-limit switch needed synchronization with the parent executor; the
subsequent asset tests passed after rebuilding core. Rendered UI preview, broader
integration checks and remaining tasks are still outstanding.

### Unqualified request adapter ownership

The approved entry unification also owns these exact request adapters and helpers:

- `apps/web/app/api/runs/route.ts`
- `apps/web/app/api/runs/[id]/route.ts`
- `apps/web/app/api/runs/[id]/archive/route.ts`
- `apps/web/app/api/runs/[id]/files/route.ts`
- `apps/web/app/api/runs/[id]/readme/route.ts`
- `apps/web/app/api/runs/[id]/status/route.ts`
- `apps/web/app/api/runs/[id]/warnings/route.ts`
- `apps/web/app/api/runs/[id]/warnings/[rowId]/route.ts`
- `apps/web/app/api/experiments/route.ts`
- `apps/web/app/api/experiments/[id]/route.ts`
- `apps/web/app/api/experiments/[id]/archive/route.ts`
- `apps/web/app/api/experiments/[id]/link/route.ts`
- `apps/web/app/api/experiments/[id]/readme/route.ts`
- `apps/web/app/api/experiments/[id]/status/route.ts`
- `apps/web/app/api/experiments/[id]/unlink/route.ts`
- `apps/web/app/api/experiments/[id]/warnings/route.ts`
- `apps/web/app/api/experiments/[id]/results/route.ts`
- `apps/web/app/api/experiments/[id]/warnings/[rowId]/route.ts`
- `apps/web/app/api/readme/route.ts`
- `apps/web/app/api/log-files/route.ts`
- `apps/web/app/api/log/route.ts`
- `apps/web/app/api/log/stream/route.ts`
- `apps/web/app/api/code-preview/route.ts`
- `apps/web/app/api/hypotheses/route.ts`
- `apps/web/app/api/journal/route.ts`
- `apps/web/app/api/journal/history/route.ts`
- `apps/web/app/api/anomalies/route.ts`
- `apps/web/app/api/reports/route.ts`
- `apps/web/app/api/reports/[id]/route.ts`
- `apps/web/app/api/code-reviews/route.ts`
- `apps/web/app/api/code-reviews/[...id]/route.ts`
- `apps/web/app/api/wiki/route.ts`
- `apps/web/app/api/wiki/[id]/route.ts`
- `apps/web/app/api/wiki/review/route.ts`
- `apps/web/app/api/wiki/backlinks/[artifact]/route.ts`
- `apps/web/app/api/wiki/review/[sha]/route.ts`
- `apps/web/lib/server/standalone-request.ts`
- `apps/web/lib/server/standalone-request-context.ts`
- `apps/web/lib/server/standalone-services.ts`
- `apps/web/lib/server/standalone-target.ts`
- `apps/web/lib/server/standalone-error.ts`
- `apps/web/lib/server/standalone-file-access.test.ts`
- `apps/web/lib/server/data.ts`
- `apps/web/lib/server/auth/project-resolver.ts`
- `apps/web/lib/server/auth/project-resolver.test.ts`
- `apps/web/middleware.ts`

### Accepted refinement: guarded directory operations

Directory rename requests may include `fileChecks`, at most 32 normalized descendant paths with expected mtime and SHA-1/SHA-256 hashes. Central forwards previously observed file fingerprints when moving or quarantining a directory. The source checks every prerequisite under the common writer lock before any directory mutation, with combined prerequisite reads bounded by maxBodyBytes. This protects those observed files, not unobserved descendants or a recursive snapshot. Central refuses excessive prerequisites rather than dropping them. A successful rename remaps scoped fingerprints to the destination so bounded cleanup preserves them. The optional `directory-guards-v1` capability gates guarded operations; a compatible older source still serves baseline reads, but there is no unguarded fallback. Replay payload binding includes the prerequisites automatically.

This refinement owns `packages/file-protocol/src/index.ts`, `client.ts`, `protocol.test.ts`, `client.test.ts`; `packages/file-agent/internal/agent/files.go`, `files_test.go`, `server.go`; `packages/core/src/project-file-store/agent-mutations.ts`, `agent-integration.test.ts`; and `packages/file-agent/README.md`, in addition to existing change ownership.

### Execution adapter continuation

Unqualified Slurm status now uses the first explicitly configured execution provider in its namespace, matching qualified service composition. The opt-in startup probe runs through the configured provider instead of probing the central machine unconditionally. With no execution target, enabled Slurm fails explicitly; the default disabled configuration performs no probe. The agent carries no command RPC. Additional owned paths: `apps/web/lib/server/slurm/probe.ts`, `apps/web/lib/server/slurm/probe.test.ts`.

Budget deferrals are counted once per delayed demand in the same bounded 1/5/15-minute metrics windows, separated into operation and byte limits. Unknown source hashing on bodyless agent replies and guarded mutations uses conservative maxReadBytes accounting; transport metrics continue counting the actual received response body bytes separately. Additional owned test path: `packages/core/src/project-file-store/metrics.test.ts`.

The memory-only cache lifetime regression now asserts that focus preserves a valid reuse interval, while explicit manual refresh obtains current bytes. This aligns the pre-existing test with the reviewed timing contract. Additional owned path: `packages/core/src/project-file-cache.test.ts`.

Compatibility normalization permits both namespace families in one configuration and unqualified entries in an explicit central role. Execution defaults remain local for ordinary native unqualified projects, and never for agent/explicit SSHFS projects. Active derived-index validation explicitly revalidates through the shared Store so persisted remote TTLs cannot extend its bounded validation window; the optional legacy Backend monitor scanner also uses scoped primitives. Additional owned test: `packages/core/src/project-file-store/transport-parity.test.ts` (real local/agent and simulated SSHFS mount identity; no real SSH mount claim).

Central discovery propagates transport and non-absence filesystem failures instead of producing an empty inventory. Native CLI discovery outside a central context retains its lenient behavior. Additional owned paths: `packages/core/src/project-file-store/errors.ts` and `packages/core/src/project-file-store/discovery-errors.test.ts`; existing Run/Wiki/Experiment discovery adapters are included in original ownership.

Guard verification also owns `packages/file-agent/internal/agent/replay_test.go`. SDK integration simulates losing an already committed create response and verifies the identical retry succeeds through replay rather than repeating the create. Configuration tests remove the obsolete rejection of explicit central unqualified entries, matching the approved optional-namespace decision; `packages/core/src/config/load.test.ts` is now owned.

Dedicated unqualified README routes now use the same ambiguity-safe target resolver and source error projection as other entries. The legacy optional caller hash contract remains unchanged; primitive source CAS still requires both mtime and hash, and current editors send both. Additional owned paths: `apps/web/lib/server/standalone-readme-route.ts`, `apps/web/lib/server/standalone-readme-route.test.ts`.

Budget admission waits inside an agent adapter contribute to queue latency rather than transport execution latency. Pending automatic budget demand follows a shared task's foreground promotion; already charged background bytes are refunded according to admission origin, independently of later priority changes. Deterministic tests cover promotion and nested waiting, and a blocked native read proves successful reuse deadlines start at completion.

Raw bounded source reads now contribute samples and application-byte metrics, while a scheduled adapter call is not counted twice. Conservative source hashing admission is distinct from returned application bytes and received transport body bytes. Tests cover all three distinctions and version retention after body eviction.

Central native writer-lock acquisition and release now use scoped asynchronous file primitives, avoiding unbudgeted mount access or synchronous lock removal on the Web event loop. CLI-only exit cleanup retains its synchronous release contract. A concurrency-one nested central write verifies the lock does not hold a worker slot over the transaction.

Whole-file replacement now calls the agent's atomic replace primitive directly, avoiding a central temp-upload/readback/rename sequence; explicit unsupported fsync fails rather than being ignored. Native central atomic replacement and derived-index event/compaction writers join the common writer lock, including background publications. Derived-index failures propagate before removals are published, and its persisted timestamps use writer-local offsets. Source lease recovery uses exclusive file create instead of a hard-link RPC. Additional owned paths: `packages/core/src/derived-index/events.ts`, `packages/core/src/derived-index/compact.ts`, `packages/backend/src/derived-index-mirror.test.ts`.

Compatibility refinements preserve the source's original permission bits on direct atomic replacement and translate exclusive-create conflicts to fs-compatible EEXIST in the central facade. Empty optional guard arrays are omitted for baseline older agents. A real-agent derived-index rebuild/compaction test exercises control-file writes and exclusive creation without a native fallback.

### Verification checkpoint: guarded primitives and unified entries

Protocol/client/path tests: 34 passed, including omitted empty extensions for baseline agents, unsupported guarded operations, committed reply loss and replay binding. Native Go kernel tests passed with race detection. Core selected checks cover 91 configuration cases, observations/scheduling/budget timing, body eviction and six subscription cases, raw metrics without double counting, native/Go writer contention, directory prerequisites and real-agent index rebuild/compaction. Backend project/document/mutation/stream/Results/index/error/Slurm checks passed in development subsets; dedicated unqualified README checks now include ambiguity and source outage. CLI project/update/invocation: 42 passed. Root typecheck passed before the final integration refinements and will be rerun.

A private isolated production build and authenticated Chromium preview verified the File access UI at 1440px and 390px, no overflow or browser exceptions, and the actually served background/foreground/card/muted/primary oklch tokens. It is a development preview, not a released revision. A mistakenly started checkout build was stopped immediately; the production listener was confirmed to use a separate frozen release directory and remained untouched.

Four logical mode parity tests use native filesystem I/O and a real agent; SSHFS uses an injected mount identity. Real SSH/FUSE link acceptance remains pending: the development environment has no /dev/fuse. The user explicitly deferred real SSHFS mount acceptance until platform migration; fixture coverage does not complete that acceptance. No release, archive or live migration is claimed. Remaining central integration checks and current-code validation continue independently of that decision.

Source-group normalization also owns `packages/core/src/config/source-group.ts`: explicit access.source and legacy storage_group select the same budget group and conflicting labels are rejected. New access declarations default to an opaque root/authority identity, not a reusable project name; qualified legacy defaults include their namespace. This prevents equal project names on unrelated sources from sharing a blocked budget accidentally, while explicit labels join projects on one physical source.

Writer-lock ownership, source-admission timing, backend summary indexes and active index mirrors share process-global carriers across the Node entrypoint and independently bundled Web routes. This preserves nested lock reentrancy and prevents duplicate validation loops or telemetry after entry unification.

Central service entry scopes validate local agent credential changes even when the summary index could answer without file I/O. A new credential is verified through the capability handshake, without backing-file I/O, before cached projections become eligible; unchanged credentials reuse their established client and incur no extra source request. This closes a warm-domain-cache bypass without turning ordinary cached reads into network authorization polls.

The permitted backend summary cache also fences source/credential namespaces, and invalidation discards holders so an old pending parse cannot reinstall pre-write data into a fresh index. An authorization handshake is distinct from file freshness and never advances a restored body's checkedAt.

Namespace/invalidation fencing additionally owns `packages/backend/src/read-index.test.ts`. Warm summaries check changed credentials before answering, and a controlled pending-parse test proves older work cannot replace a post-invalidation observation while unchanged retained values can still reuse stat fingerprints.

### Accepted refinement: stable streamed reads

The user approved bounded expiring read-only handles. The optional `read-handles-v1` capability provides open-read, read-at and close-read primitives retaining one opened regular file, with metadata from that same descriptor. Handles are opaque, principal/project/source-bound, capped at 256 per process and expire after five minutes of inactivity. Each read checks current authentication, grants and source identity/availability and participates in physical admission; close/expiry cannot release ongoing physical work early. Expiry and restart fail explicitly rather than reopen the pathname. Lease state is never persisted. Compatible older agents retain baseline reads and dynamic ranges; stable handle consumers refuse the missing capability. Cached native/SSHFS workers retain equivalent bounded descriptors in their isolated process. Atomic pathname replacement leaves a download on the complete old file; arbitrary in-place writes remain outside snapshot guarantees. Log polling opens fresh handles for each observation rather than retaining a download lease indefinitely. An opaque dev/inode fileId avoids unsafe JSON inode precision and distinguishes replacement from ordinary append; local rebuildable line-index cache records retain that identity and reject mismatched legacy records.

Additional owned paths: file protocol index/client and tests; file agent server/files and new read-handles.go/read-handles_test.go; core project-io.ts/project-io-child.ts/project-io.test.ts, Store/facade/agent-handle, log/line-index.ts and integration tests; backend stream service/http streaming and tests; Web document/report/wiki assets, document asset route tests, standalone service scoping and source-materialization. Stable response metadata must describe the opened file. Real SSHFS mounting remains a distinct incomplete acceptance task until migration.

Latest checks after namespace/authorization refinements: backend read-index/mirror 26 passed; Web resource/dedicated README/direct/unqualified entry 38 passed; core agent/parity/metrics/subscription 23 passed. Earlier independent selected checks remain applicable where their files were unchanged: config 92, core observations/cache/I/O/atomic/index/writer/budget suite 128, backend services/error/Slurm suite 83, Web settings/assets/Wiki/auth/component suite 79, CLI project/update/invocation 42, protocol/client/path 34 and native Go race tests. Counts overlap and are not summed into a full-suite claim. Root typecheck and strict OpenSpec validation passed. No commit, release or archive has been performed.


### Verification checkpoint: accepted stable handles

Task 4.1 now has native/real-agent qualified and unqualified service coverage, including document mutations, fresh authorization, ambiguity, warm index authority fencing and outage projection. Task 4.2 retains one descriptor per streamed read in the native worker or independent Go source, obtains response metadata from that descriptor, closes metadata-only responses, materializes bounded media inputs from the same handle, and uses fresh handles for log observations. Opaque dev/inode identities preserve large inode precision without confusing append with rotation. Physical reads retain admission while close or expiry retires a lease; unknown, expired, closed or restarted leases never reopen a pathname. Agent handle limits are advertised independently of central budgets.

Final selected test list for this continuation:

- `packages/file-protocol/src/{protocol,client,paths}.test.ts`: 35 passed, including atomic replacement with a changed file length, closed-handle refusal, old-agent capability refusal and grant revocation after opening.
- `packages/file-agent/internal/agent`: native Go race tests passed, including 256 actual descriptor leases, limit refusal, capacity reuse after close, principal/project/source bindings, expiry/restart and deferred retirement during an active read.
- `packages/core/src/project-io.test.ts`, `log/{line-index,cache}.test.ts`, `project-file-store/{agent-integration,transport-parity,metrics,budgets,subscriptions}.test.ts`: 61 passed across 8 files. Real agent and cached native worker streams preserve old-file bytes across replacement; log append and rotation remain distinct; lease expiry never reopens a pathname.
- `packages/backend/src/{stream-service,read-index,derived-index-mirror,file-access-errors}.test.ts`: 44 passed across 4 files, including opened-file response metadata and complete old-file contents after replacement.
- Web `app/api/doc-assets/[project]/[...path]/route.test.ts`, report/wiki asset route tests, `lib/server/{standalone-file-access,standalone-readme-route}.test.ts`, `lib/server/central/direct-runtime.test.ts`, `lib/resource-protocol.test.ts`: 54 passed across 7 files, including binary response length/content continuity and HEAD/304/416 handle cleanup paths.
- Root `pnpm typecheck`, strict OpenSpec validation and `git diff --check`: passed. No full-suite gate is claimed.

Task 5.2 covers temporary native uncached, native memory, real-agent and injected SSHFS mount identity fixtures for conditional traffic, cache restart, conflicts, replay and outage metrics. Actual SSH/FUSE acceptance is separately tracked as task 5.4 and remains unchecked by explicit user instruction until platform migration. Apply remains active at 20/21 tasks; this is not full acceptance or an archived change. No commit, release, central deployment or real project migration is claimed by this checkpoint.
