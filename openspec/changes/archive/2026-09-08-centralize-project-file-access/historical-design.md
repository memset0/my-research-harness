# Historical design

Superseded by design.md and the accepted proposal; retained for provenance, not as active architecture.

## Context

See proposal.md for the deployment motivation. Current Run discovery defaults to `**/*` in `packages/core/src/discovery/discover.ts`; Backend monitor and standalone runtime call it. Several mutation and rename paths call `scanProjectRoot` without forwarding configured include/exclude values. Backend project reads already use a warm domain snapshot, but documents and other callers maintain independent paths. Wiki bundle discovery also enumerates/stat-checks attachments even when only page content is needed. Existing live updates combine SSE with query timers and Results-specific refresh.

The operator guarantees a manageable directory structure above Run directories. Runs never contain other Runs. This design accepts that premise rather than imposing separate Run roots, walk depth caps, or discovery budgets. It explicitly permits the Run walk and prohibits other general recursive project discovery.

## Goals / Non-Goals

**Goals:** one central filesystem authority, predictable SSHFS I/O, immediate warm-cache rendering, eventual externally edited content visibility, configurable scheduling with honest freshness and queue metrics, and independent remote CLI/skills updates.

**Non-Goals:** CLI-to-central cache notifications; persistent queues, waiters, leases or runtime metrics; a second domain-object cache; proactive document/list push; Run body automatic refresh; SSHFS mount automation; pre/post-read stability checks; cross-file snapshot transactions; per-peer test/deployment gates.

## Decisions

### 1. Central deployment and stable identity

Central accepts project roots from the selected local configuration. Roots may be ordinary directories or arbitrary SSHFS mount paths; no `mounted/` test or special mount location exists in code. Preserve the current `{host, project}` namespace and public routes/share scopes to avoid bundling identity migration with storage migration. A host becomes a configured namespace and optional execution target, not an upstream memon service. Project-only local mode keeps its existing identity. A project resolves to exactly one root; no fallback or broadcast.

Each project configuration carries an optional `host` namespace alongside `name` and `root`. Initial implementation used an isolated candidate. The user subsequently authorized promotion and deployment of this persistent-cache/list-latency fix to the primary site. Preserve the old host/config as rollback material; stop the current host before replacing its production build output.

Retire Backend HTTP tokens, upstream proxying, event fan-in, negotiation, daemon commands, and remote Backend distribution. Extract reusable document/mutation/domain logic before removing its old hosting boundary. Central read-only policy replaces Backend access-mode enforcement. Preserve the dedicated share-administration permission separately from project-data writes; an OS read-only mount can still prevent share-file writes and must return a real error.

Existing Git, Slurm, and other retained command capabilities remain explicit
execution-provider operations: local commands for local projects, or a
configured SSH target plus remote root for remote projects. Do not run Git or
remote process commands against a mounted cwd. Preserve pinned host-key checks
and owner-only mutation access; use explicit argv/argument-safe commands and
exact target resolution. Streaming logs and assets retain bounded byte/range
transport and are not whole-file domain caches. These transports do not
restore document-update SSE.

### 2. Primitive Store

Expose `readFile(project, relativePath, requestContext)` and `listDir(project, relativePath, requestContext)` for project document access. Keys include exact project/root generation, normalized relative path, operation and any byte-range variant. Authorize before cache lookup; enforce assertWithinProjectRoots and symlink containment at the filesystem boundary. Cached data must not bypass viewer scope or project read-only policy.

Each entry stores the last successful result, observed mtime/size when available, result/content version, successful completion time, current check state/error and scheduling state. File outcomes distinguish bytes (including zero bytes) and missing. Directory outcomes distinguish direct entries (including an empty array) and missing. Never translate EACCES, transport errors or an unavailable mount into empty/missing. Do not stat every enumerated child simply to fill metadata; unknown attributes remain unknown until needed.

Content is cached only after an actual read, with bounded memory LRU eviction. Explicit project `persistent_cache: true` plus an actual SSHFS mount makes completed persistable observations eligible for the local dump configured by `file_cache.dump_path`; local projects never enter the dump. Startup loads and validates the bounded dump without scanning project files, retaining every observation's original successful timestamp and namespace derived from the configured root plus backing mount identity. A single writer asynchronously writes a temporary file and atomically renames it at `dump_interval_seconds` (default 30), so the dump may lag the last completed observation by one interval. A corrupt, incompatible or invalid dump fails safely as an empty cache. LRU values and the dump contain no queues, active tasks, Promises, waiters, attention leases, failure/retry state or metrics. Eviction does not imply deletion of the underlying project path. Protect and Git-ignore the local dump.

