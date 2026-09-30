// project-file-cache — bounded in-memory observations with periodic snapshots.
//
// Only completed project-file observations live here. Scheduler queues, in-flight
// work, promises, waiters, leases, failures, retry state and metrics stay in the
// project-file store and therefore cannot enter either this LRU or its dump.
// Serialization happens only while writing a snapshot; ordinary loads and puts
// touch memory only.

import { createHash, randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { LRUCache } from 'lru-cache'
import { z } from 'zod'
import {
  containingMount,
  type MountIdentity,
  NETWORK_FS_TYPES,
  readMountTable,
} from './mount-table.js'
import type { DirEntryData, StatsFields } from './project-io.js'

export interface FileCacheOptions {
  /** Absolute path of the owner-only local snapshot file. */
  dumpPath: string
  /** Interval between dirty snapshot attempts. */
  dumpIntervalMs: number
  /** Freshness lifetime for `docs/wiki` paths. */
  wikiTtlMs: number
  /** Freshness lifetime for every other cached document or listing path. */
  defaultTtlMs: number
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
export const DEFAULT_DUMP_INTERVAL_MS = 30_000
export const DEFAULT_WIKI_TTL_MS = 30_000
export const DEFAULT_DOCUMENT_TTL_MS = 1_800_000

const SNAPSHOT_VERSION = 1
/** An observation larger than this stays outside the snapshot cache. */
const MAX_PERSISTED_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_PERSISTED_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_PERSISTED_ENTRIES = 200_000
/** Bound startup input too, allowing encoding overhead and repeated keys. */
const MAX_SNAPSHOT_FILE_BYTES = MAX_PERSISTED_TOTAL_BYTES * 4
const MAX_UINT64 = (1n << 64n) - 1n
const MIN_INT64 = -(1n << 63n)

/** The operations whose completed observations are persistable. */
export type PersistedOperation = 'readFile' | 'readdir' | 'stat' | 'lstat'

const PERSISTED_OPERATIONS: Record<string, true> = {
  readFile: true,
  readdir: true,
  stat: true,
  lstat: true,
}

const NAMESPACE_ID_PATTERN = /^[0-9a-f]{64}$/
function normalizeDumpIntervalMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_DUMP_INTERVAL_MS
  return Math.min(value, MAX_TIMER_DELAY_MS)
}

export type PersistedPayload =
  | { kind: 'file'; bytes: Buffer }
  | { kind: 'dir'; entries: DirEntryData[] }
  | { kind: 'stat'; stats: StatsFields }
  | { kind: 'missing'; code: string }

export interface PersistedObservation {
  payload: PersistedPayload
  fingerprint: string
  /** Wall-clock ms at which this observation actually succeeded. */
  observedAtWall: number
}

/** Namespace identity: configured root plus the storage it resolved to. */
export interface CacheNamespace {
  root: string
  mount: MountIdentity
}

interface CacheEntry {
  namespaceId: string
  operation: PersistedOperation
  path: string
  observation: PersistedObservation
}

type CacheDump = [string, LRUCache.Entry<CacheEntry>][]

interface SnapshotEnvelope {
  version: number
  entries: CacheDump
}

const StatNumberSchema = z.union([
  z.number().finite(),
  z.bigint().refine((value) => value >= MIN_INT64 && value <= MAX_UINT64),
])
const StatsFieldsSchema = z
  .record(StatNumberSchema)
  .refine((fields) => fields.mode !== undefined, { message: 'stat mode is required' })
const PersistedObservationSchema = z
  .object({
    payload: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('file'), bytes: z.custom<Buffer>(Buffer.isBuffer) }).strip(),
      z
        .object({
          kind: z.literal('dir'),
          entries: z.array(
            z
              .object({
                name: z.string(),
                kind: z.enum(['file', 'directory', 'symlink', 'other']),
              })
              .strip(),
          ),
        })
        .strip(),
      z.object({ kind: z.literal('stat'), stats: StatsFieldsSchema }).strip(),
      z.object({ kind: z.literal('missing'), code: z.enum(['ENOENT', 'ENOTDIR']) }).strip(),
    ]),
    fingerprint: z.string().min(1),
    observedAtWall: z.number().int().nonnegative().max(8_640_000_000_000_000),
  })
  .strip()
