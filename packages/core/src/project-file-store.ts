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

import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes } from 'node:crypto'
import { type Dirent, promises as nodeFs, type PathLike, type Stats } from 'node:fs'
import type * as FsPromisesModule from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LRUCache } from 'lru-cache'
import { invalidateGitOperations } from './git/command.js'
import {
  containingMount,
  isWithinPath,
  type MountIdentity,
  readMountTable,
  SSHFS_FS_TYPE,
  sameMountIdentity,
} from './mount-table.js'
import {
  getProjectFileCache,
  isPersistedOperation,
  type PersistedOperation,
  type PersistedPayload,
  type ProjectFileCache,
  projectFileTtlMs,
} from './project-file-cache.js'
import {
  type DirEntryData,
  type DirEntryKind,
  executeProjectIo,
  getProjectIo,
  type MutationMethod,
  ProjectStats,
  type StatsFields,
} from './project-io.js'
import { formatIsoLocal } from './time.js'

export { configureProjectFileCache, type FileCacheOptions } from './project-file-cache.js'

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export const FILE_OPERATION_REASONS = [
  'open',
  'focus',
  'manual',
  'heartbeat',
  'automatic',
  'write',
] as const

export type FileOperationReason = (typeof FILE_OPERATION_REASONS)[number]

/** Reasons that represent a person waiting on the answer right now. */
const HUMAN_REASON: Record<FileOperationReason, boolean> = {
  open: true,
  focus: true,
  manual: true,
  heartbeat: false,
  automatic: false,
  write: true,
}

/**
 * Reasons that discard the current freshness lifetime and re-verify now.
 *
 * Opening or focusing a page is deliberately NOT one of them: those are the
 * navigations a person performs constantly, and forcing physical I/O for each
 * one is what made a remote project feel unusable. They still count as human
 * demand (queue priority, attention lease) and they still serve the cached
 * observation. An explicit refresh (`manual`) and a write are the events that
 * mean "look again now".
 */
const RESET_REASON: Record<FileOperationReason, boolean> = {
  open: false,
  focus: false,
  manual: true,
  heartbeat: false,
  automatic: false,
  write: true,
}

/** Narrow an `X-Memon-Reason` header value; unknown values become undefined. */
export function parseFileOperationReason(
  raw: string | null | undefined,
): FileOperationReason | undefined {
  if (raw === null || raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  return (FILE_OPERATION_REASONS as readonly string[]).includes(value)
    ? (value as FileOperationReason)
    : undefined
}

export function isHumanFileOperationReason(reason: FileOperationReason | undefined): boolean {
  return reason !== undefined && HUMAN_REASON[reason]
}

export interface ProjectFileContext {
  /** Absolute project root. Identity of every cache key created in the context. */
  root: string
  /**
   * Physical storage class of the Project. `'local'` performs every operation
   * directly on the native filesystem inside this context: contained and
   * read-only-enforced, but never queued, coalesced, cached, leased, backed
   * off, counted or run in an I/O worker. `undefined` means `'sshfs'` — the
   * scheduled path — so a caller that predates the switch keeps its
   * behaviour. (The *config* default is the opposite: an unconfigured
   * Project is local.)
   */
  storage?: 'local' | 'sshfs'
  /** Physical storage bucket sharing one concurrency limit. Defaults to `'default'`. */
  storageGroup?: string
  /** Why the read happens; human reasons reset backoff and take priority. */
  reason?: FileOperationReason
  /** Opaque tab/page id used for attention leases and freshness scoping. */
  attentionId?: string
  /** When true, every mutating facade method fails with EROFS. */
  readOnly?: boolean
  /**
   * Opt in to persisting this project's observations across restarts. Honoured
   * only when the root also resolves to a real SSHFS mount: a local project is
   * never written to the cache database.
   */
  persistentCache?: boolean
}

export interface FileAccessOptions {
  concurrency: number
  heartbeatMs: number
  leaseMs: number
  fileMinMs: number
  fileMaxMs: number
  directoryMinMs: number
  directoryMaxMs: number
  maintenanceMinMs: number
  maintenanceMaxMs: number
  failureMinMs: number
  failureMaxMs: number
  backoffFactor: number
}

export const DEFAULT_FILE_ACCESS_OPTIONS: FileAccessOptions = {
  concurrency: 10,
  heartbeatMs: 30_000,
  leaseMs: 90_000,
  fileMinMs: 5_000,
  fileMaxMs: 30_000,
  directoryMinMs: 15_000,
  directoryMaxMs: 60_000,
  maintenanceMinMs: 300_000,
  maintenanceMaxMs: 900_000,
  failureMinMs: 15_000,
  failureMaxMs: 300_000,
  backoffFactor: 2,
}

export type FileOperationName = 'readFile' | 'readdir' | 'stat' | 'lstat' | 'realpath' | 'write'
export type FileOperationOrigin = 'human' | 'automatic'

/** Operations that own a cache entry (`write` is scheduled but never cached). */
type ObservedOperation = Exclude<FileOperationName, 'write'>

export interface ProjectFileStatus {
  /** Process instance token; invalidates every client version assumption. */
  epoch: string
  /** Wall-clock ms of the oldest successful observation in scope, null when none. */
  oldestVerifiedAt: number | null
  /** True when some dependency in scope has no successful observation yet. */
  incomplete: boolean
  queued: number
  checking: number
  /**
   * Errno-style CODE only (for example `EACCES`, `ENXIO`, `EIO`), never a
   * message, root or path: this object is serialized into a browser response
   * header.
   */
  error: string | null
  /** Dependency observation vector token — NOT a semantic body hash. */
  version: string
  /**
   * True when this root is read directly (`storage: local`): nothing is
   * scheduled or cached, so there is no freshness to report and `version`
   * is the constant `'direct'`.
   */
  direct?: boolean
}

export interface FileOperationLatency {
  meanMs: number
  p95Ms: number
}

export interface FileOperationCounters {
  /** Physical operations completed in the window (a shared op counts once). */
  samples: number
  errors: number
  cacheHits: number
  /** Extra callers that joined an existing task instead of adding I/O. */
  coalesced: number
  /** Application bytes returned by physical reads. */
  readBytes: number
  queueWaitMs: FileOperationLatency
  executionMs: FileOperationLatency
}

export interface FileOperationSeries extends FileOperationCounters {
  storageGroup: string
  operation: FileOperationName
  origin: FileOperationOrigin
}

export interface FileOperationGroupState {
  storageGroup: string
  concurrency: number
  inFlight: number
  queued: number
  oldestWaitingAgeMs: number | null
}

export interface FileOperationMetrics {
  epoch: string
  /** ISO8601 with timezone offset. */
  generatedAt: string
  windowMs: number
  availableWindowsMs: number[]
  options: FileAccessOptions
  overall: FileOperationCounters
  byOrigin: Record<FileOperationOrigin, FileOperationCounters>
  byOperation: Record<FileOperationName, FileOperationCounters>
  series: FileOperationSeries[]
  groups: FileOperationGroupState[]
  inFlight: number
  queued: number
  oldestWaitingAgeMs: number | null
  cacheEntries: number
  cachedContentBytes: number
}

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

/** Directory entry kinds and stat fields travel with the isolated worker. */
type CachedDirEntry = DirEntryData

interface FileValue {
  kind: 'file'
  bytes: Buffer
  /** Lazily memoised utf8 decode — most project documents are read as utf8. */
  text?: string
}
interface DirValue {
  kind: 'dir'
  entries: CachedDirEntry[]
}
interface StatValue {
  kind: 'stat'
  stats: Stats
}
interface PathValue {
  kind: 'path'
  target: string
}

type PresentValue = FileValue | DirValue | StatValue | PathValue

/** A successful observation: either present data or a successful "missing". */
interface Observation {
  present: boolean
  value: PresentValue | null
  /** The original ENOENT/ENOTDIR error, replayed on cached-missing hits. */
  missingError: NodeJS.ErrnoException | null
  fingerprint: string
  /** Cached content bytes attributable to this observation. */
  bytes: number
}

interface StoreEntry {
  key: string
  root: string
  group: StorageGroup
  operation: ObservedOperation
  path: string
  /** Fingerprint of the last successful observation; survives content eviction. */
  fingerprint: string | null
  /** Bumps only when the observed fingerprint changes. */
  observationVersion: number
  completedAtWall: number | null
  completedAtMono: number | null
  intervalMs: number
  dueAtMono: number
  failures: number
  /**
   * Current error CODE (never a message or path), or null when the last
   * attempt succeeded. `getProjectFileStatus` is serialized into a browser
   * response header, so it must never carry roots, paths or messages.
   */
  error: string | null
  /** Hard error to replay while no successful observation exists. */
  cachedError: NodeJS.ErrnoException | null
  attentionGeneration: number
  mutationGeneration: number
  lastAttentionAtWall: number
  /**
   * An explicit refresh (or a write) asked for re-verification and no
   * physical observation has answered it yet. A row restored from the
   * persistent cache is not that answer, so it must not cancel the request.
   */
  refreshRequested: boolean
  /**
   * Persistent-cache scope for this key, or null when this project is not
   * persisted. Resolved once, when the entry is first demanded.
   */
  persist: PersistScope | null
  /**
   * True once the snapshot-backed memory cache has been consulted (or has
   * deliberately been made irrelevant by an invalidation). Eviction may
   * permit another lookup; invalidation must not resurrect an old answer.
   */
  persistLoaded: boolean
  persistLoad: Promise<void> | null
}

interface ScheduledTask {
  key: string
  entry: StoreEntry
  group: StorageGroup
  operation: FileOperationName
  human: boolean
  origin: FileOperationOrigin
  enqueuedAtMono: number
  startedAtMono: number | null
  attentionGeneration: number
  mutationGeneration: number
  state: 'queued' | 'running'
  runner: () => Promise<Observation>
  promise: Promise<Observation>
  resolve: (observation: Observation) => void
  reject: (error: unknown) => void
}

interface StorageGroup {
  name: string
  active: number
  queue: ScheduledTask[]
  tasks: Map<string, ScheduledTask>
  /** Mutations waiting for a slot; granted before queued reads. */
  writeWaiters: (() => void)[]
}

interface AttentionLease {
  root: string
  expiresAtWall: number
  keys: Set<string>
}

/**
 * Everything needed to reach a project's snapshot-backed observations: the
 * memory cache and stable namespace for configured root plus mount identity.
 * A root remapped to different storage resolves a different namespace, so
 * observations of the previous storage can never be reused.
 */
interface PersistScope {
  cache: ProjectFileCache
  namespaceId: string
  mount: MountIdentity
}

const MAX_CACHED_CONTENT_BYTES = 128 * 1024 * 1024
const MAX_CACHE_ENTRIES = 50_000
const MAX_ATTENTION_KEYS = 4_096
const ATTENTION_SWEEP_INTERVAL_MS = 1_000
/** Pending (not yet dispatched) operations retained per storage group. */
const MAX_QUEUED_PER_GROUP = 2_048
/** Mount-table snapshot lifetime; the read is OS-local, never remote. */
const MOUNT_TABLE_TTL_MS = 1_000

const METRIC_BUCKET_MS = 5_000
const METRIC_BUCKET_COUNT = 180
const METRIC_WINDOWS_MS = [60_000, 300_000, 900_000]
const HISTOGRAM_BOUNDS = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_024, 2_048, 4_096, 8_192, 16_384, 32_768, 65_536,
  131_072,
]
const HISTOGRAM_LEN = HISTOGRAM_BOUNDS.length + 1