Physical stat/realpath/metadata checks remain private adapter operations, subject to the same I/O scheduler and metrics. A cache hit performs no disk work by itself. Metadata can avoid unnecessary content reads, but mtime-only equality is not an eternal guarantee: when a content validation is due, read content according to the configured policy; do not permanently miss same-metadata replacements. Do not add pre/post-read comparison or immediate consistency retry loops. Accept each successful read; later polling corrects concurrent edits. A malformed document is an explicit projection error; the browser may retain its last successfully rendered content with an error state.

Successful central writes keep existing mtime/hash optimistic locking and invalidate or update exact affected entries and parent listings. In-flight reads started before a known central write may not overwrite its newer cache state; use a per-entry mutation generation. This prevents known central write races without adding read-stability probes for external writers.

### 3. Composite Run walk and finite document rules

Run discovery starts only at logs/, outputs/, and experiments/ directly beneath the configured project root, skipping missing entries without enumerating the project root. It composes Store listDir calls at arbitrary depth within those entries, retains excludes/include matching, and stops at recognized Run directories regardless of README presence. No directory symlinks are followed, including entry symlinks. The composition has no independent cache, holds no scheduler slot while awaiting children, and uses no recursive filesystem API.

Directories consulted by the walk become its dependencies. Re-running the composition over cached lists is allowed; only due/missing entries incur physical I/O. Changed lists alter the dependency set. Read known Run READMEs separately for list metadata; list refresh must not replace an open Run body.

Experiment, Wiki, Report, Digest and code-review rules enumerate their canonical finite directory levels and read explicit document files. Wiki attachments are read/listed only for actual asset/component needs, not recursively walked to show a page. New/deleted documents are discovered as a consequence of scheduled listDir result changes, not another scanner.

Experiment lists and sidebar navigation use only experiment-owned documents and dates. They omit Run counts and member rosters rather than returning fake empty members. They do not call the Run walk, global membership composition, or automatic anomaly discovery. Detail displays the declared `frontMatter.runs` IDs without resolving member documents; opening a Run explicitly resolves and reads only that Run, with missing and reciprocal-membership errors visible. Folded panels do not mount Run readers, and prior expansion is not restored automatically. Wiki identity inventories likewise use directory entries; evidence metadata is loaded only for cited targets and the members needed to derive a cited Experiment's source freshness. Heavy detail prefetch and eager shell metadata queries must not defeat these boundaries.

### 4. Shared queue, priorities and time

One logical task per operation key is pending or in flight. Automatic and human callers share its eventual result. A human caller promotes an existing pending automatic task instead of creating another task. Later automatic callers join it. At dispatch, check the latest cache/generation: if another completion already satisfies the request, reuse it; otherwise perform the operation now. Do not requeue a stale task at the tail merely because it waited. Abandoned automatic work can be removed when no lease/maintenance need remains.

Default maximum is 10 actual operations per configured storage group, shared across its projects. Global defaults apply; optional group overrides isolate unrelated mounts. Human demand precedes automatic work; age automatic tasks to avoid permanent starvation. Cache hits and composite walks use no slots. Queue entries store enqueuedAt, executionStartedAt, completedAt and an attention generation. Success timestamp is completedAt, not enqueuedAt. Wait latency is executionStartedAt minus enqueuedAt; execution latency is completedAt minus executionStartedAt. Monotonic clocks measure durations.

Memory-only projects retain automatic exponential backoff and human attention resets. Opted-in SSHFS observations use configurable Wiki/default periods, initially 30 seconds and 30 minutes: open/focus/expand serve valid cache without forcing a remote check, while expired observations can be revalidated in the background. Manual refresh forces scoped verification and joins equivalent work; known writes invalidate/update exact paths. Heartbeats do not bypass either period. A newer manual reset cannot be undone by an older completion.

Collection requests are always automatic, regardless of whether they supply a sidebar, tab count, main-content list, or document link resolution. Browser GET/HEAD reasons and the server request context enforce the same resource-path policy; callers cannot promote a collection by sending a manual header. Mixed detail reads run inventory/discovery/source preparation in an automatic child context, retaining the original context for the selected document's containment and content reads. Writes retain their forced-fresh context. Manual verification remains cached-first: it schedules a priority check, not a synchronous cache-bypassing response.

Faults retain successful content/timestamps and use bounded retry backoff. A timeout does not imply canceled physical work or released capacity. The measured main-process libuv starvation from SSHFS requires isolating physical project filesystem work from local Web/settings/dump I/O while retaining Store-owned concurrency, in-memory task coalescing and bounded queues. Local settings and healthy groups must remain responsive with blocked SSHFS operations; no replacement-operation storm is allowed.

### 5. Domain projection and frontend polling

