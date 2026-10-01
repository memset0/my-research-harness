// Deterministic coverage of the Project file store's high-risk concurrency
// paths: queue saturation, human promotion and anti-starvation, success and
// failure backoff, and storage loss.
//
// Everything is injected without touching production code:
//   * the wall and monotonic clocks through faked `Date` / `performance`
//     (real timers and `setImmediate` keep settling promises);
//   * physical I/O through spies on the process-global `getProjectIo()` pool,
//     backed by an in-memory table that can answer, fail or block;
//   * the OS mount table through a mocked `readMountTable`;
//   * a fresh store per test by dropping its `globalThis` carrier.

import { resolve } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type MountIdentity, readMountTable } from './mount-table.js'
import {
  configureProjectFileStore,
  type FileOperationMetrics,
  getFileOperationMetrics,
  getProjectFileStatus,
  type ProjectFileContext,
  projectFs,
  withProjectFileContext,
} from './project-file-store.js'
import { type DirEntryData, getProjectIo, type StatsFields } from './project-io.js'

vi.mock('./mount-table.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mount-table.js')>()
  return { ...actual, readMountTable: vi.fn(async () => null) }
})

const STORE_SYMBOL = Symbol.for('memon.project-file-store.v2')
const ROOT = resolve('/virtual/project-a')
const MAX_QUEUED_PER_GROUP = 2_048

function at(name: string): string {
  return `${ROOT}/${name}`
}

