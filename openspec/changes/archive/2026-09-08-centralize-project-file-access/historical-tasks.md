# Historical implementation record

This is the pre-closeout checklist, including superseded designs and unchecked verification. It is retained as evidence, not the final delivered contract. No unchecked item is retrospectively asserted to have passed.

## 1. Contract reconciliation and local configuration

- [x] 1.1 Map the remaining performance-change tasks to retained, completed-with-evidence, or superseded work; reconcile its Backend snapshot and rollout assumptions with this change without auto-archiving it. Verify every unchecked old task has an explicit disposition.
- [x] 1.2 Reconcile the active Wiki change's runtime cache, Backend and SSE deltas with central file access while preserving its file schema, components, CLI and human review behavior. Verify archive order cannot restore the removed architecture.
- [ ] 1.3 Add central project-root/storage-group configuration and explicit optional local/SSH execution context while preserving existing public namespace identity. Verify arbitrary mount paths, duplicate identities, local-only examples and absent execution-provider behavior.
- [ ] 1.4 Define typed primitive results, resource descriptors, semantic versions, attention reasons and status response contracts; verify public validation rejects raw root/target authority and preserves project authorization.

## 2. Primitive file Store and scheduler

- [x] 2.1 Implement readFile/listDir caching with present/empty/missing outcomes, on-demand content, bounded memory LRU eviction and completion-time freshness; add opt-in startup/periodic local dumps exclusively for actual SSHFS observations, preserving original timestamps and Wiki/default TTLs of 30/1800 seconds.
- [ ] 2.2 Route internal metadata/path checks through the same physical-I/O accounting and retain assertWithinProjectRoots/symlink safety; verify cached cross-project access is denied and warm access does not issue unconditional stat calls.
- [x] 2.3 Implement one shared pending/in-flight task per equivalent operation, human priority promotion and dispatch-time cache re-evaluation; verify automatic/human waiters receive one result and no stale task endlessly requeues.
- [ ] 2.4 Enforce configurable default-10 storage-group concurrency across projects, bounded queues and automatic-task fairness; verify composite operations hold no slots and cannot deadlock child operations.
- [x] 2.5 Retain memory-only project backoff and implement persistent SSHFS TTL scheduling: normal open/focus does not bypass valid TTL, manual refresh forces a coalesced check, and late completions cannot undo newer explicit resets.
- [ ] 2.6 Implement failure backoff and retain successful state without treating timeouts as canceled physical work; verify an unavailable group does not block cached responses or healthy-group requests.
- [x] 2.7 Add bounded memory metrics for human/automatic/promoted tasks, queue/execution latency and read/list/metadata counts; verify single-operation accounting, time windows and absence of telemetry-triggered project I/O.
- [x] 2.8 Keep every queue, in-flight task, Promise, waiter, attention lease, failure/retry record and metric out of LRU values and dumps; verify restart loads only bounded completed observations with original timestamps and starts with empty runtime scheduling state.
- [ ] 2.9 Isolate physical project filesystem work from the Web process's local filesystem pool; verify blocked SSHFS does not stall settings, local assets or healthy storage groups.

## 3. Domain adapters and Run walk

- [ ] 3.1 Extract file-to-domain transformations and dependency tracking from Web page and Backend service composition, without a second long-lived payload cache; verify equivalent source changes produce unchanged semantic resource versions.
- [x] 3.2 Replace Run glob discovery with the sole composite listDir walk rooted only at project logs/, outputs/, and experiments/, skipping absent entries and retaining exclusions; verify arbitrary depth inside those entries, no unrelated traversal, missing README, no Run descent, and warm listing reuse.
- [x] 3.3 Migrate Experiment canonical files and Run membership/detail projections to Store dependencies. Experiment lists/sidebar omit Run counts and rosters and perform no implicit Run walk, anomaly query or heavy detail prefetch; detail lists declared member IDs, resolving a Run's content only when explicitly opened.
- [ ] 3.4 Migrate Wiki, Report, Digest and code-review discovery/content to finite listDir/readFile rules; verify first document creation, bundle entry updates and no eager recursive attachment enumeration.
- [ ] 3.5 Migrate hypotheses, journal, anomalies, component data dependencies and SSR/API fetchers to the same Store; verify cache reuse between surfaces and explicit parsing-error behavior without immediate stability-retry loops.
- [ ] 3.6 Replace mutation/rename/ID lookup paths that call scanProjectRoot with cached dependency composition and direct known-path resolution; verify a single-resource edit does not trigger uncached whole-project read work.
- [ ] 3.7 Preserve optimistic write locking and update/invalidate exact cache entries and affected parent listings; verify stale in-flight pre-write reads cannot overwrite successful central changes and external edits recover on later polling.