Resource descriptors identify an exact project, resource kind/id and requested surface. Separate framework-neutral dependency resolution and file-to-domain transformation from React page layout. Keep only dependency/version bookkeeping, not cached domain payloads. If dependency versions have not changed, reuse the resource version; otherwise recompute a stable fingerprint of the visible domain output (excluding transport/check metadata). An underlying file change can leave the domain output unchanged.

A resource query includes resource descriptors, known semantic versions, an opaque tab/page attention id and reason (`open`, `focus`, `manual`, `heartbeat`). Return per-resource changed/data-or-unchanged, semantic version, observation generation, oldestVerifiedAt, incomplete/queued/checking/error state. An epoch invalidates version assumptions after restart. Authorize every descriptor; status reveals only authorized dependencies. Project roots and secrets never enter browser DTOs.

On initial request, project available primitive cache content immediately; unknown dependencies require cold reads. Foreground visible-and-focused pages send one non-overlapping heartbeat request for their current resource set. Open/focus triggers attention immediately, hydration and browser focus events coalesce. No cancel-attention request exists. Each heartbeat renews a lease, expired leases release high-frequency interest, and other tabs retain their own interest. Responses do not wait for scheduled SSHFS checks when cached data can answer. Frontend polls learn subsequent updates; no document/list EventSource remains.

Manual/focus pulses select document queries only; collections remain eligible for the completion-relative automatic heartbeat and explicit mutation invalidation. Opening a page may still mount its collection queries, but those requests remain automatic. The independent approximately 10-second Git-status polling is unchanged. This classification change adds no intermediate projection/result cache and changes no primitive-cache TTL, heartbeat interval, scheduler concurrency, or worker-pool size.

Reports, Wiki detail/list/components, Experiment README and implementation/investigation/results YAML, Run lists, hypotheses/journal and related metadata views use this protocol. Remove Results-only timers. Run README body loads initially and manually only, including after focus; Run list dependencies remain automatically checked. Preserve scroll/expansion/table UI state and unsaved editors. Display one small update toast for a genuinely changed rendered resource batch, not initial load, unchanged checks or status-only changes. Ignore out-of-order responses and responses for previous page attention ids.

### 6. Initial scheduling configuration

| Setting | Default |
| --- | --- |
| foreground heartbeat | 30 seconds after the preceding batch settles |
| attention lease | 90 seconds |
| active file check base / cap | 5 / 30 seconds |
| active listDir base / cap | 15 / 60 seconds |
| unobserved known-operation maintenance base / cap | 300 / 900 seconds |
| unchanged multiplier | 2 |
| failure retry base / cap | 15 / 300 seconds |
| storage-group concurrency | 10 |
| LRU dump interval | 30 seconds |

The next heartbeat timer starts only after every request in the preceding batch settles, on success or failure. Focus and manual callers join an in-flight batch; a new manual batch replaces the pending timer. Hidden/unfocused pages stop scheduling. Lease duration must be at least three heartbeat intervals; heartbeat and active-file base are independent. A lease does not force every underlying operation to run at heartbeat frequency. No separate fast-poll timer is added. Quiet files can therefore take the backoff interval plus the next heartbeat to appear updated; opening/focusing resets and prioritizes memory-only checks while valid persistent observations retain their TTL. These are tunable initial values, not a claimed remote disk freshness bound. SSHFS attribute/content caching must be measured alongside application checks.

### 7. Footer and settings

Reuse the existing footer and typography/theme. Left: oldest successful observation across all dependencies of the currently displayed resources, plus queued/checking/failed/incomplete state. Right: existing Git/release information. Empty/missing successful results count; unknown dependencies make freshness incomplete. A response must not claim freshness from a newer cache generation than the displayed data unless unchanged content has been verified. Say 'oldest check ... ago', not a guaranteed maximum remote disk age. Mount caches and outages prevent that stronger guarantee.

Add an owner-only File access settings surface using existing shadcn compositions. Present effective and saved pending values for concurrency, heartbeat/lease, memory-only file/list maintenance/backoff, and persistent SSHFS Wiki/default periods. Dump path, dump interval and per-project opt-in remain operator-configured and are not exposed to browsers. Validate positive finite values and relationships; preserve unrelated YAML, comments, dump configuration and secrets under a revision guard and atomic save.

Save does not restart or hot-apply. An explicit restart invokes only a machine-configured adapter, never browser-supplied commands. UI reconnects and verifies the effective settings/instance epoch. Restart clears queues, active tasks, Promises, waiters, leases, failures/retry scheduling and metrics; it startup-loads only bounded completed observations from the validated dump with their original observed timestamps.

Metrics use bounded in-memory rolling aggregates with 1/5/15 minute windows (default 5), sample counts, mean/p95 execution and queue wait, in-flight/queued counts, oldest waiting age, errors, cache hits, coalesced callers, and read bytes. Split automatic/human origin and retain promotion accounting without double-counting one physical operation. Report read bytes as application bytes, not network bandwidth. Settings/metrics access causes no project disk checks.