const PersistedOperationSchema = z.enum(['readFile', 'readdir', 'stat', 'lstat'])
const CacheEntrySchema = z
  .object({
    namespaceId: z.string().regex(NAMESPACE_ID_PATTERN),
    operation: PersistedOperationSchema,
    path: z.string(),
    observation: PersistedObservationSchema,
  })
  .strip()
const SnapshotEnvelopeSchema = z
  .object({
    version: z.literal(SNAPSHOT_VERSION),
    entries: z
      .array(
        z.tuple([
          z.string(),
          z
            .object({
              value: CacheEntrySchema,
              ttl: z.number().finite().nonnegative().optional(),
              start: z.number().finite().nonnegative().optional(),
              size: z.number().finite().nonnegative().optional(),
            })
            .strip(),
        ]),
      )
      .max(MAX_PERSISTED_ENTRIES),
  })
  .strip()

/**
 * Select only the persistable observation fields. Besides validating restored
 * data, this prevents accidental properties on a caller object from pulling
 * unrelated state into a future v8 snapshot. File buffers are deliberately
 * retained rather than copied.
 */
function normalizeObservation(
  operation: PersistedOperation,
  candidate: unknown,
): PersistedObservation | null {
  const parsed = PersistedObservationSchema.safeParse(candidate)
  if (!parsed.success) return null
  const payload = parsed.data.payload
  if (!payloadMatchesOperation(operation, payload.kind)) return null
  return parsed.data as PersistedObservation
}

function payloadMatchesOperation(
  operation: PersistedOperation,
  kind: PersistedPayload['kind'],
): boolean {
  return (
    kind === 'missing' ||
    (kind === 'file' && operation === 'readFile') ||
    (kind === 'dir' && operation === 'readdir') ||
    (kind === 'stat' && (operation === 'stat' || operation === 'lstat'))
  )
}

function cacheKey(namespaceId: string, operation: PersistedOperation, path: string): string {
  return `${namespaceId}\u0000${operation}\u0000${path}`
}

function stringBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** Cheap accounting only; no payload is encoded on an observation path. */
function cacheEntryBytes(entry: CacheEntry): number {
  let bytes =
    stringBytes(entry.namespaceId) +
    stringBytes(entry.operation) +
    stringBytes(entry.path) +
    stringBytes(entry.observation.fingerprint) +
    8
  const payload = entry.observation.payload
  switch (payload.kind) {
    case 'file':
      return bytes + payload.bytes.byteLength
    case 'dir':
      for (const item of payload.entries) bytes += stringBytes(item.name) + stringBytes(item.kind)
      return bytes
    case 'stat':
      for (const key of Object.keys(payload.stats)) bytes += stringBytes(key) + 8
      return bytes
    case 'missing':
      return bytes + stringBytes(payload.code)
  }
}

function normalizedDump(candidate: unknown): CacheDump | null {
  const parsed = SnapshotEnvelopeSchema.safeParse(candidate)
  if (!parsed.success) return null

  const normalized: CacheDump = []
  let totalBytes = 0
  for (const [key, dumped] of parsed.data.entries) {
    const rawValue = dumped.value
    const observation = rawValue.observation as PersistedObservation
    if (!payloadMatchesOperation(rawValue.operation, observation.payload.kind)) return null
    if (key !== cacheKey(rawValue.namespaceId, rawValue.operation, rawValue.path)) return null
    const size = cacheEntryBytes(rawValue as CacheEntry)
    totalBytes += size
    if (size > MAX_PERSISTED_ENTRY_BYTES || totalBytes > MAX_PERSISTED_TOTAL_BYTES) return null
    const value: CacheEntry = {
      namespaceId: rawValue.namespaceId,
      operation: rawValue.operation,
      path: rawValue.path,
      observation,
    }
    normalized.push([key, { value, size }])
  }
  // Validate the entire memory budget before detaching any buffers. Node's
  // deserializer returns views into the full dump; one accepted small file
  // must not pin that input after its other entries have been evicted.
  for (const [, entry] of normalized) {
    const payload = entry.value.observation.payload
    if (payload.kind === 'file') payload.bytes = Buffer.from(payload.bytes)
  }
  return normalized
}

