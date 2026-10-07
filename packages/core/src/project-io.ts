// project-io — physical project filesystem execution, isolated from the
// hosting process.
//
// Why this exists: every `fs/promises` content or metadata call runs on the
// process-wide libuv thread pool (4 workers by default). A project served over
// SSHFS can hold a worker for a whole SSH round trip — or indefinitely while
// the mount hangs — so four concurrent project reads starve *every* other file
// operation in the process: the local `config.yml` read, the settings page,
// the local SQLite cache. Worker threads share that same pool, so real
// isolation needs a separate process.
//
// Shape of this module:
//
//   * One child process per storage group. A hung mount therefore blocks only
//     the group that owns it; other groups and the hosting process keep their
//     own thread pools free.
//   * The child is a dumb executor: no cache, no policy, only bounded read descriptors. It
//     runs exactly the absolute paths the parent sends and answers with plain
//     data. Containment, read-only policy, root identity and every other
//     security decision stay in the parent (`project-file-store`), which only
//     ever sends paths it has already decided are allowed.
//   * Concurrency stays accounted by the store's scheduler. This module never
//     queues, limits or times out: a request stays pending exactly as long as
//     the physical operation does, so the scheduler's slot accounting keeps
//     describing real physical work.
//
// If the worker cannot start, the operation fails instead of silently putting
// project reads back onto the Web process's filesystem thread pool.

import { type ChildProcess, fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as nodeFs } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

export type DirEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface DirEntryData {
  name: string
  kind: DirEntryKind
}

/**
 * The own data properties of `fs.Stats` (`bigint: true` adds the `*Ns`
 * fields). `Stats` is not publicly constructible and its date accessors are
 * prototype getters, so the transported shape is the numeric fields only and
 * `ProjectStats` re-adds the surface callers use.
 */
export type StatsFields = Record<string, number | bigint>

export type MutationMethod =
  | 'writeFile'
  | 'appendFile'
  | 'mkdir'
  | 'rm'
  | 'rmdir'
  | 'unlink'
  | 'truncate'
  | 'chmod'
  | 'utimes'
  | 'rename'
  | 'copyFile'
  | 'cp'

/** Allowlisted mutating methods; the worker refuses anything else. */
export const MUTATION_METHODS: Record<MutationMethod, true> = {
  writeFile: true,
  appendFile: true,
  mkdir: true,
  rm: true,
  rmdir: true,
  unlink: true,
  truncate: true,
  chmod: true,
  utimes: true,
  rename: true,
  copyFile: true,
  cp: true,
}

/** The shape of an `fs/promises` mutating method, called dynamically. */
type MutationRunner = (...args: unknown[]) => Promise<unknown>

/** One operation to perform, without the correlation id. */
export type ProjectIoCall =
  | { op: 'readFile'; path: string; flag?: string; maxBytes?: number }
  | { op: 'openRead'; path: string }
  | { op: 'readAt'; readToken: string; offset: number; length: number }
  | { op: 'closeRead'; readToken: string }
  | { op: 'readRange'; path: string; offset: number; length: number }
  | { op: 'readdir'; path: string; maxBytes?: number }
  | { op: 'stat'; path: string; follow: boolean; bigint: boolean }
  | { op: 'realpath'; path: string }
  | { op: 'realpathNearest'; path: string }
  | { op: 'access'; path: string; mode: number }
  | { op: 'mutate'; method: MutationMethod; args: unknown[] }

export type ProjectIoRequest = ProjectIoCall & { id: number }

/** An errno error reduced to the fields that survive a process boundary. */
export interface SerializedErrno {
  message: string
  code?: string
  errno?: number
  syscall?: string
  path?: string
  dest?: string
}

export type ProjectIoResponse =
  | { kind: 'ready' }
  | { kind: 'result'; id: number; value: unknown }
  | { kind: 'error'; id: number; error: SerializedErrno }

