import { AgentReadHandle } from './agent-handle.js'
// project-file-store/store — `ProjectFileStore`, the orchestration of one
// process's project file observations: entries and their freshness, attention
// leases, the completed-value LRU, invalidation and write adoption, freshness
// status and metrics snapshots, and the primitive operations the facade calls.
// Queueing lives in `scheduler.ts`; source availability lives in `mount-guard.ts`.

import { createHash, randomBytes } from 'node:crypto'
import type { Stats } from 'node:fs'
import { contentVersion, directoryVersion, FileAccessError } from '@memon/file-protocol'
import { dirname, join, resolve } from '@memon/file-protocol/paths'
import { LRUCache } from 'lru-cache'
import { isWithinPath } from '../mount-table.js'
import {
  notifyProjectFilesChanged,
  type ProjectFileContext,
  projectFileContextStorage,
} from '../project-file-context.js'
import { getProjectIo, type MutationMethod, ProjectStats, type StatsFields } from '../project-io.js'
import type { FileAccessOptions } from '../types.js'
import { agentAdapter, isAgentPath, missingAgentPath } from './agent-adapters.js'
import { mutateAgent } from './agent-mutations.js'
import { SourceBudgetPool, withSourceBudgetTiming } from './budgets.js'
import { monotonic } from './clock.js'
import { containedRealPath } from './containment.js'
import {
  DEFAULT_FILE_ACCESS_OPTIONS,
  type FileOperationMetrics,
  type FileOperationOrigin,
  isHumanFileOperationReason,
  type ObservedOperation,
  type ProjectFileStatus,
  RESET_REASON,
} from './contract.js'
import { containmentError, readOnlyError } from './errors.js'
import { MetricsRegistry } from './metrics.js'
import { MountGuard } from './mount-guard.js'
import {
  type DirValue,
  dirObservation,
  type FileValue,
  fileObservation,
  missingErrorOf,
  type Observation,
  pathObservation,
  statObservation,
  toNegativeOrThrow,
} from './observation.js'
import { freshnessStatus, metricsSnapshot } from './reporting.js'
import { FileOperationScheduler, failureBackoffMs, successIntervalMs } from './scheduler.js'
import { budgetedSourceOperation } from './source-budget-runtime.js'
import type { AttentionLease, ScheduledTask, StoreEntry } from './state.js'

const MAX_CACHED_CONTENT_BYTES = 128 * 1024 * 1024
const MAX_CACHE_ENTRIES = 50_000
const MAX_ATTENTION_KEYS = 4_096
const ATTENTION_SWEEP_INTERVAL_MS = 1_000

export class ProjectFileStore {
  readonly epoch = randomBytes(8).toString('hex')
  readonly contextStorage = projectFileContextStorage()

  private options: FileAccessOptions = { ...DEFAULT_FILE_ACCESS_OPTIONS }
  readonly budgets = new SourceBudgetPool(
    () => this.options,
    (source, operation, automatic, kind) =>
      this.metrics.recordBudgetDeferral(source, operation, automatic ? 'automatic' : 'human', kind),
    (source, operation, automatic, sample) =>
      this.metrics.recordOperation(source, operation, automatic ? 'automatic' : 'human', sample),
  )
  // Scheduler metadata and tasks never enter this completed-value LRU.
  private readonly observations = new LRUCache<string, Observation>({
    max: MAX_CACHE_ENTRIES,
    maxSize: MAX_CACHED_CONTENT_BYTES,
    sizeCalculation: (observation) => Math.max(1, observation.bytes),
    dispose: (observation) => {
      this.cachedContentBytes -= observation.bytes
    },
  })
  private readonly entries = new Map<string, StoreEntry>()
  private readonly attentions = new Map<string, AttentionLease>()
  private readonly metrics = new MetricsRegistry()
  private readonly scheduler = new FileOperationScheduler({
    budgets: this.budgets,
    options: () => this.options,
    metrics: this.metrics,
    cached: (key) => this.observations.get(key),
    succeeded: (entry, task, observation, completedMono) =>
      this.applySuccess(entry, task, observation, completedMono),
    failed: (entry, error) => this.applyFailure(entry, error),
    executed: () => this.enforceMemoryBounds(),
  })
  private cachedContentBytes = 0
  private readonly mounts = new MountGuard()
  private lastAttentionSweepWall = 0
  /**
   * Roots whose most recent context declared `storage: 'local'`. Direct
   * operations create no entries, tasks or metrics, so this is the only
   * record freshness reporting can answer from.
   */
  private readonly authorityIdentities = new Map<string, string>()
  private readonly sourceIdentities = new Map<string, string | undefined>()
  private readonly directRoots = new Set<string>()
  private readonly logicalInterests = new Map<string, number>()
  /** Operation keys already reset by the in-flight human request, per context. */
  private readonly contextResets = new WeakMap<ProjectFileContext, Set<string>>()