const ALL_OPERATIONS: FileOperationName[] = [
  'readFile',
  'readdir',
  'stat',
  'lstat',
  'realpath',
  'write',
]

function monotonic(): number {
  return performance.now()
}

// ---------------------------------------------------------------------------
// Bounded rolling metrics
// ---------------------------------------------------------------------------

interface MetricBucket {
  slot: number
  samples: number
  errors: number
  cacheHits: number
  coalesced: number
  readBytes: number
  execSum: number
  waitSum: number
  exec: Uint32Array
  wait: Uint32Array
}

interface MetricSeriesState {
  storageGroup: string
  operation: FileOperationName
  origin: FileOperationOrigin
  buckets: (MetricBucket | undefined)[]
}

interface Accumulator {
  samples: number
  errors: number
  cacheHits: number
  coalesced: number
  readBytes: number
  execSum: number
  waitSum: number
  exec: Uint32Array
  wait: Uint32Array
}

function createAccumulator(): Accumulator {
  return {
    samples: 0,
    errors: 0,
    cacheHits: 0,
    coalesced: 0,
    readBytes: 0,
    execSum: 0,
    waitSum: 0,
    exec: new Uint32Array(HISTOGRAM_LEN),
    wait: new Uint32Array(HISTOGRAM_LEN),
  }
}

function histogramIndex(valueMs: number): number {
  for (let i = 0; i < HISTOGRAM_BOUNDS.length; i += 1) {
    if (valueMs <= HISTOGRAM_BOUNDS[i]!) return i
  }
  return HISTOGRAM_BOUNDS.length
}