function errno(code: string, syscall: string, path: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: fake ${syscall} '${path}'`) as NodeJS.ErrnoException
  error.code = code
  error.syscall = syscall
  error.path = path
  return error
}

/** In-memory physical storage behind the isolated worker pool. */
class FakeIo {
  readonly files = new Map<string, string>()
  readonly dirs = new Map<string, DirEntryData[]>()
  /** `op:path` (or `op:*`) -> errno code thrown by the physical call. */
  readonly failures = new Map<string, string>()
  readonly gates = new Map<string, Promise<void>>()
  readonly log: string[] = []

  block(path: string): () => void {
    let release!: () => void
    this.gates.set(
      path,
      new Promise<void>((done) => {
        release = done
      }),
    )
    return () => {
      this.gates.delete(path)
      release()
    }
  }

  calls(op: string, path: string): number {
    return this.log.filter((line) => line === `${op}:${path}`).length
  }

  private fail(op: string, path: string): void {
    const code = this.failures.get(`${op}:${path}`) ?? this.failures.get(`${op}:*`)
    if (code !== undefined) throw errno(code, op, path)
  }

  install(): void {
    const io = getProjectIo()
    vi.spyOn(io, 'realpath').mockImplementation(async (_group, path) => {
      this.log.push(`realpath:${path}`)
      this.fail('realpath', path)
      return path
    })
    vi.spyOn(io, 'realpathNearest').mockImplementation(async (_group, path) => {
      this.fail('realpathNearest', path)
      return path
    })
    vi.spyOn(io, 'readFile').mockImplementation(async (_group, path) => {
      this.log.push(`readFile:${path}`)
      const gate = this.gates.get(path)
      if (gate !== undefined) await gate
      this.fail('readFile', path)
      const body = this.files.get(path)
      if (body === undefined) throw errno('ENOENT', 'open', path)
      return Buffer.from(body, 'utf8')
    })
    vi.spyOn(io, 'readdir').mockImplementation(async (_group, path) => {
      this.log.push(`readdir:${path}`)
      this.fail('readdir', path)
      const entries = this.dirs.get(path)
      if (entries === undefined) throw errno('ENOENT', 'scandir', path)
      return entries
    })
    vi.spyOn(io, 'stat').mockImplementation(async (_group, path) => {
      this.log.push(`stat:${path}`)
      this.fail('stat', path)
      const body = this.files.get(path)
      if (body === undefined) throw errno('ENOENT', 'stat', path)
      const fields: StatsFields = { mode: 0o100644, size: body.length, mtimeMs: 1, ino: 7 }
      return fields
    })
  }
}

let io: FakeIo
const mountTable = vi.mocked(readMountTable)

/** Let every pending promise chain (and the dispatch loops it drives) settle. */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((done) => setImmediate(done))
}

function advance(ms: number): void {
  vi.advanceTimersByTime(ms)
}

function freshStore(): void {
  delete (globalThis as Record<symbol, unknown>)[STORE_SYMBOL]
}

const automatic = { root: ROOT, reason: 'automatic' as const }
const human = { root: ROOT, reason: 'open' as const }
const manual = { root: ROOT, reason: 'manual' as const }

function read(context: ProjectFileContext, name: string) {
  return withProjectFileContext(context, () => projectFs.readFile(at(name), 'utf8'))
}

/** Settle a promise into its value or its error, so nothing is left unhandled. */
function settled<T>(promise: Promise<T>): Promise<T | NodeJS.ErrnoException> {
  return promise.then(
    (value) => value,
    (error: NodeJS.ErrnoException) => error,
  )
}

function readSeries(metrics: FileOperationMetrics, origin: 'human' | 'automatic') {
  return metrics.series.find(
    (entry) =>
      entry.storageGroup === 'default' && entry.operation === 'readFile' && entry.origin === origin,
  )
}

beforeEach(() => {
  freshStore()
  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  io = new FakeIo()
  io.install()
  mountTable.mockReset()
  mountTable.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(() => {
  freshStore()
})

describe('queue saturation at MAX_QUEUED_PER_GROUP', () => {
  it('refuses automatic demand, lets human demand displace the oldest automatic task', async () => {
    configureProjectFileStore({ concurrency: 1 })
    io.files.set(at('blocker'), 'b')
    const releaseBlocker = io.block(at('blocker'))
    const blocker = settled(read(automatic, 'blocker'))
    await flush()
    expect(getFileOperationMetrics().inFlight).toBe(1)

    const queued: Promise<unknown>[] = []
    for (let i = 0; i < MAX_QUEUED_PER_GROUP; i += 1) {
      io.files.set(at(`q${i}`), `q${i}`)
      queued.push(settled(read(automatic, `q${i}`)))
    }
    await flush()
    expect(getFileOperationMetrics().queued).toBe(MAX_QUEUED_PER_GROUP)

    // One more automatic operation is refused honestly, never as "missing".
    await expect(read(automatic, 'overflow')).rejects.toMatchObject({
      code: 'EBUSY',
      errno: -16,
      syscall: 'read',
      path: at('overflow'),
    })
    // The refusal is not recorded as the entry's error state.
    expect(getProjectFileStatus(ROOT).error).toBeNull()

    // A demand for a key that is already queued joins it instead of queueing.
    const joined = settled(read(automatic, 'q5'))
    await flush()
    expect(getFileOperationMetrics().queued).toBe(MAX_QUEUED_PER_GROUP)
    expect(getFileOperationMetrics().byOperation.readFile.coalesced).toBe(1)

    // A human caller displaces the OLDEST queued automatic task.
    io.files.set(at('person'), 'person')
    const person = settled(read(human, 'person'))
    await flush()
    expect(await queued[0]).toMatchObject({ code: 'EBUSY', path: at('q0') })
    expect(getFileOperationMetrics().queued).toBe(MAX_QUEUED_PER_GROUP)

    releaseBlocker()
    expect(await blocker).toBe('b')
    expect(await person).toBe('person')
    expect(await joined).toBe('q5')
    const results = await Promise.all(queued)
    expect(results[1]).toBe('q1')
    expect(results[MAX_QUEUED_PER_GROUP - 1]).toBe(`q${MAX_QUEUED_PER_GROUP - 1}`)
    // The human task ran first after the blocker, ahead of every automatic one.
    const order = io.log.filter((line) => line.startsWith('readFile:'))
    expect(order[0]).toBe(`readFile:${at('blocker')}`)
    expect(order[1]).toBe(`readFile:${at('person')}`)
    // The displaced and refused paths never reached the disk.
    expect(io.calls('readFile', at('q0'))).toBe(0)
    expect(io.calls('readFile', at('overflow'))).toBe(0)
    expect(getFileOperationMetrics().queued).toBe(0)
  })

  it('refuses even human demand when every queued task is human', async () => {
    configureProjectFileStore({ concurrency: 1 })
    io.files.set(at('blocker'), 'b')
    const releaseBlocker = io.block(at('blocker'))
    const blocker = settled(read(human, 'blocker'))
    const queued: Promise<unknown>[] = []
    for (let i = 0; i < MAX_QUEUED_PER_GROUP; i += 1) {
      io.files.set(at(`h${i}`), `h${i}`)
      queued.push(settled(read(human, `h${i}`)))
    }
    await flush()
    expect(getFileOperationMetrics().queued).toBe(MAX_QUEUED_PER_GROUP)

    await expect(read(human, 'late-human')).rejects.toMatchObject({ code: 'EBUSY' })
    await expect(read(automatic, 'late-automatic')).rejects.toMatchObject({ code: 'EBUSY' })

    releaseBlocker()
    await blocker
    const results = await Promise.all(queued)
    expect(results.every((value, i) => value === `h${i}`)).toBe(true)
  })
})

describe('human promotion and anti-starvation', () => {
  it('promotes a queued automatic task when a person asks for the same key', async () => {
    configureProjectFileStore({ concurrency: 1 })
    for (const name of ['blocker', 'a', 'b']) io.files.set(at(name), name)
    const releaseBlocker = io.block(at('blocker'))
    const blocker = settled(read(automatic, 'blocker'))
    const a = settled(read(automatic, 'a'))
    const bAutomatic = settled(read(automatic, 'b'))
    await flush()
    const bHuman = settled(read(human, 'b'))
    await flush()
    expect(getFileOperationMetrics().queued).toBe(2)

    releaseBlocker()
    expect(await Promise.all([blocker, a, bAutomatic, bHuman])).toEqual(['blocker', 'a', 'b', 'b'])

    // b was enqueued after a, but the promotion put it first.
    expect(io.log.filter((line) => line.startsWith('readFile:'))).toEqual([
      `readFile:${at('blocker')}`,
      `readFile:${at('b')}`,
      `readFile:${at('a')}`,
    ])
    const metrics = getFileOperationMetrics()
    // One physical read for b, accounted once, under the promoted origin.
    expect(io.calls('readFile', at('b'))).toBe(1)
    expect(readSeries(metrics, 'human')?.samples).toBe(1)
    expect(readSeries(metrics, 'human')?.coalesced).toBe(1)
    expect(readSeries(metrics, 'automatic')?.samples).toBe(2)
  })

  it('lets automatic work that waited max(1s, 5 x heartbeat) compete with newer human work', async () => {
    configureProjectFileStore({ concurrency: 1, heartbeatMs: 30_000 })
    for (const name of ['blocker', 'old', 'new']) io.files.set(at(name), name)
    const releaseBlocker = io.block(at('blocker'))
    const blocker = settled(read(automatic, 'blocker'))
    const old = settled(read(automatic, 'old'))
    await flush()
    advance(150_000)
    const fresh = settled(read(human, 'new'))
    await flush()
    releaseBlocker()
    await Promise.all([blocker, old, fresh])
    expect(io.log.filter((line) => line.startsWith('readFile:')).slice(1)).toEqual([
      `readFile:${at('old')}`,
      `readFile:${at('new')}`,
    ])
  })

  it('keeps human work first while automatic work is younger than the aging bound', async () => {
    configureProjectFileStore({ concurrency: 1, heartbeatMs: 30_000 })
    for (const name of ['blocker', 'old', 'new']) io.files.set(at(name), name)
    const releaseBlocker = io.block(at('blocker'))
    const blocker = settled(read(automatic, 'blocker'))
    const old = settled(read(automatic, 'old'))
    await flush()
    advance(149_999)
    const fresh = settled(read(human, 'new'))
    await flush()
    releaseBlocker()
    await Promise.all([blocker, old, fresh])
    expect(io.log.filter((line) => line.startsWith('readFile:')).slice(1)).toEqual([
      `readFile:${at('new')}`,
      `readFile:${at('old')}`,
    ])
  })
})

describe('backoff', () => {
  it('doubles unchanged automatic intervals to the cap and resets on manual refresh', async () => {
    io.files.set(at('doc.md'), 'body')
    const reads = () => io.calls('readFile', at('doc.md'))

    expect(await read(automatic, 'doc.md')).toBe('body')
    expect(reads()).toBe(1)

    // No attention: maintenance range 300 s -> 600 s -> 900 s (cap).
    for (const interval of [300_000, 600_000, 900_000, 900_000]) {
      advance(interval - 1)
      expect(await read(automatic, 'doc.md')).toBe('body')
      await flush()
      const before = reads()
      advance(1)
      // Due: answered from cache at once, verified in the background.
      expect(await read(automatic, 'doc.md')).toBe('body')
      await flush()
      expect(reads()).toBe(before + 1)
    }

    // A manual refresh makes the key due immediately.
    const beforeManual = reads()
    expect(await read(manual, 'doc.md')).toBe('body')
    await flush()
    expect(reads()).toBe(beforeManual + 1)
    // The reset interval restarts at the active-file floor (5 s), and the
    // unchanged verification doubled it once: next check after 10 s.
    advance(9_999)
    await read(automatic, 'doc.md')
    await flush()
    expect(reads()).toBe(beforeManual + 1)
    advance(1)
    await read(automatic, 'doc.md')
    await flush()
    expect(reads()).toBe(beforeManual + 2)
  })

  it('restarts the interval at its floor when the observed content changes', async () => {
    io.files.set(at('doc.md'), 'one')
    const reads = () => io.calls('readFile', at('doc.md'))
    await read(automatic, 'doc.md')
    advance(300_000)
    await read(automatic, 'doc.md')
    await flush()
    expect(reads()).toBe(2) // unchanged -> next interval 600 s

    io.files.set(at('doc.md'), 'two')
    advance(600_000)
    expect(await read(automatic, 'doc.md')).toBe('one')
    await flush()
    expect(reads()).toBe(3)
    expect(await read(automatic, 'doc.md')).toBe('two')
    // Changed -> back to the 300 s floor instead of 1200 s.
    advance(300_000)
    await read(automatic, 'doc.md')
    await flush()
    expect(reads()).toBe(4)
  })

  it('replays a failure until due and backs off 15 s -> 5 min by a factor of 2', async () => {
    io.files.set(at('doc.md'), 'body')
    io.failures.set(`readFile:${at('doc.md')}`, 'EIO')
    const reads = () => io.calls('readFile', at('doc.md'))

    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    expect(reads()).toBe(1)
    expect(getProjectFileStatus(ROOT)).toMatchObject({ error: 'EIO', oldestVerifiedAt: null })

    for (const backoff of [15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
      advance(backoff - 1)
      // The cached hard error is replayed with no physical retry.
      await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
      const before = reads()
      expect(before).toBeGreaterThan(0)
      advance(1)
      await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
      expect(reads()).toBe(before + 1)
    }

    // Success clears the error and the failure count.
    io.failures.clear()
    advance(300_000)
    expect(await read(automatic, 'doc.md')).toBe('body')
    const verified = getProjectFileStatus(ROOT)
    expect(verified.error).toBeNull()
    expect(verified.oldestVerifiedAt).not.toBeNull()

    // The next failure starts again at the 15 s floor, keeps serving the
    // retained content, and does not advance the successful observation time.
    io.failures.set(`readFile:${at('doc.md')}`, 'EIO')
    advance(300_000)
    expect(await read(automatic, 'doc.md')).toBe('body')
    await flush()
    const failing = getProjectFileStatus(ROOT)
    expect(failing.error).toBe('EIO')
    expect(failing.oldestVerifiedAt).toBe(verified.oldestVerifiedAt)
    const before = reads()
    advance(14_999)
    expect(await read(automatic, 'doc.md')).toBe('body')
    await flush()
    expect(reads()).toBe(before)
    advance(1)
    expect(await read(automatic, 'doc.md')).toBe('body')
    await flush()
    expect(reads()).toBe(before + 1)
  })

  it('a manual refresh during an outage retries at once and restarts the failure backoff', async () => {
    io.failures.set(`readFile:${at('doc.md')}`, 'EIO')
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    advance(15_000)
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    // Two failures: next automatic retry in 30 s, but a manual refresh is now.
    const before = io.calls('readFile', at('doc.md'))
    await expect(read(manual, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    expect(io.calls('readFile', at('doc.md'))).toBe(before + 1)
    advance(14_999)
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    expect(io.calls('readFile', at('doc.md'))).toBe(before + 1)
    advance(1)
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    expect(io.calls('readFile', at('doc.md'))).toBe(before + 2)
  })
})

describe('storage loss', () => {
  it('reports a root realpath I/O error, does not memoise the root, and recovers', async () => {
    io.files.set(at('doc.md'), 'body')
    io.failures.set(`realpath:${ROOT}`, 'EIO')
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'EIO' })
    expect(getProjectFileStatus(ROOT).error).toBe('EIO')
    expect(io.calls('readFile', at('doc.md'))).toBe(0)

    io.failures.clear()
    advance(15_000)
    expect(await read(automatic, 'doc.md')).toBe('body')
    expect(getProjectFileStatus(ROOT).error).toBeNull()
    expect(io.calls('realpath', ROOT)).toBe(2)
    // Memoised after the first success.
    await read(automatic, 'other.md').catch(() => undefined)
    expect(io.calls('realpath', ROOT)).toBe(2)
  })

  it('treats a missing root as lexical and caches the missing file as a negative', async () => {
    io.failures.set(`realpath:${ROOT}`, 'ENOENT')
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(read(automatic, 'doc.md')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(io.calls('readFile', at('doc.md'))).toBe(1)
    expect(getProjectFileStatus(ROOT).error).toBeNull()
    expect(getProjectFileStatus(ROOT).incomplete).toBe(false)
  })

  it('classifies stat ENOENT as missing and EIO / ETIMEDOUT as errors over retained data', async () => {
    const stat = (context: ProjectFileContext, name: string) =>
      withProjectFileContext(context, () => projectFs.stat(at(name)))

    await expect(stat(automatic, 'absent')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(automatic, 'absent')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(io.calls('stat', at('absent'))).toBe(1)
    expect(getProjectFileStatus(ROOT).error).toBeNull()

    io.failures.set(`stat:${at('broken')}`, 'EIO')
    await expect(stat(automatic, 'broken')).rejects.toMatchObject({ code: 'EIO' })
    expect(getProjectFileStatus(ROOT).error).toBe('EIO')

    io.files.set(at('present'), 'xyz')
    const page = { ...automatic, attentionId: 'tab-present' }
    const first = await stat(page, 'present')
    expect(first.isFile()).toBe(true)
    expect(first.size).toBe(3)
    const verifiedAt = getProjectFileStatus(ROOT, 'tab-present').oldestVerifiedAt
    io.failures.set(`stat:${at('present')}`, 'ETIMEDOUT')
    // The manual refresh answers from cache; its verification times out.
    const retained = await stat({ ...page, reason: 'manual' }, 'present')
    await flush()
    expect(retained.size).toBe(3)
    expect(io.calls('stat', at('present'))).toBe(2)
    expect(getProjectFileStatus(ROOT, 'tab-present')).toMatchObject({
      error: 'ETIMEDOUT',
      oldestVerifiedAt: verifiedAt,
    })
    expect((await stat(page, 'present')).size).toBe(3)
  })

  it('refuses I/O with ENXIO after the mount vanishes, keeps cached data, and recovers on remount', async () => {
    const sshfs: MountIdentity = { mountPoint: ROOT, fsType: 'fuse.sshfs', source: 'host:/srv' }
    const rootfs: MountIdentity = { mountPoint: '/', fsType: 'ext4', source: '/dev/root' }
    mountTable.mockResolvedValue([rootfs, sshfs])
    io.files.set(at('doc.md'), 'body')
    io.files.set(at('new.md'), 'new')
    expect(await read(automatic, 'doc.md')).toBe('body')
    const verifiedAt = getProjectFileStatus(ROOT).oldestVerifiedAt

    // Unmounted: the mountpoint reverts to an ordinary local directory.
    mountTable.mockResolvedValue([rootfs])
    advance(1_000) // mount-table snapshot TTL
    expect(await read(manual, 'doc.md')).toBe('body')
    await flush()
    const lost = getProjectFileStatus(ROOT)
    expect(lost.error).toBe('ENXIO')
    expect(lost.oldestVerifiedAt).toBe(verifiedAt)
    await expect(read(automatic, 'new.md')).rejects.toMatchObject({
      code: 'ENXIO',
      errno: -6,
      syscall: 'readFile',
      path: ROOT,
    })
    // No physical read reached the replaced mountpoint.
    expect(io.calls('readFile', at('new.md'))).toBe(0)

    // The same storage remounted is accepted again.
    mountTable.mockResolvedValue([rootfs, { ...sshfs }])
    advance(15_000)
    expect(await read(automatic, 'new.md')).toBe('new')
    expect(await read(manual, 'doc.md')).toBe('body')
    await flush()
    expect(getProjectFileStatus(ROOT).error).toBeNull()
  })
})

describe('caller abort on an isolated read', () => {
  it('stops the caller waiting while the worker call completes on its own', async () => {
    io.files.set(at('slow.md'), 'slow')
    const release = io.block(at('slow.md'))
    const controller = new AbortController()
    const reading = withProjectFileContext(human, () =>
      projectFs.readFile(at('slow.md'), { encoding: 'utf8', signal: controller.signal }),
    )
    await flush()
    expect(io.calls('readFile', at('slow.md'))).toBe(1)
    controller.abort(new Error('navigated away'))
    await expect(reading).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' })
    // The physical operation is not cancelled; it finishes normally later.
    const worker = vi.mocked(getProjectIo().readFile).mock.results[0]!.value as Promise<Buffer>
    release()
    expect((await worker).toString('utf8')).toBe('slow')
    // Uncached reads with distinct semantics hold no scheduler slot.
    expect(getFileOperationMetrics()).toMatchObject({ inFlight: 0, queued: 0 })
  })
})