async function prepareLocalDumpPath(path: string): Promise<void> {
  const directory = dirname(path)
  const table = await readMountTable()
  if (table === null)
    throw new Error('memon: cannot verify local storage for the project file cache')
  const dumpMount = containingMount(path, table)
  if (dumpMount !== undefined && NETWORK_FS_TYPES[dumpMount.fsType] === true) {
    throw new Error('memon: the project file cache dump must live on local disk')
  }

  // Check from the filesystem root downward so a symlink cannot redirect the
  // directory creation or the snapshot writer onto network storage.
  let checked = parse(directory).root
  for (const part of relative(checked, directory).split(sep).filter(Boolean)) {
    checked = join(checked, part)
    const mount = containingMount(checked, table)
    if (mount !== undefined && NETWORK_FS_TYPES[mount.fsType] === true) {
      throw new Error('memon: the project file cache dump must live on local disk')
    }
    const entry = await nodeFs.lstat(checked).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (entry?.isSymbolicLink()) {
      throw new Error('memon: the project file cache directory must not contain symlinks')
    }
    if (entry !== null && !entry.isDirectory()) {
      throw new Error('memon: the project file cache parent must be a directory')
    }
  }

  await nodeFs.mkdir(directory, { recursive: true, mode: 0o700 })
  await nodeFs.chmod(directory, 0o700)
  const existing = await nodeFs.lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (existing !== null && !existing.isFile()) {
    throw new Error(`memon: the project file cache dump path ${path} is not a regular file`)
  }
  if (existing !== null) await nodeFs.chmod(path, 0o600)
}

export class ProjectFileCache {
  private readonly entries = new LRUCache<string, CacheEntry>({
    max: MAX_PERSISTED_ENTRIES,
    maxSize: MAX_PERSISTED_TOTAL_BYTES,
    maxEntrySize: MAX_PERSISTED_ENTRY_BYTES,
    sizeCalculation: cacheEntryBytes,
  })
  private generation = 0
  private persistedGeneration = 0
  private writer: Promise<void> | null = null
  private timer: NodeJS.Timeout | null = null
  private closed = false
  private closePromise: Promise<void> | null = null

  private constructor(readonly options: FileCacheOptions) {}

  static async open(options: FileCacheOptions): Promise<ProjectFileCache> {
    const dumpPath = resolve(options.dumpPath)
    await prepareLocalDumpPath(dumpPath)
    const dumpIntervalMs = normalizeDumpIntervalMs(options.dumpIntervalMs)
    const cache = new ProjectFileCache({ ...options, dumpPath, dumpIntervalMs })
    await cache.loadSnapshot()
    cache.timer = setInterval(() => {
      const target = cache.generation
      if (target !== cache.persistedGeneration && cache.writer === null) {
        void cache.flushThrough(target).catch(() => undefined)
      }
    }, dumpIntervalMs)
    cache.timer.unref()
    return cache
  }

  private async loadSnapshot(): Promise<void> {
    let encoded: Buffer
    let handle: FileHandle | null = null
    try {
      handle = await nodeFs.open(this.options.dumpPath, 'r')
      if ((await handle.stat()).size > MAX_SNAPSHOT_FILE_BYTES) return
      encoded = await handle.readFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    } finally {
      await handle?.close()
    }

    let candidate: unknown
    try {
      candidate = deserialize(encoded)
    } catch {
      return
    }
    const dump = normalizedDump(candidate)
    if (dump === null) return
    this.entries.load(dump)
  }