function percentileMs(hist: Uint32Array, total: number, ratio: number): number {
  if (total === 0) return 0
  const target = Math.max(1, Math.ceil(total * ratio))
  let cumulative = 0
  for (let i = 0; i < hist.length; i += 1) {
    cumulative += hist[i]!
    if (cumulative >= target) {
      const bound = HISTOGRAM_BOUNDS[i]
      return bound ?? HISTOGRAM_BOUNDS[HISTOGRAM_BOUNDS.length - 1]! * 2
    }
  }
  return HISTOGRAM_BOUNDS[HISTOGRAM_BOUNDS.length - 1]! * 2
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function toCounters(acc: Accumulator): FileOperationCounters {
  return {
    samples: acc.samples,
    errors: acc.errors,
    cacheHits: acc.cacheHits,
    coalesced: acc.coalesced,
    readBytes: acc.readBytes,
    queueWaitMs: {
      meanMs: acc.samples === 0 ? 0 : round3(acc.waitSum / acc.samples),
      p95Ms: percentileMs(acc.wait, acc.samples, 0.95),
    },
    executionMs: {
      meanMs: acc.samples === 0 ? 0 : round3(acc.execSum / acc.samples),
      p95Ms: percentileMs(acc.exec, acc.samples, 0.95),
    },
  }
}

class MetricsRegistry {
  private readonly series = new Map<string, MetricSeriesState>()

  private seriesFor(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
  ): MetricSeriesState {
    const key = `${storageGroup}\u0000${operation}\u0000${origin}`
    let state = this.series.get(key)
    if (state === undefined) {
      state = {
        storageGroup,
        operation,
        origin,
        buckets: new Array<MetricBucket | undefined>(METRIC_BUCKET_COUNT),
      }
      this.series.set(key, state)
    }
    return state
  }

  private bucketFor(state: MetricSeriesState): MetricBucket {
    const slot = Math.floor(monotonic() / METRIC_BUCKET_MS)
    const index = ((slot % METRIC_BUCKET_COUNT) + METRIC_BUCKET_COUNT) % METRIC_BUCKET_COUNT
    let bucket = state.buckets[index]
    if (bucket === undefined) {
      bucket = {
        slot,
        samples: 0,
        errors: 0,
        cacheHits: 0,
        coalesced: 0,
        readBytes: 0,
        execSum: 0,
        waitSum: 0,
        exec: new Uint32Array(HISTOGRAM_LEN),
        wait: new Uint32Array(HISTOGRAM_LEN),
      }
      state.buckets[index] = bucket
    } else if (bucket.slot !== slot) {
      bucket.slot = slot
      bucket.samples = 0
      bucket.errors = 0
      bucket.cacheHits = 0
      bucket.coalesced = 0
      bucket.readBytes = 0
      bucket.execSum = 0
      bucket.waitSum = 0
      bucket.exec.fill(0)
      bucket.wait.fill(0)
    }
    return bucket
  }

  recordOperation(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
    sample: { waitMs: number; execMs: number; bytes: number; error: boolean },
  ): void {
    const bucket = this.bucketFor(this.seriesFor(storageGroup, operation, origin))
    bucket.samples += 1
    bucket.execSum += sample.execMs
    bucket.waitSum += sample.waitMs
    const execSlot = histogramIndex(sample.execMs)
    const waitSlot = histogramIndex(sample.waitMs)
    bucket.exec[execSlot] = bucket.exec[execSlot]! + 1
    bucket.wait[waitSlot] = bucket.wait[waitSlot]! + 1
    bucket.readBytes += sample.bytes
    if (sample.error) bucket.errors += 1
  }

  recordCacheHit(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
  ): void {
    this.bucketFor(this.seriesFor(storageGroup, operation, origin)).cacheHits += 1
  }

  recordCoalesced(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
  ): void {
    this.bucketFor(this.seriesFor(storageGroup, operation, origin)).coalesced += 1
  }

  snapshot(windowMs: number): {
    overall: FileOperationCounters
    byOrigin: Record<FileOperationOrigin, FileOperationCounters>
    byOperation: Record<FileOperationName, FileOperationCounters>
    series: FileOperationSeries[]
  } {
    const currentSlot = Math.floor(monotonic() / METRIC_BUCKET_MS)
    const oldestSlot = currentSlot - Math.max(1, Math.ceil(windowMs / METRIC_BUCKET_MS)) + 1

    const overall = createAccumulator()
    const byOrigin: Record<FileOperationOrigin, Accumulator> = {
      human: createAccumulator(),
      automatic: createAccumulator(),
    }
    const byOperation = {} as Record<FileOperationName, Accumulator>
    for (const operation of ALL_OPERATIONS) byOperation[operation] = createAccumulator()
    const series: FileOperationSeries[] = []

    for (const state of this.series.values()) {
      const acc = createAccumulator()
      for (const bucket of state.buckets) {
        if (bucket === undefined) continue
        if (bucket.slot < oldestSlot || bucket.slot > currentSlot) continue
        mergeBucket(acc, bucket)
      }
      if (acc.samples === 0 && acc.cacheHits === 0 && acc.coalesced === 0) continue
      mergeAccumulator(overall, acc)
      mergeAccumulator(byOrigin[state.origin], acc)
      mergeAccumulator(byOperation[state.operation], acc)
      series.push({
        storageGroup: state.storageGroup,
        operation: state.operation,
        origin: state.origin,
        ...toCounters(acc),
      })
    }

    series.sort(
      (a, b) =>
        a.storageGroup.localeCompare(b.storageGroup) ||
        a.operation.localeCompare(b.operation) ||
        a.origin.localeCompare(b.origin),
    )

    const operations = {} as Record<FileOperationName, FileOperationCounters>
    for (const operation of ALL_OPERATIONS) {
      operations[operation] = toCounters(byOperation[operation])
    }

    return {
      overall: toCounters(overall),
      byOrigin: {
        human: toCounters(byOrigin.human),
        automatic: toCounters(byOrigin.automatic),
      },
      byOperation: operations,
      series,
    }
  }
}

function mergeBucket(acc: Accumulator, bucket: MetricBucket): void {
  acc.samples += bucket.samples
  acc.errors += bucket.errors
  acc.cacheHits += bucket.cacheHits
  acc.coalesced += bucket.coalesced
  acc.readBytes += bucket.readBytes
  acc.execSum += bucket.execSum
  acc.waitSum += bucket.waitSum
  for (let i = 0; i < HISTOGRAM_LEN; i += 1) {
    acc.exec[i] = acc.exec[i]! + bucket.exec[i]!
    acc.wait[i] = acc.wait[i]! + bucket.wait[i]!
  }
}

function mergeAccumulator(target: Accumulator, source: Accumulator): void {
  target.samples += source.samples
  target.errors += source.errors
  target.cacheHits += source.cacheHits
  target.coalesced += source.coalesced
  target.readBytes += source.readBytes
  target.execSum += source.execSum
  target.waitSum += source.waitSum
  for (let i = 0; i < HISTOGRAM_LEN; i += 1) {
    target.exec[i] = target.exec[i]! + source.exec[i]!
    target.wait[i] = target.wait[i]! + source.wait[i]!
  }
}

// ---------------------------------------------------------------------------
// Errors and small helpers
// ---------------------------------------------------------------------------

function readOnlyError(syscall: string, path: string): NodeJS.ErrnoException {
  const error = new Error(
    `EROFS: read-only project file access, ${syscall} '${path}'`,
  ) as NodeJS.ErrnoException
  error.code = 'EROFS'
  error.errno = -30
  error.syscall = syscall
  error.path = path
  return error
}

/**
 * Refusal for a path outside its project file context root, including through
 * a symlink. This is an access error, never a "missing" observation. A request
 * that legitimately spans several projects must open one context per root.
 */
function containmentError(syscall: string, path: string, root: string): NodeJS.ErrnoException {
  const error = new Error(
    `EACCES: path escapes the project file context root '${root}', ${syscall} '${path}'`,
  ) as NodeJS.ErrnoException
  error.code = 'EACCES'
  error.errno = -13
  error.syscall = syscall
  error.path = path
  return error
}

/** Refusal when a storage group already has the maximum pending operations. */
function queueFullError(path: string): NodeJS.ErrnoException {
  const error = new Error(
    `EBUSY: project file operation queue is full, read '${path}'`,
  ) as NodeJS.ErrnoException
  error.code = 'EBUSY'
  error.errno = -16
  error.syscall = 'read'
  error.path = path
  return error
}

/**
 * Refusal when the storage behind a project root is gone or was replaced. A
 * vanished SSHFS mountpoint frequently reverts to an ordinary empty local
 * directory, and publishing that as an empty project would look like every
 * file was deleted.
 */
function mountUnavailableError(syscall: string, root: string): NodeJS.ErrnoException {
  const error = new Error(
    `ENXIO: project storage mount is unavailable or was replaced, ${syscall} '${root}'`,
  ) as NodeJS.ErrnoException
  error.code = 'ENXIO'
  error.errno = -6
  error.syscall = syscall
  error.path = root
  return error
}

/**
 * Minimal `Dirent` reconstruction for cached listings. Node's `Dirent` is not
 * publicly constructible, and callers only use the name plus the type
 * predicates.
 */
class CachedDirent {
  readonly name: string
  readonly parentPath: string
  private readonly kind: DirEntryKind

  constructor(name: string, parentPath: string, kind: DirEntryKind) {
    this.name = name
    this.parentPath = parentPath
    this.kind = kind
  }

  /** Deprecated alias Node still exposes. */
  get path(): string {
    return this.parentPath
  }

  isFile(): boolean {
    return this.kind === 'file'
  }
  isDirectory(): boolean {
    return this.kind === 'directory'
  }
  isSymbolicLink(): boolean {
    return this.kind === 'symlink'
  }
  isBlockDevice(): boolean {
    return false
  }
  isCharacterDevice(): boolean {
    return false
  }
  isFIFO(): boolean {
    return false
  }
  isSocket(): boolean {
    return false
  }
}

function fileObservation(bytes: Buffer): Observation {
  return {
    present: true,
    value: { kind: 'file', bytes },
    missingError: null,
    fingerprint: `f:${bytes.length}:${createHash('sha1').update(bytes).digest('hex')}`,
    bytes: bytes.length,
  }
}

function dirObservation(entries: CachedDirEntry[]): Observation {
  const hash = createHash('sha1')
  for (const name of entries.map((entry) => `${entry.kind[0]}${entry.name}`).sort()) {
    hash.update(name)
    hash.update('\u0000')
  }
  return {
    present: true,
    value: { kind: 'dir', entries },
    missingError: null,
    fingerprint: `d:${entries.length}:${hash.digest('hex')}`,
    bytes: 0,
  }
}

function statObservation(fields: StatsFields): Observation {
  return {
    present: true,
    value: { kind: 'stat', stats: new ProjectStats(fields) as unknown as Stats },
    missingError: null,
    fingerprint: `s:${String(fields.mtimeMs)}:${String(fields.size)}:${String(fields.ino)}:${String(fields.mode)}`,
    bytes: 0,
  }
}

function pathObservation(target: string): Observation {
  return {
    present: true,
    value: { kind: 'path', target },
    missingError: null,
    fingerprint: `p:${target}`,
    bytes: 0,
  }
}

function missingObservation(error: NodeJS.ErrnoException): Observation {
  return {
    present: false,
    value: null,
    missingError: error,
    fingerprint: `missing:${error.code ?? 'ENOENT'}`,
    bytes: 0,
  }
}

function resolveTargetPath(target: PathLike): string | null {
  if (typeof target === 'string') return resolve(target)
  if (Buffer.isBuffer(target)) return resolve(target.toString('utf8'))
  if (target instanceof URL) {
    if (target.protocol !== 'file:') return null
    return resolve(fileURLToPath(target))
  }
  return null
}

/**
 * Symlink-aware containment. `keepFinalLink` leaves the last component
 * unresolved (for `lstat`, which must observe the link itself) while still
 * requiring its parent chain to stay inside the root.
 *
 * `resolveReal` performs the physical resolution (the deepest existing
 * ancestor, remainder kept lexically) in the storage group's isolated worker;
 * the decision itself stays here.
 */
async function containedRealPath(
  rootReal: string,
  target: string,
  syscall: string,
  keepFinalLink: boolean,
  resolveReal: (path: string) => Promise<string>,
): Promise<string> {
  const anchor = keepFinalLink ? dirname(target) : target
  const resolved = await resolveReal(anchor)
  const full = keepFinalLink ? join(resolved, basename(target)) : resolved
  if (!isWithinPath(rootReal, resolved) || !isWithinPath(rootReal, full)) {
    throw containmentError(syscall, target, rootReal)
  }
  return full
}

/** The persistable form of a successful observation, or null when it is not persistable. */
function persistedPayloadOf(observation: Observation): PersistedPayload | null {
  if (!observation.present) {
    return { kind: 'missing', code: observation.missingError?.code ?? 'ENOENT' }
  }
  const value = observation.value
  if (value === null) return null
  switch (value.kind) {
    case 'file':
      return { kind: 'file', bytes: value.bytes }
    case 'dir':
      return { kind: 'dir', entries: value.entries }
    case 'stat':
      return { kind: 'stat', stats: { ...(value.stats as unknown as StatsFields) } }
    case 'path':
      // Symlink resolutions are re-observed after a restart: nothing is
      // persisted that would let a moved link answer from a stale target.
      return null
  }
}

/** Rebuild the in-memory observation a persisted row describes. */
function observationFromPersisted(payload: PersistedPayload, path: string): Observation {
  switch (payload.kind) {
    case 'file':
      return fileObservation(payload.bytes)
    case 'dir':
      return dirObservation(payload.entries)
    case 'stat':
      return statObservation(payload.stats)
    case 'missing': {
      const error = new Error(
        `${payload.code}: no such file or directory, access '${path}'`,
      ) as NodeJS.ErrnoException
      error.code = payload.code
      error.errno = payload.code === 'ENOTDIR' ? -20 : -2
      error.syscall = 'access'
      error.path = path
      return missingObservation(error)
    }
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

class ProjectFileStore {
  readonly epoch = randomBytes(8).toString('hex')
  readonly contextStorage = new AsyncLocalStorage<ProjectFileContext>()

  private options: FileAccessOptions = { ...DEFAULT_FILE_ACCESS_OPTIONS }
  // Scheduler metadata and tasks never enter this completed-value LRU.
  private readonly observations = new LRUCache<string, Observation>({
    max: MAX_CACHE_ENTRIES,
    maxSize: MAX_CACHED_CONTENT_BYTES,
    sizeCalculation: (observation) => Math.max(1, observation.bytes),
    dispose: (observation, key, reason) => {
      this.cachedContentBytes -= observation.bytes
      if (reason === 'evict') {
        const entry = this.entries.get(key)
        if (entry !== undefined) entry.persistLoaded = false
      }
    },
  })
  private readonly entries = new Map<string, StoreEntry>()
  private readonly groups = new Map<string, StorageGroup>()
  private readonly attentions = new Map<string, AttentionLease>()
  private readonly metrics = new MetricsRegistry()
  private cachedContentBytes = 0
  private lastAttentionSweepWall = 0
  /** Resolved real path of each project root, observed once per process. */
  private readonly realRoots = new Map<string, string>()
  /** Mount identity observed for each real root, used as an availability guard. */
  private readonly rootMounts = new Map<string, MountIdentity>()
  /**
   * Roots whose most recent context declared `storage: 'local'`. Direct
   * operations create no entries, tasks or metrics, so this is the only
   * record freshness reporting can answer from.
   */
  private readonly directRoots = new Set<string>()
  private mountTableEntries: MountIdentity[] | null = null
  private mountTableAtMono: number | null = null
  private mountTableRead: Promise<MountIdentity[] | null> | null = null
  /** Operation keys already reset by the in-flight human request, per context. */
  private readonly contextResets = new WeakMap<ProjectFileContext, Set<string>>()
  /**
   * Persistent-cache scope per configured root, with the mount identity it
   * was resolved against. Re-resolved when that identity changes, so a
   * remapped root cannot keep writing into the previous namespace.
   */
  private readonly persistScopes = new Map<
    string,
    { mount: MountIdentity | null; scope: Promise<PersistScope | null> }
  >()
  /**
   * Orders every persistent-cache mutation this store issues, so a delete
   * caused by an invalidation can never be overtaken by an older write.
   */
  private persistTail: Promise<void> = Promise.resolve()

  // -- configuration -------------------------------------------------------

  configure(patch: Partial<FileAccessOptions>): void {
    const next: FileAccessOptions = { ...this.options }
    for (const [key, value] of Object.entries(patch) as [keyof FileAccessOptions, unknown][]) {
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(`file access option ${String(key)} must be a finite positive number`)
      }
      next[key] = value
    }
    this.options = next
    // The isolated workers must be able to hold the scheduled concurrency.
    getProjectIo().configure(this.options.concurrency)
  }

  effectiveOptions(): FileAccessOptions {
    return { ...this.options }
  }

  // -- context / entries ---------------------------------------------------

  private groupFor(name: string): StorageGroup {
    let group = this.groups.get(name)
    if (group === undefined) {
      group = { name, active: 0, queue: [], tasks: new Map(), writeWaiters: [] }
      this.groups.set(name, group)
    }
    return group
  }

  private entryFor(
    context: ProjectFileContext,
    operation: ObservedOperation,
    absolutePath: string,
  ): StoreEntry {
    const root = context.root
    const key = `${root}\u0000${operation}\u0000${absolutePath}`
    let entry = this.entries.get(key)
    if (entry === undefined) {
      const group = this.groupFor(context.storageGroup ?? 'default')
      const now = monotonic()
      entry = {
        key,
        root,
        group,
        operation,
        path: absolutePath,
        fingerprint: null,
        observationVersion: 0,
        completedAtWall: null,
        completedAtMono: null,
        intervalMs: this.options.fileMinMs,
        dueAtMono: now,
        failures: 0,
        error: null,
        cachedError: null,
        attentionGeneration: 0,
        mutationGeneration: 0,
        lastAttentionAtWall: 0,
        refreshRequested: false,
        persist: null,
        persistLoaded: false,
        persistLoad: null,
      }
    } else {
      // Keep metadata in demand order without putting queued work in an LRU.
      this.entries.delete(key)
    }
    this.entries.set(key, entry)
    return entry
  }

  /**
   * Freshness lifetime for one operation.
   *
   * Content, listing and metadata observations of a path share one explicit
   * TTL class: 30s under `docs/wiki`, 30 minutes for every other cached
   * document or listing path by default. Opening or focusing a page inside
   * that window therefore costs no physical I/O at all, and a restored
   * persistent row follows the same rule. Only `realpath` keeps the adaptive
   * interval, which backs off while nothing changes and drops to its floor
   * while a person is on the page.
   */
  private intervalRange(entry: StoreEntry): [number, number] {
    if (entry.persist !== null && isPersistedOperation(entry.operation)) {
      const ttl = projectFileTtlMs(entry.root, entry.path)
      return [ttl, ttl]
    }
    const active = Date.now() - entry.lastAttentionAtWall <= this.options.leaseMs
    if (!active) return [this.options.maintenanceMinMs, this.options.maintenanceMaxMs]
    if (entry.operation === 'readdir') {
      return [this.options.directoryMinMs, this.options.directoryMaxMs]
    }
    return [this.options.fileMinMs, this.options.fileMaxMs]
  }

  private touchAttention(context: ProjectFileContext, entry: StoreEntry): void {
    const human = isHumanFileOperationReason(context.reason)
    const attentionId = context.attentionId
    if (attentionId === undefined) {
      if (human) entry.lastAttentionAtWall = Date.now()
      return
    }
    const now = Date.now()
    entry.lastAttentionAtWall = now
    this.sweepAttentions(now)
    // Namespaced by root: the same page id used against two projects must not
    // merge (or lose) their dependency sets.
    const leaseKey = `${context.root}\u0000${attentionId}`
    let lease = this.attentions.get(leaseKey)
    if (lease === undefined) {
      lease = { root: context.root, expiresAtWall: 0, keys: new Set() }
      this.attentions.set(leaseKey, lease)
    }
    lease.expiresAtWall = now + this.options.leaseMs
    if (lease.keys.size < MAX_ATTENTION_KEYS) lease.keys.add(entry.key)
  }

  private sweepAttentions(now: number): void {
    if (now - this.lastAttentionSweepWall < ATTENTION_SWEEP_INTERVAL_MS) return
    this.lastAttentionSweepWall = now
    for (const [id, lease] of this.attentions) {
      if (lease.expiresAtWall < now) this.attentions.delete(id)
    }
  }

  /**
   * Explicit refresh (or a write): discard the current freshness lifetime and
   * make the operation due now. Never postpones an existing due time, and
   * bumps the attention generation so an older automatic completion cannot
   * undo the reset.
   */
  private resetSchedule(entry: StoreEntry): void {
    entry.attentionGeneration += 1
    entry.refreshRequested = true
    entry.intervalMs = this.intervalRange(entry)[0]
    entry.failures = 0
    entry.dueAtMono = Math.min(entry.dueAtMono, monotonic())
  }

  /**
   * True the first time this request touches an operation key. The set is held
   * against the request's context object, so it disappears with the request; a
   * bounded size keeps a very wide composition from retaining an unbounded key
   * set (further keys simply do not reset again).
   */
  private firstTouchInRequest(context: ProjectFileContext, key: string): boolean {
    let touched = this.contextResets.get(context)
    if (touched === undefined) {
      touched = new Set()
      this.contextResets.set(context, touched)
    }
    if (touched.has(key)) return false
    if (touched.size >= MAX_ATTENTION_KEYS) return false
    touched.add(key)
    return true
  }

  // -- observation ---------------------------------------------------------

  private async observe(
    context: ProjectFileContext,
    operation: ObservedOperation,
    absolutePath: string,
    runner: () => Promise<Observation>,
  ): Promise<Observation> {
    const entry = this.entryFor(context, operation, absolutePath)
    const human = isHumanFileOperationReason(context.reason)
    const origin: FileOperationOrigin = human ? 'human' : 'automatic'
    this.touchAttention(context, entry)
    // Startup has already loaded completed snapshots into memory. The first
    // demand adopts only this key, without loading any project files.
    if (!this.observations.has(entry.key) && !entry.persistLoaded) {
      await this.restorePersisted(context, entry)
    }
    // Only eligible persisted observations use the SSHFS TTL policy.
    // Memory-only projects retain their configured attention/backoff behavior.
    if (
      (RESET_REASON[context.reason ?? 'automatic'] || (human && entry.persist === null)) &&
      this.firstTouchInRequest(context, entry.key)
    ) {
      this.resetSchedule(entry)
    }

    const now = monotonic()
    const observation = this.observations.get(entry.key)
    if (observation !== undefined) {
      this.metrics.recordCacheHit(entry.group.name, operation, origin)
      if (now < entry.dueAtMono) return observation
      // Due but usable: answer from cache immediately and verify in the
      // background. This is what keeps warm requests off the disk entirely.
      void this.schedule(entry, operation, origin, human, runner).catch(() => undefined)
      return observation
    }

    if (entry.cachedError !== null && now < entry.dueAtMono) {
      this.metrics.recordCacheHit(entry.group.name, operation, origin)
      throw entry.cachedError
    }

    return await this.schedule(entry, operation, origin, human, runner)
  }

  // -- persistence ---------------------------------------------------------

  /**
   * Persistent scope for a context, or null when nothing may be persisted.
   *
   * Two conditions must both hold: the project opted in, and its configured
   * root actually sits on an SSHFS mount (the OS-local mount table decides —
   * never a path shape, and never a remote `realpath`). A local project is
   * therefore never written to the dump, and a valid restored answer never
   * waits on remote resolution.
   */
  private async persistence(context: ProjectFileContext): Promise<PersistScope | null> {
    if (context.persistentCache !== true) return null
    const cache = getProjectFileCache()
    if (cache === null) return null
    const table = await this.mountTable()
    if (table === null) return null
    const mount = containingMount(context.root, table)
    if (mount === undefined || mount.fsType !== SSHFS_FS_TYPE) return null

    const memo = this.persistScopes.get(context.root)
    if (memo !== undefined && memo.mount !== null && sameMountIdentity(memo.mount, mount)) {
      const scope = await memo.scope
      if (scope === null || scope.cache === cache) return scope
    }
    // A different mount identity (or reconfigured dump) is a different
    // namespace: previous storage observations stay unreachable.
    const resolving = cache
      .namespaceId({ root: context.root, mount })
      .then((namespaceId) => ({ cache, namespaceId, mount }))
      // Persistence is an optimisation: failure degrades to memory-only
      // behaviour instead of failing the project read.
      .catch(() => null)
    this.persistScopes.set(context.root, { mount, scope: resolving })
    return await resolving
  }

  /**
   * Adopt one completed answer from the snapshot-backed memory LRU. It
   * carries the original observation time, so freshness stays honest across
   * restart instead of pretending the process just looked.
   */
  private async restorePersisted(context: ProjectFileContext, entry: StoreEntry): Promise<void> {
    if (entry.persistLoad !== null) {
      await entry.persistLoad
      return
    }
    const operation = entry.operation
    if (!isPersistedOperation(operation)) {
      entry.persistLoaded = true
      return
    }
    const generation = entry.mutationGeneration
    const load = this.loadPersisted(context, entry, operation, generation)
      .catch(() => undefined)
      .then(() => {
        entry.persistLoaded = true
        entry.persistLoad = null
      })
    entry.persistLoad = load
    await load
  }

  private async loadPersisted(
    context: ProjectFileContext,
    entry: StoreEntry,
    operation: PersistedOperation,
    generation: number,
  ): Promise<void> {
    const scope = await this.persistence(context)
    entry.persist = scope
    if (scope === null) return
    await this.persistTail
    const stored = await scope.cache.load(scope.namespaceId, operation, entry.path)
    if (stored === null) return
    const observation = observationFromPersisted(stored.payload, entry.path)
    if (observation.fingerprint !== stored.fingerprint) {
      // The payload does not match its own fingerprint: an unusable row is
      // dropped rather than served as a half-understood answer.
      this.enqueuePersist(() => scope.cache.delete(scope.namespaceId, operation, entry.path))
      return
    }
    // An invalidation or a physical observation that landed while this row was
    // being read wins: a restored row must never resurrect superseded state.
    if (entry.mutationGeneration !== generation || this.observations.has(entry.key)) return

    const ttl = projectFileTtlMs(entry.root, entry.path)
    const age = Math.max(0, Date.now() - stored.observedAtWall)
    const now = monotonic()
    this.cacheObservation(entry, observation)
    entry.fingerprint = observation.fingerprint
    entry.observationVersion += 1
    entry.completedAtWall = stored.observedAtWall
    entry.completedAtMono = now - age
    entry.intervalMs = ttl
    // Inside the lifetime the row answers with no physical I/O at all; past
    // it — or when an explicit refresh is still waiting for a real look — the
    // row still answers immediately and one background verification is
    // scheduled, which is what keeps a hung mount from blocking a page.
    entry.dueAtMono = entry.refreshRequested || age >= ttl ? now : now + (ttl - age)
  }

  /**
   * Store a completed successful observation. Only the operations whose data
   * was actually observed are persisted; nothing about the queue, the waiters,
   * the leases or the retry state ever reaches the dump.
   */
  private persistObservation(entry: StoreEntry, observation: Observation): void {
    const scope = entry.persist
    if (scope === null) return
    const operation = entry.operation
    if (!isPersistedOperation(operation)) return
    const payload = persistedPayloadOf(observation)
    if (payload === null) return
    const observedAtWall = entry.completedAtWall ?? Date.now()
    this.enqueuePersist(() =>
      scope.cache.put(scope.namespaceId, operation, entry.path, {
        payload,
        fingerprint: observation.fingerprint,
        observedAtWall,
      }),
    )
  }

  /**
   * Order one persistent-cache mutation behind every mutation issued before
   * it, so a delete caused by an invalidation cannot be overtaken by an older
   * observation's write.
   */
  private enqueuePersist(work: () => Promise<void>): void {
    this.persistTail = this.persistTail.then(work, work).then(
      () => undefined,
      () => undefined,
    )
  }

  /**
   * Forget every persisted observation of one path (and of its parent
   * listing): the content is known to have changed, so leaving a row would let
   * a later process serve a value that was already superseded here.
   */
  private forgetPersistedPath(root: string, absolutePath: string): void {
    const memo = this.persistScopes.get(root)
    if (memo === undefined) return
    const parent = dirname(absolutePath)
    this.enqueuePersist(async () => {
      const scope = await memo.scope
      if (scope === null) return
      await scope.cache.deletePath(scope.namespaceId, absolutePath)
      if (parent !== absolutePath) {
        await scope.cache.delete(scope.namespaceId, 'readdir', parent)
      }
    })
  }

  private schedule(
    entry: StoreEntry,
    operation: FileOperationName,
    origin: FileOperationOrigin,
    human: boolean,
    runner: () => Promise<Observation>,
  ): Promise<Observation> {
    const group = entry.group
    const existing = group.tasks.get(entry.key)
    if (existing !== undefined && existing.mutationGeneration === entry.mutationGeneration) {
      if (human && !existing.human) {
        // Promote the pending automatic task instead of adding a second one.
        existing.human = true
        existing.origin = 'human'
        existing.attentionGeneration = entry.attentionGeneration
      }
      this.metrics.recordCoalesced(group.name, operation, origin)
      return existing.promise
    }

    // Bounded pending work: in-flight operations are capped by the group
    // concurrency, but a blocked mount would otherwise let the queue grow
    // without limit. Human demand may displace the oldest automatic task;
    // automatic demand is refused outright (an honest error, never a
    // fabricated missing result).
    if (group.queue.length >= MAX_QUEUED_PER_GROUP) {
      const displaced = human ? this.takeOldestAutomatic(group) : undefined
      if (displaced === undefined) {
        return Promise.reject(queueFullError(entry.path))
      }
      this.settle(displaced, null, queueFullError(displaced.entry.path))
    }

    let resolveFn!: (observation: Observation) => void
    let rejectFn!: (error: unknown) => void
    const promise = new Promise<Observation>((res, rej) => {
      resolveFn = res
      rejectFn = rej
    })
    const task: ScheduledTask = {
      key: entry.key,
      entry,
      group,
      operation,
      human,
      origin,
      enqueuedAtMono: monotonic(),
      startedAtMono: null,
      attentionGeneration: entry.attentionGeneration,
      mutationGeneration: entry.mutationGeneration,
      state: 'queued',
      runner,
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    }
    group.tasks.set(entry.key, task)
    group.queue.push(task)
    this.dispatch(group)
    return promise
  }

  /** Automatic work older than this is treated as human-priority (anti-starvation). */
  private agingMs(): number {
    return Math.max(1_000, this.options.heartbeatMs * 5)
  }

  /** Remove the oldest queued automatic task so a human caller can enqueue. */
  private takeOldestAutomatic(group: StorageGroup): ScheduledTask | undefined {
    let index = -1
    let oldest = Number.POSITIVE_INFINITY
    for (let i = 0; i < group.queue.length; i += 1) {
      const task = group.queue[i]!
      if (task.human) continue
      if (task.enqueuedAtMono < oldest) {
        oldest = task.enqueuedAtMono
        index = i
      }
    }
    if (index < 0) return undefined
    return group.queue.splice(index, 1)[0]
  }

  private takeNext(group: StorageGroup): ScheduledTask | undefined {
    const now = monotonic()
    const aging = this.agingMs()
    let bestIndex = -1
    let bestPriority = -1
    let bestEnqueued = Number.POSITIVE_INFINITY
    for (let i = 0; i < group.queue.length; i += 1) {
      const task = group.queue[i]!
      const priority = task.human || now - task.enqueuedAtMono >= aging ? 1 : 0
      if (
        priority > bestPriority ||
        (priority === bestPriority && task.enqueuedAtMono < bestEnqueued)
      ) {
        bestIndex = i
        bestPriority = priority
        bestEnqueued = task.enqueuedAtMono
      }
    }
    if (bestIndex < 0) return undefined
    return group.queue.splice(bestIndex, 1)[0]
  }

  private dispatch(group: StorageGroup): void {
    while (group.queue.length > 0 && group.active < this.options.concurrency) {
      const task = this.takeNext(group)
      if (task === undefined) return
      const entry = task.entry
      const now = monotonic()
      const observation = this.observations.get(entry.key)
      if (
        observation !== undefined &&
        now < entry.dueAtMono &&
        entry.mutationGeneration === task.mutationGeneration
      ) {
        // Another completion already satisfied this key while it waited.
        task.startedAtMono = now
        this.metrics.recordCacheHit(group.name, task.operation, task.origin)
        this.settle(task, observation, null)
        continue
      }
      group.active += 1
      void this.execute(task)
    }
  }

  private async execute(task: ScheduledTask): Promise<void> {
    const entry = task.entry
    const group = task.group
    task.state = 'running'
    task.startedAtMono = monotonic()
    const waitMs = task.startedAtMono - task.enqueuedAtMono
    try {
      const observation = await task.runner()
      const completedMono = monotonic()
      this.applySuccess(entry, task, observation, completedMono)
      this.metrics.recordOperation(group.name, task.operation, task.origin, {
        waitMs,
        execMs: completedMono - task.startedAtMono,
        bytes: observation.bytes,
        error: false,
      })
      this.release(group)
      this.settle(task, observation, null)
    } catch (error) {
      const completedMono = monotonic()
      this.applyFailure(entry, error as NodeJS.ErrnoException)
      this.metrics.recordOperation(group.name, task.operation, task.origin, {
        waitMs,
        execMs: completedMono - task.startedAtMono,
        bytes: 0,
        error: true,
      })
      this.release(group)
      this.settle(task, null, error)
    }
    this.enforceMemoryBounds()
  }

  private settle(task: ScheduledTask, observation: Observation | null, error: unknown): void {
    if (task.group.tasks.get(task.key) === task) task.group.tasks.delete(task.key)
    if (observation !== null) task.resolve(observation)
    else task.reject(error)
  }

  private applySuccess(
    entry: StoreEntry,
    task: ScheduledTask,
    observation: Observation,
    completedMono: number,
  ): void {
    entry.error = null
    entry.cachedError = null
    entry.failures = 0

    if (entry.mutationGeneration !== task.mutationGeneration) {
      // A central write landed while this read was in flight: the caller still
      // gets the bytes it observed, but the newer cache state stands — and
      // nothing is persisted, so the superseded content cannot come back
      // after a restart.
      return
    }

    // A real physical look answered any pending refresh request.
    entry.refreshRequested = false
    const first = entry.fingerprint === null
    const changed = !first && entry.fingerprint !== observation.fingerprint
    if (first || changed) entry.observationVersion += 1
    entry.fingerprint = observation.fingerprint

    this.cacheObservation(entry, observation)

    entry.completedAtWall = Date.now()
    entry.completedAtMono = completedMono

    const [base, cap] = this.intervalRange(entry)
    if (first || changed) {
      entry.intervalMs = base
    } else if (task.attentionGeneration === entry.attentionGeneration) {
      entry.intervalMs = Math.min(
        Math.max(entry.intervalMs, base) * this.options.backoffFactor,
        cap,
      )
    } else {
      // A newer human reset happened while this automatic check ran.
      entry.intervalMs = base
    }
    entry.dueAtMono = completedMono + entry.intervalMs

    // Only now, with the observation accepted as the current state, does it
    // reach the persistent cache.
    this.persistObservation(entry, observation)
  }

  private applyFailure(entry: StoreEntry, error: NodeJS.ErrnoException): void {
    entry.failures += 1
    entry.error = typeof error.code === 'string' && error.code.length > 0 ? error.code : 'EUNKNOWN'
    if (!this.observations.has(entry.key)) entry.cachedError = error
    const backoff = Math.min(
      this.options.failureMinMs * this.options.backoffFactor ** (entry.failures - 1),
      this.options.failureMaxMs,
    )
    // Successful observation time is untouched: a failure never advances it.
    entry.dueAtMono = monotonic() + backoff
  }

  // -- memory bounds -------------------------------------------------------

  private enforceMemoryBounds(): void {
    // Completed values have their own O(1) LRU bounds. Scheduler metadata
    // may be dropped only when no queued/running task still owns the entry.
    if (this.entries.size <= MAX_CACHE_ENTRIES) return
    for (const [key, entry] of this.entries) {
      if (entry.group.tasks.has(key)) continue
      this.releaseContent(entry)
      this.entries.delete(key)
      if (this.entries.size <= MAX_CACHE_ENTRIES) break
    }
  }

  private cacheObservation(entry: StoreEntry, observation: Observation): void {
    if (observation.bytes > MAX_CACHED_CONTENT_BYTES) {
      this.observations.delete(entry.key)
      return
    }
    const previous = this.observations.peek(entry.key)
    this.observations.set(entry.key, observation)
    if (previous !== observation) this.cachedContentBytes += observation.bytes
  }

  /**
   * Drop the cached observation while keeping the fingerprint/timestamps. The
   * path is NOT interpreted as deleted; the next demand reads it again.
   */
  private releaseContent(entry: StoreEntry): void {
    this.observations.delete(entry.key)
  }

  // -- invalidation --------------------------------------------------------

  /**
   * Drop cached observations.
   *
   * With a `path` the content is known to have changed (a write, a delete, a
   * rename): the persisted rows for that path and its parent listing are
   * removed too, whether or not this process happens to hold a memory entry
   * for them, so no later process can serve the superseded value.
   *
   * Without a path this is a "something in this project changed" signal. The
   * memory entries are released and re-verified on demand, while the persisted
   * rows are kept: each remains the last observation that really succeeded,
   * with its true timestamp, and re-reading a whole project's worth of files
   * just to answer a structural signal is exactly the cost this cache exists
   * to avoid.
   */
  invalidate(root: string, path?: string): void {
    const normalizedRoot = resolve(root)
    invalidateGitOperations(normalizedRoot)
    if (path === undefined) {
      for (const entry of this.entries.values()) {
        if (entry.root === normalizedRoot) this.invalidateEntry(entry)
      }
      return
    }
    const absolutePath = resolve(path)
    for (const operation of ['readFile', 'stat', 'lstat', 'realpath', 'readdir'] as const) {
      const entry = this.entries.get(`${normalizedRoot}\u0000${operation}\u0000${absolutePath}`)
      if (entry !== undefined) this.invalidateEntry(entry)
    }
    const parent = dirname(absolutePath)
    if (parent !== absolutePath) {
      const parentEntry = this.entries.get(`${normalizedRoot}\u0000readdir\u0000${parent}`)
      if (parentEntry !== undefined) this.invalidateEntry(parentEntry)
    }
    this.forgetPersistedPath(normalizedRoot, absolutePath)
  }

  private invalidateEntry(entry: StoreEntry): void {
    this.releaseContent(entry)
    entry.mutationGeneration += 1
    entry.dueAtMono = monotonic()
    entry.error = null
    entry.cachedError = null
    entry.failures = 0
    // The persisted row must not be re-loaded into the state this
    // invalidation just discarded; the next demand observes the path.
    entry.persistLoaded = true
  }

  /** Adopt a just-written body as the current observation for the path. */
  private adoptWrittenContent(root: string, absolutePath: string, bytes: Buffer): void {
    const key = `${root}\u0000readFile\u0000${absolutePath}`
    const entry = this.entries.get(key)
    if (entry === undefined) return
    const observation = fileObservation(bytes)
    if (entry.fingerprint !== observation.fingerprint) entry.observationVersion += 1
    entry.fingerprint = observation.fingerprint
    this.cacheObservation(entry, observation)
    entry.completedAtWall = Date.now()
    entry.completedAtMono = monotonic()
    entry.intervalMs = this.intervalRange(entry)[0]
    entry.dueAtMono = entry.completedAtMono + entry.intervalMs
    // This process wrote the bytes, so nothing is pending verification.
    entry.refreshRequested = false
    // Write-through: the bytes this process just wrote are the observation,
    // and they are ordered behind the invalidation the write already issued.
    this.persistObservation(entry, observation)
  }

  /**
   * Record how a root's files are reached, so freshness reporting can
   * describe a direct root that owns no scheduler state at all.
   */
  noteStorage(root: string, storage: ProjectFileContext['storage']): void {
    if (storage === 'local') this.directRoots.add(root)
    else this.directRoots.delete(root)
  }

  // -- status / metrics ----------------------------------------------------

  status(root: string, attentionId?: string): ProjectFileStatus {
    const normalizedRoot = resolve(root)
    const now = Date.now()
    this.sweepAttentions(now)
    // A direct root has no queue, no lease and no observation vector: every
    // read already came from the filesystem at request time.
    if (this.directRoots.has(normalizedRoot)) {
      return {
        epoch: this.epoch,
        oldestVerifiedAt: null,
        incomplete: false,
        queued: 0,
        checking: 0,
        error: null,
        version: 'direct',
        direct: true,
      }
    }

    let scoped: StoreEntry[] | null = null
    if (attentionId !== undefined) {
      const lease = this.attentions.get(`${normalizedRoot}\u0000${attentionId}`)
      if (lease !== undefined && lease.expiresAtWall >= now) {
        scoped = []
        for (const key of lease.keys) {
          const entry = this.entries.get(key)
          if (entry !== undefined && entry.root === normalizedRoot) scoped.push(entry)
        }
      }
    }
    const entries =
      scoped ?? [...this.entries.values()].filter((entry) => entry.root === normalizedRoot)

    let oldestVerifiedAt: number | null = null
    // Nothing observed yet for this scope is an honestly incomplete freshness
    // claim, not "verified with no dependencies".
    let incomplete = entries.length === 0
    let error: string | null = null
    const version = createHash('sha1')
    version.update(this.epoch)
    for (const entry of entries.slice().sort((a, b) => a.key.localeCompare(b.key))) {
      if (entry.completedAtWall === null) {
        incomplete = true
      } else if (oldestVerifiedAt === null || entry.completedAtWall < oldestVerifiedAt) {
        oldestVerifiedAt = entry.completedAtWall
      }
      if (error === null && entry.error !== null) error = entry.error
      version.update(`${entry.key}:${entry.observationVersion}\u0000`)
    }

    let queued = 0
    let checking = 0
    const scopedKeys = scoped === null ? null : new Set(scoped.map((entry) => entry.key))
    for (const group of this.groups.values()) {
      for (const task of group.tasks.values()) {
        if (task.entry.root !== normalizedRoot) continue
        if (scopedKeys !== null && !scopedKeys.has(task.key)) continue
        if (task.state === 'running') checking += 1
        else queued += 1
      }
    }

    return {
      epoch: this.epoch,
      oldestVerifiedAt,
      incomplete,
      queued,
      checking,
      error,
      version: version.digest('hex').slice(0, 32),
    }
  }

  metricsSnapshot(windowMs?: number): FileOperationMetrics {
    const requested = windowMs ?? 300_000
    const effectiveWindow = Math.min(
      Math.max(requested, METRIC_BUCKET_MS),
      METRIC_BUCKET_MS * METRIC_BUCKET_COUNT,
    )
    const rolled = this.metrics.snapshot(effectiveWindow)
    const now = monotonic()

    let inFlight = 0
    let queued = 0
    let oldestWaitingAgeMs: number | null = null
    const groups: FileOperationGroupState[] = []
    for (const group of this.groups.values()) {
      let groupQueued = group.writeWaiters.length
      let groupOldest: number | null = null
      for (const task of group.queue) {
        groupQueued += 1
        const age = now - task.enqueuedAtMono
        if (groupOldest === null || age > groupOldest) groupOldest = age
      }
      inFlight += group.active
      queued += groupQueued
      if (
        groupOldest !== null &&
        (oldestWaitingAgeMs === null || groupOldest > oldestWaitingAgeMs)
      ) {
        oldestWaitingAgeMs = groupOldest
      }
      groups.push({
        storageGroup: group.name,
        concurrency: this.options.concurrency,
        inFlight: group.active,
        queued: groupQueued,
        oldestWaitingAgeMs: groupOldest === null ? null : round3(groupOldest),
      })
    }
    groups.sort((a, b) => a.storageGroup.localeCompare(b.storageGroup))

    return {
      epoch: this.epoch,
      generatedAt: formatIsoLocal(new Date()),
      windowMs: effectiveWindow,
      availableWindowsMs: [...METRIC_WINDOWS_MS],
      options: this.effectiveOptions(),
      overall: rolled.overall,
      byOrigin: rolled.byOrigin,
      byOperation: rolled.byOperation,
      series: rolled.series,
      groups,
      inFlight,
      queued,
      oldestWaitingAgeMs: oldestWaitingAgeMs === null ? null : round3(oldestWaitingAgeMs),
      cacheEntries: this.observations.size,
      cachedContentBytes: this.cachedContentBytes,
    }
  }

  // -- primitive operations ------------------------------------------------

  /**
   * Real path of a project root, observed once per process, in the storage
   * group's isolated worker. Roots are stable mounts; resolving them per read
   * would add metadata I/O to every operation. A genuinely missing root is NOT
   * cached (it may come back) and keeps the lexical path so ordinary missing
   * states still work; an access/transport error propagates instead of being
   * frozen into a lexical fallback.
   */
  private async realRoot(root: string, group: string): Promise<string> {
    const cached = this.realRoots.get(root)
    if (cached !== undefined) return cached
    try {
      const real = await getProjectIo().realpath(group, root)
      this.realRoots.set(root, real)
      return real
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return root
      throw error
    }
  }

  /**
   * Mount-identity guard for the storage behind a root.
   *
   * When an SSHFS mount disappears its mountpoint often reverts to an
   * ordinary empty local directory, which would otherwise be published as a
   * project whose files were all deleted. The guard remembers the mountpoint,
   * filesystem type and source observed for a root and refuses project I/O
   * once that identity is gone or replaced. A remount with the same
   * source/type is accepted (the kernel mount id intentionally is not
   * compared). The table comes from the OS-local `/proc/self/mountinfo` with a
   * short TTL, so there is no per-file remote metadata traffic; on a platform
   * without that file the guard is inert.
   */
  private async assertMountIdentity(rootReal: string, syscall: string): Promise<void> {
    const table = await this.mountTable()
    if (table === null) return
    const known = this.rootMounts.get(rootReal)
    if (known === undefined) {
      const observed = containingMount(rootReal, table)
      if (observed !== undefined) this.rootMounts.set(rootReal, observed)
      return
    }
    // Identity is the (mountpoint, type, source) tuple: a remount of the same
    // storage still matches (kernel mount ids are deliberately ignored), while
    // an unmounted or replaced mountpoint no longer appears at all.
    const alive = table.some((entry) => sameMountIdentity(entry, known))
    if (!alive) throw mountUnavailableError(syscall, rootReal)
    // A newly added mount at or under the root (storage mounted after the
    // first observation) becomes the identity to watch from now on.
    const current = containingMount(rootReal, table)
    if (current !== undefined && current.mountPoint.length > known.mountPoint.length) {
      this.rootMounts.set(rootReal, current)
    }
  }

  /** `/proc/self/mountinfo` snapshot, shared and refreshed on a short TTL. */
  private async mountTable(): Promise<MountIdentity[] | null> {
    const now = monotonic()
    if (this.mountTableAtMono !== null && now - this.mountTableAtMono < MOUNT_TABLE_TTL_MS) {
      return this.mountTableEntries
    }
    if (this.mountTableRead === null) {
      this.mountTableRead = readMountTable().then((entries) => {
        this.mountTableEntries = entries
        this.mountTableAtMono = monotonic()
        this.mountTableRead = null
        return entries
      })
    }
    return await this.mountTableRead
  }

  /** The storage group a context's physical work belongs to. */
  private groupName(context: ProjectFileContext): string {
    return context.storageGroup ?? 'default'
  }

  /**
   * Symlink containment for one target, executed inside the scheduled
   * operation (never on a cache hit) so a `docs/` symlink cannot redirect a
   * lexically contained path outside the project root. The mount identity of
   * the root is verified in the same step, before any project I/O runs, and
   * the physical resolution happens in the group's isolated worker.
   */
  async containedTarget(
    context: ProjectFileContext,
    absolutePath: string,
    syscall: string,
    keepFinalLink = false,
  ): Promise<string> {
    const group = this.groupName(context)
    const rootReal = await this.realRoot(context.root, group)
    await this.assertMountIdentity(rootReal, syscall)
    return await containedRealPath(rootReal, absolutePath, syscall, keepFinalLink, (path) =>
      getProjectIo().realpathNearest(group, path),
    )
  }

  /**
   * Each primitive returns the narrowed present value. A successful "missing"
   * observation replays its original ENOENT/ENOTDIR error so callers keep
   * their existing `err.code` handling.
   */
  async readFileValue(context: ProjectFileContext, absolutePath: string): Promise<FileValue> {
    const observation = await this.observe(context, 'readFile', absolutePath, async () => {
      try {
        const target = await this.containedTarget(context, absolutePath, 'readFile')
        return fileObservation(await getProjectIo().readFile(this.groupName(context), target))
      } catch (error) {
        return toNegativeOrThrow(error)
      }
    })
    const value = observation.value
    if (value === null || value.kind !== 'file') throw missingErrorOf(observation, absolutePath)
    return value
  }

  async listDirValue(context: ProjectFileContext, absolutePath: string): Promise<DirValue> {
    const observation = await this.observe(context, 'readdir', absolutePath, async () => {
      try {
        const target = await this.containedTarget(context, absolutePath, 'readdir')
        return dirObservation(await getProjectIo().readdir(this.groupName(context), target))
      } catch (error) {
        return toNegativeOrThrow(error)
      }
    })
    const value = observation.value
    if (value === null || value.kind !== 'dir') throw missingErrorOf(observation, absolutePath)
    return value
  }

  async statValue(
    context: ProjectFileContext,
    absolutePath: string,
    operation: 'stat' | 'lstat',
  ): Promise<Stats> {
    const observation = await this.observe(context, operation, absolutePath, async () => {
      try {
        // `lstat` must observe the link itself, so only its parent chain is
        // resolved for containment.
        const target = await this.containedTarget(
          context,
          absolutePath,
          operation,
          operation === 'lstat',
        )
        return statObservation(
          await getProjectIo().stat(this.groupName(context), target, operation === 'stat'),
        )
      } catch (error) {
        return toNegativeOrThrow(error)
      }
    })
    const value = observation.value
    if (value === null || value.kind !== 'stat') throw missingErrorOf(observation, absolutePath)
    return value.stats
  }

  async realpathValue(context: ProjectFileContext, absolutePath: string): Promise<string> {
    const observation = await this.observe(context, 'realpath', absolutePath, async () => {
      try {
        const group = this.groupName(context)
        const rootReal = await this.realRoot(context.root, group)
        await this.assertMountIdentity(rootReal, 'realpath')
        // Unlike creation/read containment, realpath requires an existing target.
        // Resolve it once and use that same canonical answer for containment.
        const target = await containedRealPath(rootReal, absolutePath, 'realpath', false, (path) =>
          getProjectIo().realpath(group, path),
        )
        return pathObservation(target)
      } catch (error) {
        return toNegativeOrThrow(error)
      }
    })
    const value = observation.value
    if (value === null || value.kind !== 'path') throw missingErrorOf(observation, absolutePath)
    return value.target
  }

  /** Uncached physical reads (distinct fs semantics) still run isolated. */
  async rawReadFile(
    context: ProjectFileContext,
    absolutePath: string,
    flag?: string,
  ): Promise<Buffer> {
    const target = await this.containedTarget(context, absolutePath, 'readFile')
    return await getProjectIo().readFile(this.groupName(context), target, flag)
  }

  async rawStat(
    context: ProjectFileContext,
    absolutePath: string,
    operation: 'stat' | 'lstat',
  ): Promise<Stats> {
    const target = await this.containedTarget(
      context,
      absolutePath,
      operation,
      operation === 'lstat',
    )
    const fields = await getProjectIo().stat(
      this.groupName(context),
      target,
      operation === 'stat',
      true,
    )
    return new ProjectStats(fields) as unknown as Stats
  }

  async rawAccess(context: ProjectFileContext, absolutePath: string, mode: number): Promise<void> {
    const target = await this.containedTarget(context, absolutePath, 'access')
    await getProjectIo().access(this.groupName(context), target, mode)
  }

  /**
   * Run a mutation: enforce read-only policy, verify every source and
   * destination stays inside the project root through symlinks, invalidate
   * before and after so a pre-write in-flight read cannot install its older
   * bytes, account the physical work in the same group budget as reads, and
   * execute it in the group's isolated worker like every other physical
   * operation.
   */
  async mutate(
    context: ProjectFileContext,
    syscall: string,
    paths: string[],
    method: MutationMethod,
    args: unknown[],
  ): Promise<unknown> {
    if (context.readOnly === true) throw readOnlyError(syscall, paths[0] ?? context.root)
    for (const path of paths) {
      if (!isWithinPath(context.root, path)) throw containmentError(syscall, path, context.root)
    }
    for (const path of paths) this.invalidate(context.root, path)

    const group = this.groupFor(this.groupName(context))
    const enqueuedAtMono = monotonic()
    await this.acquire(group)
    const startedAtMono = monotonic()
    try {
      // Symlink containment for the real targets, inside the slot: a linked
      // destination must not let a write land outside the root.
      for (const path of paths) await this.containedTarget(context, path, syscall)
      const result = await getProjectIo().mutate(group.name, method, args)
      this.metrics.recordOperation(group.name, 'write', 'human', {
        waitMs: startedAtMono - enqueuedAtMono,
        execMs: monotonic() - startedAtMono,
        bytes: 0,
        error: false,
      })
      return result
    } catch (error) {
      this.metrics.recordOperation(group.name, 'write', 'human', {
        waitMs: startedAtMono - enqueuedAtMono,
        execMs: monotonic() - startedAtMono,
        bytes: 0,
        error: true,
      })
      throw error
    } finally {
      for (const path of paths) this.invalidate(context.root, path)
      this.release(group)
    }
  }

  adoptWrite(context: ProjectFileContext, absolutePath: string, bytes: Buffer): void {
    this.adoptWrittenContent(context.root, absolutePath, bytes)
  }

  /**
   * Take a slot in the group budget for a physical mutation. Mutations are
   * never coalesced, so they queue on their own waiter list and are granted
   * ahead of pending reads when a slot frees.
   */
  private acquire(group: StorageGroup): Promise<void> {
    if (group.active < this.options.concurrency) {
      group.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((grant) => {
      group.writeWaiters.push(grant)
    })
  }

  /** Release one slot, handing it to a waiting mutation before queued reads. */
  private release(group: StorageGroup): void {
    const waiter = group.writeWaiters.shift()
    if (waiter !== undefined) {
      waiter()
      return
    }
    group.active -= 1
    this.dispatch(group)
  }
}

/** ENOENT / ENOTDIR are successful negative observations; everything else is an error. */
function toNegativeOrThrow(error: unknown): Observation {
  const err = error as NodeJS.ErrnoException
  if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return missingObservation(err)
  throw err
}

/** The replayable negative error for a cached-missing observation. */
function missingErrorOf(observation: Observation, absolutePath: string): NodeJS.ErrnoException {
  if (observation.missingError !== null) return observation.missingError
  const error = new Error(
    `ENOENT: no such file or directory, access '${absolutePath}'`,
  ) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  error.errno = -2
  error.syscall = 'access'
  error.path = absolutePath
  return error
}

// ---------------------------------------------------------------------------
// Process-global singleton (survives duplicated Next.js server bundles)
// ---------------------------------------------------------------------------

const STORE_SYMBOL = Symbol.for('memon.project-file-store.v2')

interface StoreCarrier {
  [STORE_SYMBOL]?: ProjectFileStore
}

function getStore(): ProjectFileStore {
  const carrier = globalThis as unknown as StoreCarrier
  let store = carrier[STORE_SYMBOL]
  if (store === undefined) {
    store = new ProjectFileStore()
    carrier[STORE_SYMBOL] = store
  }
  return store
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export function withProjectFileContext<T>(
  context: ProjectFileContext,
  callback: () => Promise<T>,
): Promise<T> {
  const store = getStore()
  const normalized: ProjectFileContext = { ...context, root: resolve(context.root) }
  store.noteStorage(normalized.root, normalized.storage)
  return store.contextStorage.run(normalized, callback)
}

/** The active context, or undefined when running outside one (CLI, scripts). */
export function getProjectFileContext(): ProjectFileContext | undefined {
  return getStore().contextStorage.getStore()
}

export function configureProjectFileStore(options: Partial<FileAccessOptions>): void {
  getStore().configure(options)
}

export function getProjectFileAccessOptions(): FileAccessOptions {
  return getStore().effectiveOptions()
}

export function getProjectFileStatus(root: string, attentionId?: string): ProjectFileStatus {
  return getStore().status(root, attentionId)
}

export function getFileOperationMetrics(windowMs?: number): FileOperationMetrics {
  return getStore().metricsSnapshot(windowMs)
}

export function invalidateProjectFile(root: string, path?: string): void {
  getStore().invalidate(root, path)
}

// ---------------------------------------------------------------------------
// The fs/promises-compatible facade
// ---------------------------------------------------------------------------

type ReadFileOptions = Parameters<typeof nodeFs.readFile>[1]
type ReaddirOptions = Parameters<typeof nodeFs.readdir>[1]

/** Read one option field without asserting a shape over the whole argument. */
function optionValue(options: unknown, key: string): unknown {
  if (typeof options !== 'object' || options === null) return undefined
  if (!(key in options)) return undefined
  return Reflect.get(options, key)
}

/** `'buffer'` is a valid fs encoding selector but not a `BufferEncoding`. */
type EncodingSelector = BufferEncoding | 'buffer' | null

function encodingOf(options: unknown): EncodingSelector {
  const raw = typeof options === 'string' ? options : optionValue(options, 'encoding')
  if (typeof raw !== 'string') return null
  if (raw === 'buffer') return 'buffer'
  // Node validates an unsupported encoding itself; narrowing here only selects
  // the decode path.
  const encoding = raw as BufferEncoding
  return encoding
}

/**
 * Only plain read-for-content calls are cacheable: an abort signal or a
 * non-default flag means the caller wants distinct filesystem semantics.
 */
function isCacheableReadFile(options: ReadFileOptions): boolean {
  if (options === undefined || options === null) return true
  if (typeof options === 'string') return true
  const signal = optionValue(options, 'signal')
  if (signal !== undefined && signal !== null) return false
  const flag = optionValue(options, 'flag')
  if (flag !== undefined && flag !== 'r') return false
  return true
}

function decodeFile(value: FileValue, encoding: EncodingSelector): string | Buffer {
  if (encoding === null || encoding === 'buffer') return Buffer.from(value.bytes)
  if (encoding === 'utf8' || encoding === 'utf-8') {
    if (value.text === undefined) value.text = value.bytes.toString('utf8')
    return value.text
  }
  return value.bytes.toString(encoding)
}

/**
 * Resolve the routing decision for a path. `null` means "no active context"
 * and the call delegates to the native filesystem (the CLI reads fresh).
 * Inside a context the decision fails closed: a path that is not lexically
 * inside the project root — or a target whose path cannot be determined —
 * is refused instead of silently reaching the filesystem unmediated.
 * `direct` marks a `storage: 'local'` context: contained and policed, but
 * performed on the native filesystem instead of the scheduler.
 */
function routable(
  target: PathLike,
  syscall: string,
): { context: ProjectFileContext; path: string; direct: boolean } | null {
  const context = getStore().contextStorage.getStore()
  if (context === undefined) return null
  const absolutePath = resolveTargetPath(target)
  if (absolutePath === null) throw containmentError(syscall, String(target), context.root)
  if (!isWithinPath(context.root, absolutePath)) {
    throw containmentError(syscall, absolutePath, context.root)
  }
  return { context, path: absolutePath, direct: context.storage === 'local' }
}

/**
 * Honour an abort signal while an isolated read runs. The physical operation
 * itself cannot be cancelled once started — a blocked syscall could not be
 * cancelled natively either — so the caller stops waiting while the worker
 * completes and releases its slot normally.
 */
function withAbort<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = (): Error => {
    const error = new Error('The operation was aborted', {
      cause: signal.reason,
    }) as NodeJS.ErrnoException
    error.name = 'AbortError'
    error.code = 'ABORT_ERR'
    return error
  }
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    work()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function facadeReadFile(
  target: PathLike,
  options?: ReadFileOptions,
): Promise<string | Buffer> {
  const routed = routable(target, 'readFile')
  if (routed === null || routed.direct) {
    // Direct root: the native call is the whole operation — the caller's own
    // options (abort signal, flag, encoding) apply unchanged and nothing is
    // cached, so a following read always sees the current bytes.
    return (await nodeFs.readFile(target as never, options as never)) as string | Buffer
  }
  const encoding = encodingOf(options)
  if (!isCacheableReadFile(options)) {
    // Distinct filesystem semantics (abort signal, non-default flag): not
    // cacheable, but still contained and still executed in the isolated
    // worker so it cannot block this process.
    const flag = optionValue(options, 'flag')
    const read = () =>
      getStore().rawReadFile(
        routed.context,
        routed.path,
        typeof flag === 'string' ? flag : undefined,
      )
    const signal = optionValue(options, 'signal')
    const bytes = signal instanceof AbortSignal ? await withAbort(read, signal) : await read()
    if (encoding === null || encoding === 'buffer') return bytes
    return bytes.toString(encoding)
  }
  const value = await getStore().readFileValue(routed.context, routed.path)
  return decodeFile(value, encoding)
}

async function facadeReaddir(
  target: PathLike,
  options?: ReaddirOptions,
): Promise<string[] | Buffer[] | Dirent[]> {
  const routed = routable(target, 'readdir')
  if (routed === null || routed.direct) {
    // A direct root has no cache entries to keep consistent, so even a
    // recursive listing is just the native walk the caller asked for.
    return (await nodeFs.readdir(target as never, options as never)) as
      | string[]
      | Buffer[]
      | Dirent[]
  }
  if (optionValue(options, 'recursive') === true) {
    throw new Error(
      'projectFs.readdir: recursive listing is not permitted inside a project file context; compose direct listings instead',
    )
  }
  const { entries } = await getStore().listDirValue(routed.context, routed.path)
  if (optionValue(options, 'withFileTypes') === true) {
    // CachedDirent implements the Dirent surface callers actually use; Node's
    // Dirent class is not publicly constructible.
    return entries.map(
      (entry) => new CachedDirent(entry.name, routed.path, entry.kind) as unknown as Dirent,
    )
  }
  if (encodingOf(options) === 'buffer') {
    return entries.map((entry) => Buffer.from(entry.name, 'utf8'))
  }
  return entries.map((entry) => entry.name)
}

async function facadeStat(target: PathLike, options?: unknown): Promise<Stats> {
  const routed = routable(target, 'stat')
  if (routed === null || routed.direct) {
    return (await nodeFs.stat(target as never, options as never)) as Stats
  }
  if (optionValue(options, 'bigint') === true) {
    // BigInt precision is a distinct filesystem semantic, so it is observed
    // fresh rather than served from the cache — still isolated and contained.
    return await getStore().rawStat(routed.context, routed.path, 'stat')
  }
  return await getStore().statValue(routed.context, routed.path, 'stat')
}

async function facadeLstat(target: PathLike, options?: unknown): Promise<Stats> {
  const routed = routable(target, 'lstat')
  if (routed === null || routed.direct) {
    return (await nodeFs.lstat(target as never, options as never)) as Stats
  }
  if (optionValue(options, 'bigint') === true) {
    return await getStore().rawStat(routed.context, routed.path, 'lstat')
  }
  return await getStore().statValue(routed.context, routed.path, 'lstat')
}

async function facadeRealpath(target: PathLike, options?: unknown): Promise<string> {
  const routed = routable(target, 'realpath')
  if (routed === null || routed.direct) {
    return (await nodeFs.realpath(target as never, options as never)) as string
  }
  return await getStore().realpathValue(routed.context, routed.path)
}

async function facadeAccess(target: PathLike, mode?: number): Promise<void> {
  const routed = routable(target, 'access')
  if (routed === null) {
    await nodeFs.access(target as never, mode)
    return
  }
  const writeCheck = mode !== undefined && (mode & 2) !== 0
  if (writeCheck && routed.context.readOnly === true) throw readOnlyError('access', routed.path)
  if (routed.direct) {
    await nodeFs.access(target as never, mode)
    return
  }
  if (writeCheck) {
    await getStore().rawAccess(routed.context, routed.path, mode)
    return
  }
  await getStore().statValue(routed.context, routed.path, 'stat')
}

function isWriteFlag(flags: unknown): boolean {
  if (typeof flags === 'number') return (flags & 3) !== 0 || (flags & 0x40) !== 0
  if (typeof flags !== 'string') return false
  return flags.includes('w') || flags.includes('a') || flags.includes('+')
}

async function facadeOpen(target: PathLike, flags?: unknown, mode?: unknown): Promise<unknown> {
  const routed = routable(target, 'open')
  if (routed === null) {
    return await nodeFs.open(target as never, flags as never, mode as never)
  }
  if (routed.context.readOnly === true && isWriteFlag(flags)) {
    throw readOnlyError('open', routed.path)
  }
  if (routed.direct) {
    return await nodeFs.open(target as never, flags as never, mode as never)
  }
  // File handles are byte-range transports (log tails, line indexes, binary
  // downloads): deliberately not whole-file cache entries, and deliberately
  // not routed through the isolated worker, because a handle cannot cross a
  // process boundary. They stay bounded by the caller's own streaming and
  // must still open a contained target.
  const contained = await getStore().containedTarget(routed.context, routed.path, 'open')
  return await nodeFs.open(contained, flags as never, mode as never)
}

function writtenBytes(data: unknown): Buffer | null {
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  return null
}

async function facadeWriteFile(target: PathLike, data: unknown, options?: unknown): Promise<void> {
  const routed = routable(target, 'writeFile')
  if (routed === null) {
    await nodeFs.writeFile(target as never, data as never, options as never)
    return
  }
  if (routed.direct) {
    if (routed.context.readOnly === true) throw readOnlyError('writeFile', routed.path)
    await nodeFs.writeFile(target as never, data as never, options as never)
    return
  }
  const store = getStore()
  const bytes = writtenBytes(data)
  await store.mutate(routed.context, 'writeFile', [routed.path], 'writeFile', [
    routed.path,
    data,
    options,
  ])
  const flag = optionValue(options, 'flag')
  if (flag === undefined || flag === 'w') {
    if (bytes !== null) store.adoptWrite(routed.context, routed.path, bytes)
  }
}

/**
 * The native implementations behind the mutating facade methods. Keyed by the
 * same allowlist the isolated worker uses, so a direct root performs exactly
 * the mutation the scheduled path would have delegated.
 */
const nativeMutations = nodeFs as unknown as Record<
  MutationMethod,
  (...args: unknown[]) => Promise<unknown>
>

/**
 * A mutation on one path. Outside a context, and on a direct root, it is the
 * native call (a direct root still refuses writes under the read-only
 * policy); in a scheduled context the store enforces policy, containment and
 * slot accounting, and the isolated worker performs it.
 */
function mutatingUnary(
  method: MutationMethod,
  arity: number,
): (target: PathLike, ...args: unknown[]) => Promise<unknown> {
  return async (target: PathLike, ...args: unknown[]) => {
    const forwarded = args.slice(0, arity)
    const routed = routable(target, method)
    if (routed === null) {
      return await executeProjectIo({ id: 0, op: 'mutate', method, args: [target, ...forwarded] })
    }
    if (routed.direct) {
      if (routed.context.readOnly === true) throw readOnlyError(method, routed.path)
      return await nativeMutations[method](target, ...forwarded)
    }
    return await getStore().mutate(routed.context, method, [routed.path], method, [
      routed.path,
      ...forwarded,
    ])
  }
}

/** A mutation with a source and a destination (`rename`, `copyFile`, `cp`). */
function mutatingBinary(
  method: MutationMethod,
  arity: number,
): (source: PathLike, destination: PathLike, ...args: unknown[]) => Promise<unknown> {
  return async (source: PathLike, destination: PathLike, ...args: unknown[]) => {
    const forwarded = args.slice(0, arity)
    const routed = routable(source, method)
    if (routed === null) {
      return await executeProjectIo({
        id: 0,
        op: 'mutate',
        method,
        args: [source, destination, ...forwarded],
      })
    }
    if (routed.direct) {
      if (routed.context.readOnly === true) throw readOnlyError(method, routed.path)
      // The destination is contained by the same rule as the source.
      routable(destination, method)
      return await nativeMutations[method](source, destination, ...forwarded)
    }
    // The destination is validated by the same containment rules as the
    // source, so a linked or out-of-root target cannot receive the write.
    const destinationRoute = routable(destination, method)
    const destinationPath = destinationRoute === null ? String(destination) : destinationRoute.path
    return await getStore().mutate(routed.context, method, [routed.path, destinationPath], method, [
      routed.path,
      destinationPath,
      ...forwarded,
    ])
  }
}

const realpathFacade = Object.assign(facadeRealpath, { native: facadeRealpath })

const facadeMethods = {
  readFile: facadeReadFile,
  readdir: facadeReaddir,
  stat: facadeStat,
  lstat: facadeLstat,
  realpath: realpathFacade,
  access: facadeAccess,
  open: facadeOpen,
  writeFile: facadeWriteFile,
  appendFile: mutatingUnary('appendFile', 2),
  mkdir: mutatingUnary('mkdir', 1),
  rm: mutatingUnary('rm', 1),
  rmdir: mutatingUnary('rmdir', 1),
  unlink: mutatingUnary('unlink', 0),
  truncate: mutatingUnary('truncate', 1),
  chmod: mutatingUnary('chmod', 1),
  utimes: mutatingUnary('utimes', 2),
  rename: mutatingBinary('rename', 0),
  copyFile: mutatingBinary('copyFile', 1),
  cp: mutatingBinary('cp', 1),
}

/**
 * `fs/promises`-compatible facade. Cached + scheduled inside a project file
 * context, native passthrough outside one. Unlisted members fall through to
 * `node:fs/promises` so the type stays honest without copying every method.
 */
export const projectFs = new Proxy(facadeMethods, {
  get(target, property, receiver) {
    if (Reflect.has(target, property)) return Reflect.get(target, property, receiver)
    return Reflect.get(nodeFs as unknown as object, property)
  },
  has(target, property) {
    return Reflect.has(target, property) || Reflect.has(nodeFs as unknown as object, property)
  },
}) as unknown as typeof FsPromisesModule