## 4. Central service cutover and retained capabilities

- [ ] 4.1 Serve project reads/mutations directly from configured roots and remove required Backend proxy, probe, tokens, event fan-in and runtime negotiation paths; verify central serves mounted/local projects without a remote memon service.
- [ ] 4.2 Preserve owner/viewer scope, read-only data policy and dedicated share administration; verify existing share identities, revocation, unavailable-authority failure and no browser Basic-auth challenge regressions.
- [ ] 4.3 Adapt existing Git, Slurm and other retained execution operations to explicit local/SSH providers with correct remote cwd and safe argument/host-key handling; verify mounted file paths are never used as remote command paths or silent local fallbacks.
- [ ] 4.4 Retire the browser terminal stack and its Backend relay, session mapping, forwarding, process management, configuration, and UI surfaces without replacement; verify no active route, runtime capability, dependency, or documentation advertises it.
- [ ] 4.5 Keep large log/asset transport bounded and range-aware rather than buffering complete files in the document cache; verify disconnect handling and existing log-viewer behavior without reintroducing document SSE.

## 5. Frontend attention and polling

- [ ] 5.1 Implement authenticated resource queries with changed/unchanged semantic versions, dependency freshness, queue/errors and runtime epoch; verify version checks over warm entries do not force physical I/O and status-only changes omit content updates.
- [ ] 5.2 Add one visible-and-focused page heartbeat lifecycle with a default 30-second delay after the preceding batch settles and 90-second leases, no cancel message, and explicit human open/focus/manual reasons; verify failure recovery, no accumulated batches, hidden/crashed tab expiry and independently shared dependencies across tabs.
- [ ] 5.3 Migrate Experiment documents/tables, Wiki, Reports, Run lists and other metadata pages to the shared lifecycle; remove Results-specific timers and document/list EventSource subscriptions, verifying actual browser request behavior.
- [ ] 5.4 Keep Run README initial/manual loading separate from list/parent invalidation and focus events; verify status-list updates leave the open body unchanged until manual refresh.
- [ ] 5.5 Implement cached-first rendering, semantic update toasts and stale-response protection while preserving scroll, expanded panels, table choices and unsaved edits; verify initial/unchanged/status-only responses cause no content-update notification.

## 6. Footer and settings panel

- [ ] 6.1 Move existing Git/version footer information right and add page-scoped oldest successful observation plus queued/checking/error/incomplete state on the left; visually verify mixed-age dependencies, missing outcomes and mobile layout.
- [ ] 6.2 Add owner-only settings and bounded recent metrics views using existing shadcn primitives; verify mean/p95 queue/execution latency, source breakdown, sample counts and application-byte labeling without secret exposure.
- [x] 6.3 Implement validated comment-preserving local config updates with revision conflict handling and distinct effective/pending values, including Wiki/default persistent cache periods; verify save preserves the operator-configured dump path and interval plus unrelated config without hot-applying or restarting.
- [ ] 6.4 Add explicit configured-adapter restart, unsupported-adapter guidance and post-reconnect effective-value confirmation; verify owner authorization, no browser-supplied command execution and cold memory state after restart.

## 7. CLI distribution and release policy

- [ ] 7.1 Remove remote Backend daemon/service/token/update command surfaces and required Backend packaging while retaining central serve and independent CLI/skills; verify CLI operations work with central unavailable and no memon listener.
- [ ] 7.2 Implement memon update using latest trusted published source with fast-forward-only pull, required CLI install/build and managed-skill refresh; exercise clean, dirty/divergent and failed-install cases in a local throwaway upstream/installation, verifying previous usability and unmanaged skill preservation.
- [ ] 7.3 Remove fleet-SHA equality, Backend negotiation and peer test/deployment gates from release tooling and instructions; verify MAJOR/FS, CLI-artifact MINOR and Web-only PATCH rules remain intact and a remote update neither builds Web nor runs test/lint/typecheck suites.
- [ ] 7.4 Update configuration examples, architecture/user docs and affected Slurm/Git/stream specification references to the central ownership model; verify no real deployment facts enter tracked files and no obsolete Backend requirement survives the cutover.