/** Rebuild an errno error the worker reported, so `err.code` still works. */
function reviveErrno(serialized: SerializedErrno): NodeJS.ErrnoException {
  const error = new Error(serialized.message) as NodeJS.ErrnoException & { dest?: string }
  if (serialized.code !== undefined) error.code = serialized.code
  if (serialized.errno !== undefined) error.errno = serialized.errno
  if (serialized.syscall !== undefined) error.syscall = serialized.syscall
  if (serialized.path !== undefined) error.path = serialized.path
  if (serialized.dest !== undefined) error.dest = serialized.dest
  return error
}

function workerError(message: string, code: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = code
  error.syscall = 'projectIo'
  return error
}

// ---------------------------------------------------------------------------
// Reconstructed Stats
// ---------------------------------------------------------------------------

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000
const S_IFBLK = 0o060000
const S_IFCHR = 0o020000
const S_IFIFO = 0o010000
const S_IFSOCK = 0o140000

function dateOf(value: number | bigint | undefined): Date {
  if (typeof value === 'bigint') return new Date(Number(value))
  return new Date(value ?? 0)
}

/**
 * `fs.Stats` reconstruction for a transported or persisted observation. Node's
 * `Stats` is not publicly constructible; callers use the numeric fields, the
 * date accessors and the type predicates, all of which are derived here from
 * the transported fields only — nothing is invented.
 */
export class ProjectStats {
  constructor(fields: StatsFields) {
    Object.assign(this, fields)
  }

  private get modeNumber(): number {
    const mode = (this as unknown as StatsFields).mode
    return typeof mode === 'bigint' ? Number(mode) : (mode ?? 0)
  }

  private isType(type: number): boolean {
    return (this.modeNumber & S_IFMT) === type
  }

  get atime(): Date {
    return dateOf((this as unknown as StatsFields).atimeMs)
  }
  get mtime(): Date {
    return dateOf((this as unknown as StatsFields).mtimeMs)
  }
  get ctime(): Date {
    return dateOf((this as unknown as StatsFields).ctimeMs)
  }
  get birthtime(): Date {
    return dateOf((this as unknown as StatsFields).birthtimeMs)
  }

  isFile(): boolean {
    return this.isType(S_IFREG)
  }
  isDirectory(): boolean {
    return this.isType(S_IFDIR)
  }
  isSymbolicLink(): boolean {
    return this.isType(S_IFLNK)
  }
  isBlockDevice(): boolean {
    return this.isType(S_IFBLK)
  }
  isCharacterDevice(): boolean {
    return this.isType(S_IFCHR)
  }
  isFIFO(): boolean {
    return this.isType(S_IFIFO)
  }
  isSocket(): boolean {
    return this.isType(S_IFSOCK)
  }
}

export function direntKindOf(entry: {
  isSymbolicLink(): boolean
  isDirectory(): boolean
  isFile(): boolean
}): DirEntryKind {
  if (entry.isSymbolicLink()) return 'symlink'
  if (entry.isDirectory()) return 'directory'
  if (entry.isFile()) return 'file'
  return 'other'
}

// ---------------------------------------------------------------------------
// Direct execution (opt-out mode)
// ---------------------------------------------------------------------------

/**
 * Real path of `target`, resolving the deepest existing ancestor and keeping
 * the not-yet-existing remainder lexically.
 *
 * The child worker carries its own copy of this loop (it must stay import-free
 * so it can be spawned from either compiled output or source); keep the two in
 * step.
 */
export async function realpathNearest(target: string): Promise<string> {
  const tail: string[] = []
  let candidate = target
  for (;;) {
    try {
      const real = await nodeFs.realpath(candidate)
      return tail.length === 0 ? real : join(real, ...tail)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const parent = dirname(candidate)
      if ((code === 'ENOENT' || code === 'ENOTDIR') && parent !== candidate) {
        tail.unshift(basename(candidate))
        candidate = parent
        continue
      }
      throw error
    }
  }
}

/**
 * Execute requests whose mutation payload cannot cross a process boundary.
 * Ordinary project reads always use the isolated worker.
 */

const readLeases = new Map<
  string,
  {
    file: Awaited<ReturnType<typeof nodeFs.open>>
    fields: StatsFields
    deadline: number
    active: number
    closing: boolean
  }
