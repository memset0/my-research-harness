## Context

See proposal.md (Why). Current layout of `packages/core/src/project-file-store.ts`
(2,559 lines at commit `1c515c0`):

```
lines       contents
1-98        header comment, imports, re-exports of project-file-cache / -context
99-241      public contract: HUMAN_REASON, RESET_REASON, parseFileOperationReason,
            isHumanFileOperationReason, DEFAULT_FILE_ACCESS_OPTIONS,
            ProjectFileStatus and the FileOperation* metric types
242-371     internal state shapes: values, Observation, StoreEntry, ScheduledTask,
            StorageGroup, AttentionLease, PersistScope
373-402     bounds (MAX_QUEUED_PER_GROUP = 2048, cache/attention limits,
            MOUNT_TABLE_TTL_MS), metric constants, monotonic()
404-673     rolling metrics: Accumulator, histogram, MetricsRegistry
675-733     errno builders: EROFS, EACCES (containment), EBUSY (queue full),
            ENXIO (mount unavailable)
735-910     CachedDirent, observation constructors, resolveTargetPath,
            containedRealPath, persisted payload <-> observation
912-2100    class ProjectFileStore
              970-990    configure / effectiveOptions
              992-1129   groups, entries, interval ranges, attention leases, resets
              1131-1183  observe (cache hit / background verify / schedule)
              1185-1327  persistent-cache bridge (scope, restore, put, forget)
              1329-1490  scheduler: schedule, aging, takeOldestAutomatic,
                         takeNext, dispatch, execute, settle
              1490-1557  applySuccess (interval backoff) / applyFailure (failure backoff)
              1559-1599  memory bounds
              1600-1669  invalidation, write adoption, noteStorage
              1671-1810  status (freshness) / metricsSnapshot
              1812-1888  real root, mount-identity guard, mount-table TTL
              1890-2078  primitives: containedTarget, *Value, raw*, mutate
              2080-2099  acquire / release (write slots)
2102-2120   negative-observation helpers
2122-2179   process-global singleton and public functions
2181-2559   fs/promises-compatible facade (projectFs)
```

`project-io.ts` (617 lines) owns one forked child per storage group and has no
test file. Callers: `packages/backend/src/**` (injected `projectFs`),
`apps/web/lib/server/**` (`withProjectFileContext`, `/api/file-access`
metrics), and inside core `atomic-write.ts`, `project-resource.ts`,
`config/load.ts`, discovery/experiments/wiki/git readers.

## Goals / Non-Goals

**Goals:**
- Tests first (D1), then a behavior-preserving split (D2/D3), then a DAG guard (D4).
- Every resulting module <= 700 lines; `index.ts`'s exports byte-identical in
  name and signature.

**Non-Goals:**
- Fixing bugs found along the way (recorded under Future).
- Changing defaults, error codes, metric names, the `/api/file-access` shape,
  the global singleton symbol, or the `project-io-child` protocol.
- Splitting `project-io.ts` (it is under 700 lines; it only gains tests).

## Decisions

### D1 Tests before the split
The first implementation commits add tests only. Determinism comes from
injection the current code already allows, so no production edit is needed:
- **Clock**: `vi.useFakeTimers({ toFake: ['Date', 'performance'] })` drives
  both the wall clock (`Date.now`) and the monotonic clock (`performance.now`)
  the store uses; timers and `setImmediate` stay real so promises settle.
- **Fake fs**: `vi.spyOn(getProjectIo(), ...)` replaces the worker pool's
  `realpath` / `realpathNearest` / `readFile` / `readdir` / `stat` with an
  in-memory table that can return data, throw errno errors or block on a gate.
- **Mount table**: `vi.mock('./mount-table.js')` replaces `readMountTable`.
- **Fresh store**: each test deletes the `Symbol.for('memon.project-file-store.v2')`
  carrier so `getStore()` builds a new store with default options.
- **Worker pool**: `vi.mock('node:child_process')` returns a fake
  `ChildProcess` (EventEmitter with `send`/`ref`/`unref`/`kill`).

Test matrix:

| Path | Scenario | Expected (current behavior) |
|---|---|---|
| (a) saturation | 2048 automatic reads queued behind one blocked read, one more automatic | rejects `EBUSY`, `syscall: 'read'`, no new task |
| (a) | same key as a queued task while full | joins the queued task (coalesced), no rejection |
| (a) | human read while full | oldest queued automatic task rejected `EBUSY`; human accepted |
| (a) | human read while full of human tasks | rejects `EBUSY` |
| (b) promotion | human joins a queued automatic task | promoted ahead of earlier automatic work; one physical read; counted as human; coalesced +1 |
| (b) aging | automatic task older than `max(1s, 5 x heartbeat)` | dispatched before a newer human task |
| (c) success backoff | unchanged automatic observations | interval base -> x2 -> cap (maintenance 300 s -> 600 s -> 900 s) |
| (c) | manual refresh | due immediately, interval back to base |
| (c) failure backoff | repeated `EIO` | cached error replayed until due; retries at 15, 30, 60, 120, 240, 300, 300 s |
| (c) | success after failures | error cleared; next failure starts at 15 s again |
| (d) storage loss | root `realpath` `EIO` | hard error, status `EIO`, root not memoised; recovers |
| (d) | root `realpath` `ENOENT` | lexical root used; missing file is a cached negative |
| (d) | `stat` `ENOENT` / `EIO` / `ETIMEDOUT` | ENOENT cached as missing; others are errors with status code, retained data |
| (d) | mount disappears from mount table | `ENXIO`, cached content still served, status `ENXIO`; remount recovers |
| (e) pool | worker exits with work pending | pending rejects `EIO` (`syscall: projectIo`), next call forks a new worker |
| (e) | `send()` returns false | `EBUSY` "channel is full" |
| (e) | worker exits before ready | `EIO` with start-failure message |
| (e) | `shutdownProjectIo()` with work pending | pending rejects `ECANCELED`, child killed |
| (e) | error reply | errno fields revived (`code`, `errno`, `syscall`, `path`, `dest`) |
| (e) | non-cloneable mutate payload | executed directly in-process |
| (e) | pool sizing | `UV_THREADPOOL_SIZE = clamp(ceil(concurrency)+4, 8, 128)` |
| (e) timeout | caller abort on an isolated read | caller gets `AbortError`; worker finishes and the slot is released (there is no operation timeout by design) |

Coverage snapshot (what the D1 tests reach; 14 store tests + 11 pool tests,
~0.4 s together):

- Store public functions: `withProjectFileContext`, `configureProjectFileStore`,
  `getProjectFileStatus` (root and attention-scoped), `getFileOperationMetrics`,
  `projectFs.readFile` (cached and abortable raw path), `projectFs.stat`.
- `ProjectFileStore` methods: `configure`, `effectiveOptions`, `noteStorage`,
  `status`, `metricsSnapshot`, `containedTarget`, `readFileValue`,
  `statValue`, `rawReadFile`, and internally `observe`, `resetSchedule`,
  `touchAttention`, `schedule`, `takeOldestAutomatic`, `takeNext` (aging),
  `dispatch`, `execute`, `settle`, `applySuccess`, `applyFailure`,
  `realRoot`, `assertMountIdentity`, `mountTable`.
- Not reached by D1 (already covered by `project-file-store.test.ts`,
  `project-file-cache.test.ts` and the domain suites): `listDirValue`,
  `realpathValue`, `rawStat`, `rawAccess`, `mutate`/`acquire`/`release`,
  `adoptWrite`, `invalidate`, persistence bridge.
- `project-io.ts`: `getProjectIo`, `shutdownProjectIo`, `executeProjectIo`
  (allowlist refusal, direct mutation), pool `configure` / `readFile` /
  `readdir` / `stat` / `realpath` / `realpathNearest` / `access` / `mutate`,
  worker `send` / `ensure` / `spawn` / `receive` / `crash` / `dispose`.
  Not reached: child-entry fallback through `@memon/core` resolution,
  `direntKindOf`, parent-side `realpathNearest()`.

### D2 Module split
Target layout under `packages/core/src/project-file-store/` (dependency
direction top to bottom; no module imports one listed above it):