## 8. Integration and acceptance evidence

Acceptance scope was narrowed by the user: run change-relevant local checks and necessary builds, then verify HTTP readiness. The user subsequently approved promotion and explicitly requested implementation and deployment of the SSHFS persistence/list-latency fix on the primary site. Visual checks cover only changed surfaces. Do not routinely inspect unchanged pages or run a real-project performance/failure matrix; simulate faults in disposable fixtures. Unexercised scenarios are not claimed as passed.

- [ ] 8.1 Run focused development-side regression coverage for negative-cache transitions, coalescing/priority, attention expiry/backoff, semantic versions, write conflicts, project isolation and Run walk; fix broken contract tests and remove obsolete implementation-pinning expectations.
- [x] 8.2 Exercise cache reuse and queue priority on neutral fixtures; record the observed operation counts and queue latency. Real-project performance matrices are not a candidate-delivery gate under the revised acceptance scope.
- [x] 8.3 Confirm known path/read-only/failure-state fixes with focused local checks. Do not unmount real projects or run the broader external-edit/failure-recovery matrix for candidate delivery.
- [x] 8.4 Run affected builds/typechecks and focused correctness/security checks once on the development machine after integration; do not repeat project-wide suites or run remote-node tests. Verify the OpenSpec change validates.
- [x] 8.5 Visually check only the new footer and File access settings on desktop and narrow viewports. Do not routinely browser-test unchanged pages; reproduce additional frontend problems when reported.
- [x] 8.6 Deliver the separately configured read-only mounted-project candidate with host-qualified projects and a documented single-writer cutover/rollback procedure. Verify the live service, ingress and configuration remain untouched; do not execute production cutover until the user approves it.

Candidate verification evidence under the revised scope:
- `packages/core/src/project-file-store.test.ts`: 12 passed.
- `apps/web/lib/resource-protocol.test.ts`: 11 passed.
- `apps/web/lib/server/file-access-settings.test.ts`: 16 passed.
- Local smoke: symlink/lexical escape and read-only rejection; warm/negative cache states; Run walk stops at Runs; queue priority order `b,a` with 3 physical reads and 2 coalesced waiters (queue mean 57.656ms, p95 128ms).
- Local smoke: observation/key-order-only changes return 304, a domain metric named `hash` changing returns a new version; navigation rotates attention and ignores late prior-page freshness; refresh failure preserves content and successful observation time with a code-only error.
- Core and final Web production builds passed, including Web type validation. OpenSpec strict validation passed.
- The new settings panel and footer were visually checked at desktop and 390px widths; the observed fleet-only project-layout 404 was fixed and the layout rendered after rebuilding.
- Candidate HTTP health returned 200. Production process identities remained unchanged. Broad page inspection, real mount fault injection, remote tests and interactive settings restart were not run.
- Post-promotion homepage regression: the root route still queried only the retired remote fleet and incorrectly showed no online projects. It now selects authorized directly configured projects first and only queries remote discovery when remote hosts exist. `apps/web/app/page.test.tsx`: 4 passed (direct owner, direct viewer host isolation, legacy remote and standalone redirects). Web production build passed; the deployed root returned a project redirect, and browser navigation reached that project without the empty-project message.