  /** Stable root + mount identity; remounting storage changes every cache key. */
  async namespaceId(namespace: CacheNamespace): Promise<string> {
    const identity = JSON.stringify([
      namespace.root,
      namespace.mount.mountPoint,
      namespace.mount.fsType,
      namespace.mount.source,
    ])
    return createHash('sha256').update(identity).digest('hex')
  }

  async load(
    namespaceId: string,
    operation: PersistedOperation,
    path: string,
  ): Promise<PersistedObservation | null> {
    if (this.closed) return null
    return this.entries.get(cacheKey(namespaceId, operation, path))?.observation ?? null
  }

  /** Store one completed, structurally valid observation in memory only. */
  async put(
    namespaceId: string,
    operation: PersistedOperation,
    path: string,
    observation: PersistedObservation,
  ): Promise<void> {
    if (this.closed) return
    const key = cacheKey(namespaceId, operation, path)
    const normalized = normalizeObservation(operation, observation)
    if (normalized === null || !NAMESPACE_ID_PATTERN.test(namespaceId)) {
      if (this.entries.delete(key)) this.generation += 1
      return
    }
    const value: CacheEntry = { namespaceId, operation, path, observation: normalized }
    if (cacheEntryBytes(value) > MAX_PERSISTED_ENTRY_BYTES) {
      if (this.entries.delete(key)) this.generation += 1
      return
    }
    this.entries.set(key, value)
    this.generation += 1
  }

  /** Remove one operation's observation. */
  async delete(namespaceId: string, operation: PersistedOperation, path: string): Promise<void> {
    if (!this.closed && this.entries.delete(cacheKey(namespaceId, operation, path))) {
      this.generation += 1
    }
  }

  /** Remove every observation of one path, whatever the operation. */
  async deletePath(namespaceId: string, path: string): Promise<void> {
    if (this.closed) return
    let changed = false
    for (const operation of PersistedOperationSchema.options) {
      changed = this.entries.delete(cacheKey(namespaceId, operation, path)) || changed
    }
    if (changed) this.generation += 1
  }

  /** Drop every observation associated with a storage identity. */
  async deleteNamespace(namespaceId: string): Promise<void> {
    if (this.closed) return
    const doomed: string[] = []
    for (const [key, value] of this.entries) {
      if (value.namespaceId === namespaceId) doomed.push(key)
    }
    for (const key of doomed) this.entries.delete(key)
    if (doomed.length > 0) this.generation += 1
  }

  /**
   * Persist every mutation completed before this call. If observations change
   * during the write they remain dirty for the next interval/call.
   */
  async flush(): Promise<void> {
    if (this.closed) {
      if (this.closePromise !== null) await this.closePromise
      return
    }
    await this.flushThrough(this.generation)
  }

  private async flushThrough(targetGeneration: number): Promise<void> {
    while (this.persistedGeneration < targetGeneration) {
      if (this.writer !== null) {
        await this.writer
        continue
      }
      const generation = this.generation
      const dump: SnapshotEnvelope = { version: SNAPSHOT_VERSION, entries: this.entries.dump() }
      const writing = this.writeSnapshot(dump).then(() => {
        this.persistedGeneration = Math.max(this.persistedGeneration, generation)
      })
      this.writer = writing
      try {
        await writing
      } finally {
        if (this.writer === writing) this.writer = null
      }
    }
  }