>()
const READ_LEASE_MS = 5 * 60 * 1000
async function closeLease(token: string) {
  const lease = readLeases.get(token)
  if (!lease || (lease.closing && lease.active !== 0)) return
  lease.closing = true
  if (lease.active !== 0) return
  lease.active = -1
  try {
    await lease.file.close()
  } finally {
    readLeases.delete(token)
  }
}
const leaseSweep = setInterval(() => {
  for (const [token, lease] of readLeases)
    if (!lease.closing && lease.deadline <= Date.now())
      void closeLease(token).catch(() => undefined)
}, 1000)
leaseSweep.unref()

export async function executeProjectIo(request: ProjectIoRequest): Promise<unknown> {
  switch (request.op) {
    case 'openRead': {
      if (readLeases.size >= 256)
        throw Object.assign(new Error('read handle limit'), { code: 'LIMIT_EXCEEDED' })
      const token = randomUUID()
      // Reserve before opening: blocked opens count against the bound.
      const lease = {
        file: null as unknown as Awaited<ReturnType<typeof nodeFs.open>>,
        fields: {} as StatsFields,
        deadline: Infinity,
        active: 1,
        closing: false,
      }
      readLeases.set(token, lease)
      try {
        lease.file = await nodeFs.open(request.path, 'r')
        const stats = await lease.file.stat({ bigint: true })
        if (!stats.isFile())
          throw Object.assign(new Error('not a regular file'), { code: 'EINVAL' })
        lease.fields = Object.fromEntries(
          Object.entries(stats).map(([key, value]) => [
            key,
            typeof value === 'bigint' ? Number(value) : value,
          ]),
        ) as StatsFields
        lease.deadline = Date.now() + READ_LEASE_MS
        lease.active = 0
        return { readToken: token, fields: lease.fields, fileId: `${stats.dev}:${stats.ino}` }
      } catch (error) {
        try {
          await lease.file?.close()
        } finally {
          readLeases.delete(token)
        }
        throw error
      }
    }
    case 'readAt': {
      const lease = readLeases.get(request.readToken)
      if (!lease || lease.closing || lease.deadline <= Date.now())
        throw Object.assign(new Error('read handle expired'), { code: 'READ_HANDLE_EXPIRED' })
      if (
        !Number.isSafeInteger(request.offset) ||
        request.offset < 0 ||
        !Number.isSafeInteger(request.length) ||
        request.length < 1 ||
        request.length > 1024 * 1024 ||
        !Number.isSafeInteger(request.offset + request.length)
      )
        throw new RangeError('invalid read bounds')
      lease.active++
      lease.deadline = Date.now() + READ_LEASE_MS
      try {
        const bytes = Buffer.alloc(
          Math.min(request.length, Math.max(0, Number(lease.fields.size) - request.offset)),
        )
        const { bytesRead } = await lease.file.read(bytes, 0, bytes.length, request.offset)
        return bytes.subarray(0, bytesRead)
      } finally {
        lease.active--
        if (lease.closing && lease.active === 0) await closeLease(request.readToken)
      }
    }
    case 'closeRead':
      await closeLease(request.readToken)
      return null

    case 'readFile': {
      if (request.maxBytes !== undefined) {
        const file = await nodeFs.open(request.path, request.flag ?? 'r')
        try {
          const chunks: Buffer[] = []
          let size = 0
          for (;;) {
            const chunk = Buffer.alloc(Math.min(1024 * 1024, request.maxBytes + 1 - size))
            const { bytesRead } = await file.read(chunk, 0, chunk.length, null)
            if (!bytesRead) break
            size += bytesRead
            if (size > request.maxBytes)
              throw workerError('project read exceeds configured body limit', 'LIMIT_EXCEEDED')
            chunks.push(chunk.subarray(0, bytesRead))
          }
          return Buffer.concat(chunks, size)
        } finally {
          await file.close()
        }
      }
      return await nodeFs.readFile(
        request.path,
        request.flag === undefined ? undefined : { flag: request.flag },
      )
    }
    case 'readRange': {
      const file = await nodeFs.open(request.path, 'r')
      try {
        const stats = await file.stat()
        if (!stats.isFile()) throw workerError('range target is not a regular file', 'EINVAL')
        const bytes = Buffer.alloc(request.length)
        const result = await file.read(bytes, 0, bytes.length, request.offset)
        return { bytes: bytes.subarray(0, result.bytesRead), extent: stats.size }
      } finally {
        await file.close()
      }
    }
    case 'readdir': {
      if (request.maxBytes !== undefined) {
        const entries: DirEntryData[] = []
        let bytes = 2
        const dir = await nodeFs.opendir(request.path)
        for await (const entry of dir) {
          const item = { name: entry.name, kind: direntKindOf(entry) }
          bytes += Buffer.byteLength(JSON.stringify(item)) + (entries.length ? 1 : 0)
          if (bytes > request.maxBytes)
            throw workerError('listing exceeds maximum bytes', 'LIMIT_EXCEEDED')
          entries.push(item)
        }
        return entries
      }
      const dirents = await nodeFs.readdir(request.path, { withFileTypes: true })
      return dirents.map((entry) => ({ name: entry.name, kind: direntKindOf(entry) }))
    }
    case 'stat': {
      const options = request.bigint ? { bigint: true as const } : undefined
      const stats = request.follow
        ? await nodeFs.stat(request.path, options as never)
        : await nodeFs.lstat(request.path, options as never)
      return { ...(stats as unknown as StatsFields) }
    }
    case 'realpath':
      return await nodeFs.realpath(request.path)
    case 'realpathNearest':
      return await realpathNearest(request.path)
    case 'access':
      await nodeFs.access(request.path, request.mode)
      return null
    case 'mutate': {
      const run = (nodeFs as unknown as Record<string, MutationRunner | undefined>)[request.method]
      if (MUTATION_METHODS[request.method] !== true || run === undefined) {
        throw workerError(`unsupported project mutation '${request.method}'`, 'EINVAL')
      }
      return (await run(...request.args)) ?? null
    }
  }
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

const CHILD_BASENAME = 'project-io-child'

interface ChildEntry {
  path: string
  /** Source-mode entries need Node's type stripping to run at all. */
  typescript: boolean
}

/**
 * Locate the worker entry across every topology core is consumed from:
 * compiled `dist` (CLI, backend), TypeScript source (vitest, `tsx`), and a
 * bundled server chunk whose own directory holds no package files but which
 * can still resolve `@memon/core` through node_modules.
 *
 * The result is cached: this is local, synchronous work that must not repeat
 * per spawn, and the answer cannot change within a process.
 */
let childEntry: ChildEntry | null = null

function resolveChildEntry(): ChildEntry {
  if (childEntry !== null) return childEntry
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates: ChildEntry[] = [
    { path: join(here, `${CHILD_BASENAME}.js`), typescript: false },
    { path: join(here, `${CHILD_BASENAME}.ts`), typescript: true },
  ]

  const require = createRequire(import.meta.url)
  for (const specifier of [`@memon/core/${CHILD_BASENAME}`, '@memon/core/package.json']) {
    let resolved: string
    try {
      resolved = require.resolve(specifier)
    } catch {
      // Either the subpath target is not built yet or the package is not
      // reachable from here; the next candidate decides.
      continue
    }
    const packageDir = specifier.endsWith('package.json')
      ? dirname(resolved)
      : dirname(dirname(resolved))
    candidates.push(
      { path: resolved, typescript: resolved.endsWith('.ts') },
      { path: join(packageDir, 'dist', `${CHILD_BASENAME}.js`), typescript: false },
      { path: join(packageDir, 'src', `${CHILD_BASENAME}.ts`), typescript: true },
    )
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue
    childEntry = candidate
    return candidate
  }

  throw workerError(
    `project I/O worker entry '${CHILD_BASENAME}' was not found next to ${here} or under @memon/core; ` +
      'build @memon/core before starting the server',
    'ENOENT',
  )
}

/** One isolated executor. Owns no cache and no queue. */
class ProjectIoWorker {
  private child: ChildProcess | null = null
  private starting: Promise<ChildProcess> | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1

  constructor(
    readonly group: string,
    private readonly threadPoolSize: number,
  ) {}

  async send(request: ProjectIoCall): Promise<unknown> {
    const child = await this.ensure()
    const id = this.nextId
    this.nextId += 1
    const message = { ...request, id } as ProjectIoRequest
    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // A pending physical operation must keep the process alive; an idle
      // worker must not.
      child.ref()
      child.channel?.ref()
      let sent: boolean
      try {
        sent = child.send(message, (error) => {
          if (error) this.fail(id, error)
        })
      } catch (error) {
        // A payload that cannot cross the boundary (stream, iterable, abort
        // signal) is reported to the caller, which decides whether to run it
        // directly instead.
        this.settle(id, () => reject(error))
        return
      }
      if (!sent) this.fail(id, workerError('project I/O worker channel is full', 'EBUSY'))
    })
  }

  private fail(id: number, error: unknown): void {
    this.settle(id, (pending) => pending.reject(error))
  }

  private settle(id: number, apply: (pending: PendingRequest) => void): void {
    const pending = this.pending.get(id)
    this.pending.delete(id)
    if (pending !== undefined) apply(pending)
    if (this.pending.size === 0) this.idle()
  }

  private idle(): void {
    this.child?.unref()
    this.child?.channel?.unref()
  }

  private ensure(): Promise<ChildProcess> {
    if (this.child?.connected) return Promise.resolve(this.child)
    if (this.starting !== null) return this.starting
    this.starting = this.spawn().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private spawn(): Promise<ChildProcess> {
    const entry = resolveChildEntry()
    const child = fork(entry.path, [], {
      // Never inherit the host's exec flags (test runners, loaders): the
      // worker is a plain Node program.
      execArgv: entry.typescript ? ['--experimental-strip-types', '--no-warnings'] : [],
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: {
        ...process.env,
        // The worker exists to own blocking project I/O, so its pool must be
        // able to hold the group's scheduled concurrency.
        UV_THREADPOOL_SIZE: String(this.threadPoolSize),
        MEMON_PROJECT_IO_GROUP: this.group,
      },
    })
    child.on('message', (raw) => this.receive(raw as ProjectIoResponse))
    child.on('error', (error) => this.crash(error))
    child.on('exit', (code, signal) =>
      this.crash(
        workerError(
          `project I/O worker for storage group '${this.group}' exited (code ${String(code)}, signal ${String(signal)})`,
          'EIO',
        ),
      ),
    )

    return new Promise<ChildProcess>((resolve, reject) => {
      let settled = false
      const onMessage = (raw: unknown): void => {
        if ((raw as ProjectIoResponse).kind !== 'ready') return
        settled = true
        child.off('message', onMessage)
        this.child = child
        this.idle()
        resolve(child)
      }
      child.on('message', onMessage)
      child.once('exit', (code, signal) => {
        if (settled) return
        reject(
          workerError(
            `project I/O worker '${entry.path}' exited before becoming ready (code ${String(code)}, signal ${String(signal)}); ` +
              (entry.typescript
                ? 'running the worker from TypeScript source needs Node with type stripping (>= 22.6)'
                : 'the compiled worker could not start'),
            'EIO',
          ),
        )
      })
      child.once('error', (error) => {
        if (!settled) reject(error)
      })
    })
  }

  private receive(response: ProjectIoResponse): void {
    if (response.kind === 'ready') return
    if (response.kind === 'error') {
      this.fail(response.id, reviveErrno(response.error))
      return
    }
    this.settle(response.id, (pending) => pending.resolve(response.value))
  }

  /**
   * The worker died. Every in-flight operation fails with a hard error (never
   * a fabricated "missing" observation) and the next request spawns a fresh
   * worker. Nothing is retried here: retry policy belongs to the scheduler.
   */
  private crash(error: unknown): void {
    if (this.child !== null && !this.child.connected) this.child = null
    const pending = [...this.pending.entries()]
    this.pending.clear()
    for (const [, request] of pending) request.reject(error)
  }

  dispose(): void {
    const child = this.child
    this.child = null
    this.crash(workerError('project I/O worker was shut down', 'ECANCELED'))
    child?.kill()
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

const MIN_WORKER_THREADS = 8
const MAX_WORKER_THREADS = 128

class ProjectIoPool {
  private readonly workers = new Map<string, ProjectIoWorker>()
  private concurrency = 10

  /** Startup-only: the store's group concurrency sizes the worker pool. */
  configure(concurrency: number): void {
    if (Number.isFinite(concurrency) && concurrency > 0) this.concurrency = concurrency
  }

  private threadPoolSize(): number {
    return Math.min(
      Math.max(Math.ceil(this.concurrency) + 4, MIN_WORKER_THREADS),
      MAX_WORKER_THREADS,
    )
  }

  private worker(group: string): ProjectIoWorker {
    let worker = this.workers.get(group)
    if (worker === undefined) {
      worker = new ProjectIoWorker(group, this.threadPoolSize())
      this.workers.set(group, worker)
    }
    return worker
  }

  async run(group: string, request: ProjectIoCall): Promise<unknown> {
    return await this.worker(group).send(request)
  }

  async readFile(group: string, path: string, flag?: string, maxBytes?: number): Promise<Buffer> {
    const value = await this.run(group, {
      op: 'readFile',
      path,
      ...(flag === undefined ? {} : { flag }),
      ...(maxBytes === undefined ? {} : { maxBytes }),
    })
    return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array)
  }

  async readRange(
    group: string,
    path: string,
    offset: number,
    length: number,
  ): Promise<{ bytes: Buffer; extent: number }> {
    const result = (await this.run(group, { op: 'readRange', path, offset, length })) as {
      bytes: Uint8Array
      extent: number
    }
    return { bytes: Buffer.from(result.bytes), extent: result.extent }
  }

  async readdir(group: string, path: string, maxBytes?: number): Promise<DirEntryData[]> {
    return (await this.run(group, { op: 'readdir', path, maxBytes })) as DirEntryData[]
  }

  async stat(group: string, path: string, follow: boolean, bigint = false): Promise<StatsFields> {
    return (await this.run(group, { op: 'stat', path, follow, bigint })) as StatsFields
  }

  async realpath(group: string, path: string): Promise<string> {
    return (await this.run(group, { op: 'realpath', path })) as string
  }

  async realpathNearest(group: string, path: string): Promise<string> {
    return (await this.run(group, { op: 'realpathNearest', path })) as string
  }

  async access(group: string, path: string, mode: number): Promise<void> {
    await this.run(group, { op: 'access', path, mode })
  }

  /**
   * Run a mutation in the worker and answer with its result (`mkdir` reports
   * the first created directory). A payload that cannot cross the process
   * boundary (stream, async iterable, abort signal) is executed directly
   * instead: still the real operation under the store's slot, it simply
   * cannot be isolated.
   */
  async mutate(group: string, method: MutationMethod, args: unknown[]): Promise<unknown> {
    try {
      const value = await this.worker(group).send({ op: 'mutate', method, args })
      return value === null ? undefined : value
    } catch (error) {
      // Non-cloneable stream/signal payloads retain native Node semantics.
      const name = (error as { name?: string } | null)?.name
      if (name !== 'DataCloneError' && name !== 'TypeError') throw error
    }
    const value = await executeProjectIo({ id: 0, op: 'mutate', method, args })
    return value === null ? undefined : value
  }

  shutdown(): void {
    for (const worker of this.workers.values()) worker.dispose()
    this.workers.clear()
  }
}

const POOL_SYMBOL = Symbol.for('memon.project-io-pool.v1')

interface PoolCarrier {
  [POOL_SYMBOL]?: ProjectIoPool
}

/** Process-global pool (survives duplicated Next.js server bundles). */
export function getProjectIo(): ProjectIoPool {
  const carrier = globalThis as unknown as PoolCarrier
  let pool = carrier[POOL_SYMBOL]
  if (pool === undefined) {
    pool = new ProjectIoPool()
    carrier[POOL_SYMBOL] = pool
  }
  return pool
}

/** Stop every worker. Physical operations in flight fail; nothing is queued. */
export function shutdownProjectIo(): void {
  getProjectIo().shutdown()
}