Historical SQLite persistence and CLI follow-up evidence (superseded by the current bounded-LRU dump contract):
- A fresh process restored file/list/stat/missing observations with identical content and no physical project reads/listings/metadata calls. SQLite contains only namespace metadata and successful observations; local project persistence is excluded.
- Focused cache/Store regressions cover restart restore, manual refresh versus valid SSHFS TTL, memory-only attention/backoff independence, write races, symlink database parents and already-aborted uncached reads. Reapplying identical startup configuration leaves existing observation writers usable.
- Duplicate Runtime-module smoke retained a 30-second effective Wiki TTL after the saved config changed to 90 seconds. Runtime initialization is process-wide across separately bundled Next routes.
- Four child-process filesystem threads were confirmed blocked in disposable FIFO kernel waits; ten local filesystem operations completed in 2.7ms and a local SQLite write/read in 53.6ms. This exercises document/metadata isolation, not the unchanged binary FileHandle stream path.
- CLI focused coverage passed across Wiki, warning, lifecycle, Experiment documents/rename and Run resolution/warning files (100 selected cases after migrating obsolete root-level Run fixtures).
- Built CLI operation recording confirmed one target README read and one discovery pass, with no unrelated README or hypotheses reads. Wiki commands retained unresolved declared sources with no source-target filesystem operations; forty independent Wiki reads were simultaneously pending.
- Source-resolution and staleness documentation now assigns Markdown target resolution exclusively to Web. CLI `wiki stale` and `wiki ls --stale` are removed; `wiki backlinks` filters declared source tokens only.
- Final production rebuild and readiness checks passed. Browser inspection confirmed effective persistence periods and lean Experiment lists without Run/anomaly/Wiki/detail requests. After a process restart, the existing Experiment list restored from SQLite with zero additional physical project operations.

Detail latency and metrics correction:
- Coalesced callers were recorded both at join and completion. A three-caller regression failed with four joins before the fix and passes with one physical read and two joins afterward. Metric scope and cache-entry labels now distinguish instance-wide rolling operations from unique files.
- Declared member reads now use a bounded batch while preserving order and reciprocal membership. Source-resolution failures no longer prevent Experiment detail from returning: Wiki citations have an independent request/heartbeat, and document links use the target-independent `inventory=1` Wiki projection.
- Live diagnosis found the Web main thread blocked in a synchronous archive-sidecar existence check. Shared archive and scan-root checks now use asynchronous Store operations; a regression proves sidecar checks are accounted for and cached without caching native CLI reads.
- Focused checks cover Core Store/discovery, Backend Project/Wiki service and HTTP routes, and citation/Experiment UI behavior. Native built scan smoke preserves missing-field sidecar fallback and canonical frontmatter precedence. Core/Backend/CLI/Web builds and OpenSpec strict validation passed.
- Final Wiki evidence refinement: resolve actual Experiment/Run/Hypothesis metadata without archive-policy sidecars or anomaly projection. A cited Run with an unreadable sidecar still resolves correct Wiki evidence staleness. Full Wiki source resolution remains distinct from the identity-only navigation inventory.
- Final focused verification: 67 cases across Core Store/discovery, Backend Project/Wiki services and Wiki routes, and Web citation/Experiment rendering passed. Native built scan smoke preserved canonical archive precedence and legacy fallback; temporary fixtures were removed. Production builds passed. Final live detail returned all 71 declared members in 670ms; the browser showed document, Results and its resolved Wiki citation. Both ingress health checks passed. Git-backed Wiki review can still be slow independently and is not a cold-read latency guarantee.

## 9. Identity discovery versus content reads

- [x] 9.1 Add name/path inventory reads for Experiments, Runs, Reports, Digests and Code Reviews without loading document content or Run membership; retain explicit rich collection/detail responses and Wiki identity aliases.
- [x] 9.2 Migrate navigation, file-based counts and reference selectors to identity inventory queries; preserve detailed views, automatic collection scheduling and mutation invalidation.
- [x] 9.3 Verify inventory independence from unreadable contents and retained detail behavior with focused checks; no routine browser matrix, membership cache or Run layout migration.

Identity separation evidence:
- A temporary native-service smoke listed 100 Run identities with one readdir and three entry-root lstat calls, zero readFile/stat/realpath; three Experiment identities required one readdir and zero content/metadata calls. Report/Digest/Code Review inventories likewise made zero readFile/stat calls, retaining directory containment checks.
- Poisoned Run and Experiment READMEs did not prevent identity enumeration; explicit detail reads rejected those same files. Canonical Experiment folders retained precedence over legacy Markdown files in one directory listing.
- Selected regressions: Backend 5 passed (25 skipped), Web 10 passed (20 skipped), Core 1 passed (2 skipped). No full unit suite or browser checks. Core and Backend builds passed with bounded compiler heap.
- Rich full-list/detail views retain their content requirements. Wiki identity aliases remain frontmatter-aware, but identity inventory skips attachments and linked Experiment/Run content. No membership cache, directory migration or scheduler/pool adjustment.