```
index.ts        re-exports the public surface (no logic)
fs-facade.ts    projectFs Proxy and facade functions          -> runtime, errors, containment, observation
runtime.ts      process-global singleton + public functions   -> store
store.ts        ProjectFileStore orchestration                -> scheduler, persistence, mount-guard, metrics, ...
persistence.ts  persistent-cache bridge (scope, load, put, forget)
mount-guard.ts  real-root memo, mount identity guard, mount-table TTL
scheduler.ts    groups, queue bound, promotion, aging, dispatch, write slots, backoff math
state.ts        StoreEntry / ScheduledTask / StorageGroup / PersistScope shapes (types only)
observation.ts  values, Observation, CachedDirent, constructors, persisted payload, negative helpers
containment.ts  resolveTargetPath, containedRealPath
errors.ts       EROFS / EACCES / EBUSY / ENXIO builders
metrics.ts      MetricsRegistry, metric constants, snapshot assembly
contract.ts     reasons, defaults, public status/metric types
clock.ts        monotonic()
```

`packages/core/src/project-file-store.ts` stays as a thin module that
re-exports `./project-file-store/index.js` and the context/cache names it has
always re-exported, so every existing import path keeps working. The scheduler
is a class owned by the store; it reaches back into store state only through a
small hook interface (cached value at dispatch, success, failure, post-execute
memory bounds), keeping the call order of the original methods.
Alternative considered: keep one class and move only free functions out —
rejected because the class alone is ~1,190 lines.

### D3 No behavior change
Defaults, bounds, errno codes/messages, metric field names, the singleton
symbol, LRU recency side effects (`observations.get` at dispatch) and the
order of state updates are preserved verbatim. The D1 tests and the existing
core suite run unchanged after every split commit.

### D4 Import DAG guard
A test parses relative imports of every `project-file-store/*.ts` module and
asserts (1) the internal graph is acyclic, (2) no module reaches `git/**`, and
(3) `git/command.ts` (the edge of the cycle removed in v7.1.0) does not reach
any store module. Note: `git/files.ts` and `git/commit-marks.ts` legitimately
*use* `projectFs` (a one-way edge), so the guard forbids reaching git from the
store, not every git module importing the store.

## Risks / Trade-offs

- [Fake timers also fake `performance` for the test runner] -> only `Date` and
  `performance` are faked, real timers/`setImmediate` flush promises.
- [A moved method changes LRU recency or update order] -> moves are verbatim;
  D1 tests pin the observable effects; full core suite after every commit.
- [Global singleton reset in tests leaks into other files] -> tests restore
  options and drop the carrier in `afterAll`.
- [Concurrent agents edit tsconfig/vitest config] -> this change edits no
  config; hook failures in foreign files are retried.

## Migration Plan

None: internal refactor; rollback is a revert of the refactor commits.

## Future

Found while writing the D1 tests; deliberately not fixed in this change (D3):

1. **Uncached operations bypass the group slot budget.** `rawReadFile`
   (abort signal or non-default flag), `rawStat` (`bigint`), `rawAccess`
   (write check), the containment resolution done by `projectFs.open`, and
   `realRoot` / `containedTarget` resolutions call the worker directly: they
   hold no scheduler slot and are not metered, so the "actual concurrency"
   limit of `file-operation-scheduler` is not a hard bound for them.
2. **Queue-full refusals are invisible in status and metrics.** The `EBUSY`
   for a new or displaced task neither sets the entry's error code nor counts
   as a metric error, so the footer shows no error while reads are refused.
3. **`EBUSY` always reports `syscall: 'read'`**, also for `stat`, `lstat`,
   `readdir` and `realpath` refusals.
4. **Aged automatic tasks can still be displaced.** `takeOldestAutomatic`
   picks any non-human task, including automatic work that already earned
   human-equal priority through aging.
5. **The real root is memoised for the process lifetime.** A root whose
   symlink target is changed keeps resolving to the old real path until
   restart (the mount guard only checks mount identity).
6. **A worker `error` event while the channel is still connected** rejects
   every pending request but keeps the child, so later requests go to a
   process that already reported an error.