  // -- configuration -------------------------------------------------------

  configure(patch: Partial<FileAccessOptions>): void {
    const next: FileAccessOptions = { ...this.options }
    for (const [key, value] of Object.entries(patch) as [keyof FileAccessOptions, unknown][]) {
      if (value === undefined) continue
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        (value === 0 && !['operationsPerSecond', 'bytesPerSecond'].includes(key))
      ) {
        throw new RangeError(`file access option ${String(key)} must be a finite positive number`)
      }
      next[key] = value
    }
    if (next.backgroundShare >= 1 || next.maxReadBytes > next.byteBurst)
      throw new RangeError(
        'backgroundShare must be less than one and byteBurst must cover maxReadBytes',
      )
    this.options = next
    // The isolated workers must be able to hold the scheduled concurrency.
    getProjectIo().configure(this.options.concurrency)
  }

  observationTime(root: string, path: string, operation: ObservedOperation): number | null {
    return this.entries.get(`${root}\u0000${operation}\u0000${path}`)?.completedAtWall ?? null
  }

  nextCheckDelay(root: string, path: string, operation: ObservedOperation): number {
    const entry = this.entries.get(`${root}\u0000${operation}\u0000${path}`)
    return entry ? Math.max(0, entry.dueAtMono - monotonic()) : 0
  }

  /** Explicit logical interests choose one shared generic polling schedule. */
  registerLogicalInterest(root: string, path: string, operation: ObservedOperation): () => void {
    const key = `${root}\u0000${operation}\u0000${path}`
    const count = this.logicalInterests.get(key) ?? 0
    this.logicalInterests.set(key, count + 1)
    const entry = this.entries.get(key)
    if (entry && count === 0) {
      entry.attentionGeneration++
      entry.intervalMs = this.intervalRange(entry)[0]
      if (entry.completedAtMono !== null)
        entry.dueAtMono = Math.min(entry.dueAtMono, entry.completedAtMono + entry.intervalMs)
    }
    let removed = false
    return () => {
      if (removed) return
      removed = true
      const remaining = (this.logicalInterests.get(key) ?? 1) - 1
      if (remaining) this.logicalInterests.set(key, remaining)
      else this.logicalInterests.delete(key)
    }
  }

  discardTransientBody(root: string, path: string, operation: ObservedOperation): void {
    const key = `${root}\u0000${operation}\u0000${path}`
    if (this.observations.peek(key)?.present) this.observations.delete(key)
  }

  effectiveOptions(): FileAccessOptions {
    return { ...this.options }
  }

  // -- context / entries ---------------------------------------------------

  private entryFor(
    context: ProjectFileContext,
    operation: ObservedOperation,
    absolutePath: string,
  ): StoreEntry {
    const root = context.root
    const key = `${root}\u0000${operation}\u0000${absolutePath}`
    let entry = this.entries.get(key)
    if (entry === undefined) {
      const group = this.scheduler.groupFor(context.storageGroup ?? 'default')
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
      }
    } else {
      // Keep metadata in demand order without putting queued work in an LRU.
      this.entries.delete(key)
    }
    this.entries.set(key, entry)
    return entry
  }

  /** Demand reads share one short freshness budget; no dump or second TTL class. */
  private intervalRange(_entry: StoreEntry): [number, number] {
    return [30_000, 30_000]
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
    // Local credential changes must fence old observations before any cached answer.
    if (isAgentPath(absolutePath)) await agentAdapter(absolutePath)
    const entry = this.entryFor(context, operation, absolutePath)
    const human = isHumanFileOperationReason(context.reason)
    const origin: FileOperationOrigin = human ? 'human' : 'automatic'
    this.touchAttention(context, entry)
    if (
      (context.observationPolicy === 'revalidate' || RESET_REASON[context.reason ?? 'automatic']) &&
      this.firstTouchInRequest(context, entry.key)
    ) {
      this.resetSchedule(entry)
    }

    const now = monotonic()
    const observation = this.observations.get(entry.key)
    if (observation !== undefined) {
      this.metrics.recordCacheHit(entry.group.name, operation, origin)
      if (
        entry.completedAtMono !== null &&
        now - entry.completedAtMono < 30_000 &&
        now < entry.dueAtMono &&
        !entry.refreshRequested
      )
        return observation
      if (entry.cachedError && now < entry.dueAtMono && !entry.refreshRequested)
        throw entry.cachedError
      return await this.scheduler.schedule(entry, operation, origin, human, runner)
    }

    if (entry.cachedError !== null && now < entry.dueAtMono) {
      this.metrics.recordCacheHit(entry.group.name, operation, origin)
      throw entry.cachedError
    }

    return await this.scheduler.schedule(entry, operation, origin, human, runner)
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

    entry.intervalMs = successIntervalMs(
      entry.intervalMs,
      this.intervalRange(entry),
      this.options.backoffFactor,
      first || changed,
      task.attentionGeneration === entry.attentionGeneration,
    )
    entry.dueAtMono = completedMono + entry.intervalMs
  }

  private applyFailure(entry: StoreEntry, error: NodeJS.ErrnoException): void {
    entry.failures += 1
    entry.error = typeof error.code === 'string' && error.code.length > 0 ? error.code : 'EUNKNOWN'
    entry.cachedError = error
    const backoff = failureBackoffMs(this.options, entry.failures)
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
   * rename), its parent listing is invalidated too.
   *
   * Without a path this is a "something in this project changed" signal. The
   * memory entries are released and re-verified on demand.
   */
  invalidate(root: string, path?: string): void {
    const normalizedRoot = resolve(root)
    notifyProjectFilesChanged(normalizedRoot)
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
  }

  private invalidateEntry(entry: StoreEntry): void {
    this.releaseContent(entry)
    entry.mutationGeneration += 1
    entry.dueAtMono = monotonic()
    entry.error = null
    entry.cachedError = null
    entry.failures = 0
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
  }

  /**
   * Record how a root's files are reached, so freshness reporting can
   * describe a direct root that owns no scheduler state at all.
   */
  noteAuthority(root: string, identity: string): void {
    if (this.authorityIdentities.has(root) && this.authorityIdentities.get(root) !== identity)
      this.resetNamespace(root)
    this.authorityIdentities.set(root, identity)
  }

  private resetNamespace(root: string): void {
    this.invalidate(root)
    for (const entry of this.entries.values()) {
      if (entry.root !== root) continue
      entry.completedAtWall = null
      entry.completedAtMono = null
      entry.fingerprint = null
    }
  }

  noteSource(root: string, identity: string | undefined): void {
    if (this.sourceIdentities.has(root) && this.sourceIdentities.get(root) !== identity) {
      this.resetNamespace(root)
    }
    this.sourceIdentities.set(root, identity)
  }

  sourceNamespace(root: string): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          this.sourceIdentities.get(root) ?? null,
          this.authorityIdentities.get(root) ?? null,
        ]),
      )
      .digest('hex')
  }
  noteStorage(root: string, storage: ProjectFileContext['storage']): void {
    if (storage === 'local') this.directRoots.add(root)
    else this.directRoots.delete(root)
  }

  // -- status / metrics ----------------------------------------------------

  status(root: string, attentionId?: string): ProjectFileStatus {
    const normalizedRoot = resolve(root)
    const now = Date.now()
    this.sweepAttentions(now)
    return freshnessStatus(
      {
        epoch: this.epoch,
        directRoots: this.directRoots,
        attentions: this.attentions,
        entries: this.entries,
        groups: this.scheduler.groups,
      },
      normalizedRoot,
      attentionId,
      now,
    )
  }

  recordTransport(group: string, operation: string, bytes: number, validation: boolean): void {
    const name =
      operation === 'read' || operation === 'range'
        ? 'readFile'
        : operation === 'list'
          ? 'readdir'
          : operation === 'mutate'
            ? 'write'
            : operation === 'resolve'
              ? 'realpath'
              : operation === 'lstat'
                ? 'lstat'
                : 'stat'
    const reason = this.contextStorage.getStore()?.reason
    this.metrics.recordTransport(
      group,
      name,
      isHumanFileOperationReason(reason) ? 'human' : 'automatic',
      bytes,
      validation,
    )
  }

  metricsSnapshot(windowMs?: number): FileOperationMetrics {
    return metricsSnapshot(
      {
        epoch: this.epoch,
        options: this.options,
        metrics: this.metrics,
        groups: this.scheduler.groups,
        cacheEntries: () => this.observations.size,
        cachedContentBytes: () => this.cachedContentBytes,
      },
      windowMs,
    )
  }

  // -- primitive operations ------------------------------------------------

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
    if (isAgentPath(absolutePath)) {
      const { adapter, target } = await agentAdapter(absolutePath)
      return join(context.root, await adapter.resolve(target))
    }
    const group = this.groupName(context)
    const rootReal = await this.mounts.realRoot(context.root, group)
    await this.mounts.assertMountIdentity(rootReal, syscall)
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
        if (isAgentPath(absolutePath)) {
          const { adapter, target } = await agentAdapter(absolutePath)
          const prior = this.observations.peek(`${context.root}\u0000readFile\u0000${absolutePath}`)
          const body = prior?.value?.kind === 'file' ? prior.value.bytes : undefined
          const result = await adapter.read(
            target,
            body ? { knownVersion: contentVersion(body) } : {},
          )
          if (result.outcome === 'missing') throw missingAgentPath(absolutePath)
          if (result.outcome === 'unchanged') {
            if (!body || !prior) throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
            return prior
          }
          return fileObservation(Buffer.from(result.content, 'base64'))
        }
        const target = await this.containedTarget(context, absolutePath, 'readFile')
        return fileObservation(
          await getProjectIo().readFile(
            this.groupName(context),
            target,
            undefined,
            this.options.maxReadBytes,
          ),
        )
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
        if (isAgentPath(absolutePath)) {
          const { adapter, target } = await agentAdapter(absolutePath)
          const prior = this.observations.peek(`${context.root}\u0000readdir\u0000${absolutePath}`)
          const entries = prior?.value?.kind === 'dir' ? prior.value.entries : undefined
          const result = await adapter.list(
            target,
            entries ? { knownVersion: directoryVersion(entries) } : {},
          )
          if (result.outcome === 'missing') throw missingAgentPath(absolutePath)
          if (result.outcome === 'unchanged') {
            if (!entries || !prior) throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
            return prior
          }
          return dirObservation(result.entries)
        }
        const target = await this.containedTarget(context, absolutePath, 'readdir')
        return dirObservation(
          await getProjectIo().readdir(this.groupName(context), target, this.options.maxReadBytes),
        )
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
        if (isAgentPath(absolutePath))
          return statObservation(await this.agentStat(absolutePath, operation))
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
        if (isAgentPath(absolutePath)) {
          const { adapter, target } = await agentAdapter(absolutePath)
          return pathObservation(join(context.root, await adapter.resolve(target)))
        }
        const group = this.groupName(context)
        const rootReal = await this.mounts.realRoot(context.root, group)
        await this.mounts.assertMountIdentity(rootReal, 'realpath')
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

  private async agentStat(path: string, operation: 'stat' | 'lstat') {
    const { adapter, target } = await agentAdapter(path)
    const result = await adapter.stat(target, operation === 'stat')
    if (result.outcome === 'missing') throw missingAgentPath(path)
    const { metadata } = result
    const type =
      metadata.kind === 'file'
        ? 0o100000
        : metadata.kind === 'directory'
          ? 0o040000
          : metadata.kind === 'symlink'
            ? 0o120000
            : 0
    return {
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      mode: metadata.mode | type,
      ...(metadata.ino === undefined ? {} : { ino: metadata.ino }),
      ...(metadata.dev === undefined ? {} : { dev: metadata.dev }),
      ...(metadata.ctimeMs === undefined ? {} : { ctimeMs: metadata.ctimeMs }),
    }
  }

  async openReadHandle(context: ProjectFileContext, path: string) {
    const group = this.scheduler.groupFor(this.groupName(context))
    const run = async <T>(
      bytes: number,
      work: () => Promise<T>,
      actual?: (value: T) => number,
    ): Promise<T> => {
      await this.scheduler.acquire(group)
      try {
        return await budgetedSourceOperation(
          group.name,
          context.root,
          bytes,
          work,
          actual,
          this.budgets,
        )
      } finally {
        this.scheduler.release(group)
      }
    }
    const opened = await run(0, async () => {
      const target = await this.containedTarget(context, path, 'open')
      return (await getProjectIo().run(group.name, { op: 'openRead', path: target })) as {
        readToken: string
        fields: StatsFields
        fileId: string
      }
    })
    return new AgentReadHandle(
      (offset, length) =>
        run(
          length,
          async () => {
            const rootReal = await this.mounts.realRoot(context.root, group.name)
            await this.mounts.assertMountIdentity(rootReal, 'readAt')
            return Buffer.from(
              (await getProjectIo().run(group.name, {
                op: 'readAt',
                readToken: opened.readToken,
                offset,
                length,
              })) as Uint8Array,
            )
          },
          (value) => value.length,
        ),
      () =>
        run(0, async () => {
          await getProjectIo().run(group.name, { op: 'closeRead', readToken: opened.readToken })
        }),
      opened.fields,
      opened.fileId,
    )
  }

  async readRange(
    context: ProjectFileContext,
    path: string,
    offset: number,
    length: number,
  ): Promise<Buffer> {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > this.options.byteBurst
    )
      throw new RangeError('invalid bounded range')
    const group = this.scheduler.groupFor(this.groupName(context))
    await this.scheduler.acquire(group)
    try {
      return await budgetedSourceOperation(
        group.name,
        context.root,
        length,
        async () => {
          const target = await this.containedTarget(context, path, 'readRange')
          return (await getProjectIo().readRange(group.name, target, offset, length)).bytes
        },
        (bytes) => bytes.length,
        this.budgets,
      )
    } finally {
      this.scheduler.release(group)
    }
  }

  /** Uncached physical reads (distinct fs semantics) still run isolated. */
  async rawReadFile(
    context: ProjectFileContext,
    absolutePath: string,
    flag?: string,
  ): Promise<Buffer> {
    if (isAgentPath(absolutePath)) {
      if (flag !== undefined && flag !== 'r') throw new FileAccessError('CAPABILITY_UNAVAILABLE')
      const { adapter, target } = await agentAdapter(absolutePath)
      const result = await adapter.read(target)
      if (result.outcome === 'missing') throw missingAgentPath(absolutePath)
      if (result.outcome !== 'present') throw new FileAccessError('PROTOCOL_INCOMPATIBLE')
      return Buffer.from(result.content, 'base64')
    }
    return budgetedSourceOperation(
      this.groupName(context),
      context.root,
      this.options.maxReadBytes,
      async () => {
        const target = await this.containedTarget(context, absolutePath, 'readFile')
        return getProjectIo().readFile(
          this.groupName(context),
          target,
          flag,
          this.options.maxReadBytes,
        )
      },
      (bytes) => bytes.length,
      this.budgets,
    )
  }

  async rawStat(
    context: ProjectFileContext,
    absolutePath: string,
    operation: 'stat' | 'lstat',
  ): Promise<Stats> {
    if (isAgentPath(absolutePath))
      return new ProjectStats(await this.agentStat(absolutePath, operation)) as unknown as Stats
    return budgetedSourceOperation(
      this.groupName(context),
      context.root,
      0,
      async () => {
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
      },
      undefined,
      this.budgets,
      operation,
    )
  }

  async rawAccess(context: ProjectFileContext, absolutePath: string, mode: number): Promise<void> {
    if (isAgentPath(absolutePath)) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    await budgetedSourceOperation(
      this.groupName(context),
      context.root,
      0,
      async () => {
        const target = await this.containedTarget(context, absolutePath, 'access')
        await getProjectIo().access(this.groupName(context), target, mode)
      },
      undefined,
      this.budgets,
      'stat',
    )
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

    const group = this.scheduler.groupFor(this.groupName(context))
    const enqueuedAtMono = monotonic()
    await this.scheduler.acquire(group)
    const startedAtMono = monotonic()
    const timing = { waitMs: 0, automatic: () => false }
    try {
      // Symlink containment for the real targets, inside the slot: a linked
      // destination must not let a write land outside the root.
      if (!isAgentPath(paths[0] ?? ''))
        for (const path of paths) await this.containedTarget(context, path, syscall)
      const bytes =
        method === 'writeFile' || method === 'appendFile'
          ? typeof args[1] === 'string'
            ? Buffer.byteLength(args[1])
            : args[1] instanceof Uint8Array
              ? args[1].byteLength
              : 0
          : 0
      const result = await withSourceBudgetTiming(timing, async () =>
        isAgentPath(paths[0] ?? '')
          ? await mutateAgent(context, method, paths, args)
          : await budgetedSourceOperation(
              group.name,
              context.root,
              bytes,
              () => getProjectIo().mutate(group.name, method, args),
              () => bytes,
              this.budgets,
              'write',
            ),
      )
      this.metrics.recordOperation(group.name, 'write', 'human', {
        waitMs: startedAtMono - enqueuedAtMono + timing.waitMs,
        execMs: Math.max(0, monotonic() - startedAtMono - timing.waitMs),
        bytes: 0,
        error: false,
      })
      return result
    } catch (error) {
      this.metrics.recordOperation(group.name, 'write', 'human', {
        waitMs: startedAtMono - enqueuedAtMono + timing.waitMs,
        execMs: Math.max(0, monotonic() - startedAtMono - timing.waitMs),
        bytes: 0,
        error: true,
      })
      throw error
    } finally {
      for (const path of paths) this.invalidate(context.root, path)
      this.scheduler.release(group)
    }
  }

  adoptWrite(context: ProjectFileContext, absolutePath: string, bytes: Buffer): void {
    this.adoptWrittenContent(context.root, absolutePath, bytes)
  }
}