### 8. Release simplification

Central build/test/release/deployment stays at the development/release side. Remote devices have CLI and skills only and independently invoke `memon update`: fetch/pull the configured trusted published source using fast-forward-only semantics, install required dependencies, build/install CLI and update bundled skills through the existing installation rules. Do not build the Web frontend, start a Backend, run unit tests, lint/typecheck suites, or per-peer deployment gates there. Report the selected source revision and action errors, but do not require central's SHA or negotiate runtime versions with central. Dirty/divergent source is an actionable refusal, never reset/stash user work. Preserve a usable previous installation when update fails; do not overwrite user-authored skills outside the existing managed-skill boundary.

Major remains FS convention aligned; CLI/skills distributed-artifact changes use Minor and Web-only changes use Patch. FS compatibility checks remain because independent CLI revisions still operate on the same files. No fleet coordination or peer test step belongs in central release completion. Update the repository release instructions during apply to remove obsolete lockstep requirements. This proposal does not itself release or update any node.

### 9. Existing change integration and canonical reconciliation

`optimize-central-backend-read-performance` has shipped snapshot/compression/auth/share changes and unchecked follow-up tasks. This change replaces remote snapshot ownership, central-no-content-cache, Backend event integration, and fleet deployment work. Carry forward correctness and latency goals into primitive-cache/heartbeat acceptance, not a second domain cache. Preserve the shipped sharing/Basic-auth behavior. Audit its remaining task evidence and annotate transferred/superseded work during apply; do not simply check all boxes or archive it here.

`wiki-system` retains its schema, CLI, viewer, components, review and source semantics. Its Backend transport, parsed-cache and SSE additions must rebase to central file access/heartbeat polling before archival. Do not overwrite its concurrently edited files during proposal authoring. During apply reconcile its runtime-cache/cluster API deltas with this change; no archive may reintroduce Backend services or SSE by merging an older delta later.

Canonical removal deltas explicitly retire superseded Backend hosting
contracts. Public security, document schemas, scoped identity, remote execution
behavior, and streaming byte behavior are relocated rather than silently
dropped. Adjacent Slurm/Git specifications that mention the retired transport
must be reconciled without changing their product semantics.

## Risks / Trade-offs

- SSHFS can return cached metadata/content or hang. Footer represents observations, not guaranteed remote truth; keep errors separate from missing, and verify disconnect behavior and actual I/O counts.
- Reads during external writes may yield transient malformed content. This is accepted; later polling repairs it without read-stability probes or cross-file transactions.
- Run discovery can enumerate ordinary directories only beneath logs/, outputs/, and experiments/. Their contents still determine discovery cost, but unrelated project trees cannot contribute directory work.
- Domain projections may repeat CPU work across requests. No second payload cache is introduced without later measured need; unchanged dependency vectors avoid repeated fingerprints.
- Identity retention deliberately leaves host-qualified URLs while removing host service discovery. This is a namespace choice, not a compatibility Backend shim.
- First-ever uncached access still requires remote reads. A restart can serve previously dumped SSHFS observations with their original age, not a fabricated fresh timestamp. The dump may lag the last completed observation by one interval, and remote failure cannot turn cached content into empty data.

## Migration and verification

The immediate deliverable is the user-authorized primary-site persistence/list-latency fix, not a fleet acceptance campaign. Run focused local correctness/security checks and minimal changed-surface browser smoke verification after integration. Do not run remote node suites. Simulate destructive/fault cases with disposable fixtures rather than disconnecting existing mounts or modifying real research files. Retain the previous host/config for rollback.

Implement behind a private candidate using neutral fixtures first. Migrate every direct document/list read and composite caller, including mutation lookups, to the Store; retain native command execution through explicit providers. Validate missing/empty/error transitions, priority coalescing, backoff resets, write conflicts and cache races, heartbeat expiry, semantic unchanged responses, and Run no-descent behavior. Run controlled mounted-project read experiments only after the new bounded scheduler is in place, not the legacy continuously scanning server. Measure actual list/read/stat counts, application bytes, queue wait and operation latency alongside warm render times. Verify footer, settings, focus/background transitions and manual-only Run body in a real browser at desktop/mobile widths.

Cutover preserves a single public writer: candidate reads first, then quiesce old writes, switch central config/ingress, verify reads/writes/shares and execution providers, and only then retire old Backend services. Keep the prior installation/config as rollback material; do not require remote CLI revision alignment. Configuration migration and rollback instructions use placeholders; concrete operations remain in LOCAL.md. Archive and release execution are separate from proposal authoring.