  private async writeSnapshot(snapshot: SnapshotEnvelope): Promise<void> {
    // v8 serialization is intentionally confined to the dump boundary.
    const encoded = serialize(snapshot)
    const temporary = `${this.options.dumpPath}.${process.pid}.${randomUUID()}.tmp`
    let handle: FileHandle | null = null
    try {
      handle = await nodeFs.open(temporary, 'wx', 0o600)
      await handle.writeFile(encoded)
      await handle.sync()
      await handle.close()
      handle = null
      await nodeFs.rename(temporary, this.options.dumpPath)
      const directoryHandle = await nodeFs
        .open(dirname(this.options.dumpPath), 'r')
        .catch(() => null)
      if (directoryHandle !== null) {
        await directoryHandle.sync().catch(() => undefined)
        await directoryHandle.close().catch(() => undefined)
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await nodeFs.rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  /** Stop the unref timer and write one non-overlapping final snapshot. */
  close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise
    this.closed = true
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    const target = this.generation
    this.closePromise = (async () => {
      // A failed periodic/manual attempt must not prevent the final attempt.
      if (this.writer !== null) await this.writer.catch(() => undefined)
      await this.flushThrough(target)
    })()
    return this.closePromise
  }
}

// ---------------------------------------------------------------------------
// Process-global cache state
// ---------------------------------------------------------------------------

interface CacheState {
  cache: ProjectFileCache | null
  wikiTtlMs: number
  defaultTtlMs: number
  configuration: Promise<void>
}

const STATE_SYMBOL = Symbol.for('memon.project-file-cache.v2')

interface StateCarrier {
  [STATE_SYMBOL]?: CacheState
}

function state(): CacheState {
  const carrier = globalThis as unknown as StateCarrier
  let current = carrier[STATE_SYMBOL]
  if (current === undefined) {
    current = {
      cache: null,
      wikiTtlMs: DEFAULT_WIKI_TTL_MS,
      defaultTtlMs: DEFAULT_DOCUMENT_TTL_MS,
      configuration: Promise.resolve(),
    }
    carrier[STATE_SYMBOL] = current
  }
  return current
}

/** Startup configuration; changing it closes and snapshots the previous LRU. */
export function configureProjectFileCache(options?: FileCacheOptions): Promise<void> {
  const current = state()
  const configure = async () => {
    const previous = current.cache
    if (
      previous !== null &&
      options !== undefined &&
      resolve(previous.options.dumpPath) === resolve(options.dumpPath) &&
      previous.options.dumpIntervalMs === normalizeDumpIntervalMs(options.dumpIntervalMs) &&
      current.wikiTtlMs === options.wikiTtlMs &&
      current.defaultTtlMs === options.defaultTtlMs
    )
      return
    current.cache = null
    if (previous !== null) await previous.close().catch(() => undefined)

    if (options === undefined) {
      current.wikiTtlMs = DEFAULT_WIKI_TTL_MS
      current.defaultTtlMs = DEFAULT_DOCUMENT_TTL_MS
      return
    }
    current.wikiTtlMs = options.wikiTtlMs > 0 ? options.wikiTtlMs : DEFAULT_WIKI_TTL_MS
    current.defaultTtlMs = options.defaultTtlMs > 0 ? options.defaultTtlMs : DEFAULT_DOCUMENT_TTL_MS
    current.cache = await ProjectFileCache.open({
      dumpPath: options.dumpPath,
      dumpIntervalMs: options.dumpIntervalMs,
      wikiTtlMs: current.wikiTtlMs,
      defaultTtlMs: current.defaultTtlMs,
    })
  }
  const pending = current.configuration.then(configure, configure)
  current.configuration = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

export function getProjectFileCache(): ProjectFileCache | null {
  return state().cache
}

export function isPersistedOperation(operation: string): operation is PersistedOperation {
  return PERSISTED_OPERATIONS[operation] === true
}

/** Freshness lifetime for a cached document or listing path. */
export function projectFileTtlMs(root: string, absolutePath: string): number {
  const current = state()
  const relativePath = relative(root, absolutePath)
  const wikiRoot = `docs${sep}wiki`
  if (relativePath === wikiRoot || relativePath.startsWith(`${wikiRoot}${sep}`)) {
    return current.wikiTtlMs
  }
  return current.defaultTtlMs
}
