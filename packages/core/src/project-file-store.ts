// project-file-store — the single in-process authority for project file and
// directory observations.
//
// Scheduling state is memory-only by design: queue, in-flight tasks, waiter
// counts, attention leases, metrics and failure/backoff counters are lost on
// restart and start empty (see
// `openspec/changes/centralize-project-file-access/specs/project-file-store`).
// A restart recovers no work: startup loads the opt-in observation dump into
// memory, and individual demands adopt those already-completed answers.
//
// Shape of the module:
//
//   * `withProjectFileContext()` installs a per-request context (project root,
//     storage mode, storage group, human/automatic reason, attention id,
//     read-only policy, persistent-cache opt-in).
//   * `projectFs` is an `fs/promises`-compatible facade. Outside a context it
//     delegates straight to the native filesystem (the CLI always reads fresh,
//     with no cache, no scheduler and no worker); inside a context `readFile` /
//     `readdir` / `stat` / `lstat` / `realpath` route through the cache + I/O
//     scheduler, and mutations enforce the read-only policy and invalidate the
//     exact affected entries.
//   * A `storage: 'local'` context is direct: containment and the read-only
//     policy still apply, but the facade performs the native call itself —
//     nothing is queued, coalesced, cached, leased, backed off, counted, or
//     sent to a worker. Only `storage: 'sshfs'` projects use the machinery
//     below. (An unconfigured *project* is local; a context that omits the
//     field is sshfs, so callers predating the switch are unchanged.)
//   * The scheduler keeps at most one queued-or-running task per
//     project/path/operation key, promotes automatic work when a human joins,
//     limits physical operations per storage group (default 10), and records
//     bounded rolling metrics.
//   * Every physical operation inside a context — content, metadata,
//     containment resolution and mutations alike — runs in the isolated worker
//     of its storage group (`project-io.ts`), so a hung mount cannot starve
//     this process's libuv thread pool and with it local configuration reads
//     and local cache snapshots.
//   * `readFile` / `readdir` observations, plus the `stat` / `lstat` metadata
//     of those paths, are persisted for a project that opts in AND resolves to
//     a real SSHFS mount (`project-file-cache.ts`).
//
// Deliberate non-features: no global `fs` monkey-patching, no recursive
// readdir, no pre/post-read stability probes, no refresh timers (freshness is
// driven lazily by demand), no operation timeouts that would release a slot
// while the physical call is still running, and no preloading of a project.
//
// Module layout (`project-file-store/`): `contract` (public reasons, defaults,
// status and metric types), `metrics`, `errors`, `observation`, `containment`,
// `state`, `scheduler`, `persistence`, `mount-guard`, `reporting` (freshness
// status and metrics snapshots), `store`
// (`ProjectFileStore`), `runtime` (process-global singleton and public
// functions) and `fs-facade` (`projectFs`). This file only re-exports the
// public surface so every existing import path keeps working.

export * from './project-file-store/index.js'
