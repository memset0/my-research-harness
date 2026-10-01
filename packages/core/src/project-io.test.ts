// The isolated project I/O pool, driven through a fake `fork()` so worker
// start-up, crashes, a full IPC channel and shutdown are deterministic. No
// child process is ever spawned here.

import { EventEmitter } from 'node:events'
import { promises as nodeFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeProjectIo, getProjectIo, shutdownProjectIo } from './project-io.js'

const fake = vi.hoisted(() => {
  const state = {
    children: [] as unknown[],
    /** Send `ready` automatically after a fork. */
    autoReady: true,
    // biome-ignore lint/suspicious/noExplicitAny: assigned once the class exists
    Child: null as any,
  }
  return state
})

class FakeChild extends EventEmitter {
  connected = true
  readonly sent: Record<string, unknown>[] = []
  /** What `send()` returns (false = the channel is full). */
  sendResult = true
  /** Thrown synchronously by `send()` (a payload that cannot be cloned). */
  sendThrows: Error | null = null
  /** Passed to the send callback (an asynchronous channel error). */
  sendCallbackError: Error | null = null
  readonly channel = { ref: vi.fn(), unref: vi.fn() }
  readonly ref = vi.fn()
  readonly unref = vi.fn()
  readonly kill = vi.fn(() => {
    this.connected = false
    return true
  })

  constructor(
    readonly path: string,
    readonly options: { env: Record<string, string>; execArgv: string[]; serialization: string },
  ) {
    super()
  }

  send(message: Record<string, unknown>, callback?: (error: Error | null) => void): boolean {
    if (this.sendThrows !== null) throw this.sendThrows
    this.sent.push(message)
    if (callback !== undefined) {
      const error = this.sendCallbackError
      queueMicrotask(() => callback(error))
    }
    return this.sendResult
  }

  ready(): void {
    this.emit('message', { kind: 'ready' })
  }

  reply(id: number, value: unknown): void {
    this.emit('message', { kind: 'result', id, value })
  }

  die(code: number | null, signal: string | null = null): void {
    this.connected = false
    this.emit('exit', code, signal)
  }

  lastId(): number {
    return this.sent.at(-1)!.id as number
  }
}
fake.Child = FakeChild

vi.mock('node:child_process', () => ({
  fork: vi.fn((path: string, _args: string[], options: never) => {
    const child = new fake.Child(path, options)
    fake.children.push(child)
    if (fake.autoReady) setImmediate(() => child.ready())
    return child
  }),
}))

const POOL_SYMBOL = Symbol.for('memon.project-io-pool.v1')

function children(): FakeChild[] {
  return fake.children as FakeChild[]
}

async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((done) => setImmediate(done))
}

beforeEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_SYMBOL]
  fake.children.length = 0
  fake.autoReady = true
})

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[POOL_SYMBOL]
})

describe('project I/O worker pool', () => {
  it('forks one worker per storage group and round-trips a request', async () => {
    const pool = getProjectIo()
    const reading = pool.readFile('group-a', '/data/a.md')
    await flush()
    const [child] = children()
    expect(child).toBeDefined()
    expect(child!.path).toMatch(/project-io-child\.(ts|js)$/)
    expect(child!.options.serialization).toBe('advanced')
    expect(child!.options.env.MEMON_PROJECT_IO_GROUP).toBe('group-a')
    expect(child!.options.env.UV_THREADPOOL_SIZE).toBe('14')
    expect(child!.sent).toEqual([{ op: 'readFile', path: '/data/a.md', id: 1 }])
    // A pending operation keeps the process alive.
    expect(child!.ref).toHaveBeenCalled()

    child!.reply(1, new Uint8Array([104, 105]))
    const bytes = await reading
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(bytes.toString('utf8')).toBe('hi')
    // Idle again: the worker no longer holds the process open.
    expect(child!.unref).toHaveBeenCalled()

    // A second group gets its own worker; the first is reused.
    const other = pool.stat('group-b', '/data/b', true)
    const again = pool.realpath('group-a', '/data')
    await flush()
    expect(children()).toHaveLength(2)
    children()[1]!.reply(1, { size: 1 })
    child!.reply(2, '/data')
    expect(await other).toEqual({ size: 1 })
    expect(await again).toBe('/data')
  })

  it('revives errno fields of a worker error reply', async () => {
    const reading = getProjectIo().readFile('g', '/data/x')
    await flush()
    const child = children()[0]!
    child.emit('message', {
      kind: 'error',
      id: child.lastId(),
      error: {
        message: 'EACCES: denied',
        code: 'EACCES',
        errno: -13,
        syscall: 'open',
        path: '/data/x',
        dest: '/data/y',
      },
    })
    const error = await reading.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message: 'EACCES: denied',
      code: 'EACCES',
      errno: -13,
      syscall: 'open',
      path: '/data/x',
      dest: '/data/y',
    })
  })

  it('fails every pending operation when the worker crashes and respawns on the next call', async () => {
    const pool = getProjectIo()
    const first = pool.readFile('g', '/data/1')
    const second = pool.readdir('g', '/data')
    const healthy = pool.readFile('other', '/data/2')
    await flush()
    const [child, otherChild] = children()
    child!.die(1)
    for (const pending of [first, second]) {
      await expect(pending).rejects.toMatchObject({
        code: 'EIO',
        syscall: 'projectIo',
        message: expect.stringContaining("storage group 'g' exited (code 1"),
      })
    }
    // Another group's worker is unaffected.
    otherChild!.reply(1, new Uint8Array([1]))
    expect((await healthy).length).toBe(1)

    // Nothing is retried; the next request starts a fresh worker.
    const retry = pool.readFile('g', '/data/1')
    await flush()
    expect(children()).toHaveLength(3)
    const respawned = children()[2]!
    // Request ids keep counting per group across the respawn.
    expect(respawned.lastId()).toBe(3)
    respawned.reply(respawned.lastId(), new Uint8Array([2]))
    expect((await retry)[0]).toBe(2)
  })

  it('reports a full IPC channel as EBUSY', async () => {
    const pool = getProjectIo()
    const warm = pool.access('g', '/data', 4)
    await flush()
    const child = children()[0]!
    child.reply(child.lastId(), null)
    await warm
    child.sendResult = false
    await expect(pool.readFile('g', '/data/x')).rejects.toMatchObject({
      code: 'EBUSY',
      syscall: 'projectIo',
      message: 'project I/O worker channel is full',
    })
  })

  it('rejects with the asynchronous send error reported by the channel', async () => {
    const pool = getProjectIo()
    const warm = pool.realpathNearest('g', '/data/new')
    await flush()
    const child = children()[0]!
    child.reply(child.lastId(), '/data/new')
    expect(await warm).toBe('/data/new')
    const failure = Object.assign(new Error('channel closed'), { code: 'ERR_IPC_CHANNEL_CLOSED' })
    child.sendCallbackError = failure
    await expect(pool.readFile('g', '/data/x')).rejects.toBe(failure)
  })

  it('fails a start that exits before the worker is ready, then tries a fresh start', async () => {
    fake.autoReady = false
    const pool = getProjectIo()
    const reading = pool.readFile('g', '/data/x')
    await flush()
    children()[0]!.die(1)
    await expect(reading).rejects.toMatchObject({
      code: 'EIO',
      message: expect.stringContaining('exited before becoming ready'),
    })

    fake.autoReady = true
    const retry = pool.readFile('g', '/data/x')
    await flush()
    expect(children()).toHaveLength(2)
    const child = children()[1]!
    child.reply(child.lastId(), new Uint8Array([7]))
    expect((await retry)[0]).toBe(7)
  })

  it('cancels pending work and kills workers on shutdown (there is no per-operation timeout)', async () => {
    const reading = getProjectIo().readFile('g', '/data/hung')
    await flush()
    const child = children()[0]!
    // A hung operation simply stays pending: the pool never times it out.
    await flush(10)
    let settled = false
    void reading.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await flush()
    expect(settled).toBe(false)

    shutdownProjectIo()
    await expect(reading).rejects.toMatchObject({
      code: 'ECANCELED',
      message: 'project I/O worker was shut down',
    })
    expect(child.kill).toHaveBeenCalled()
  })

  it('runs a mutation whose payload cannot cross the process boundary directly', async () => {
    const pool = getProjectIo()
    const warm = pool.readFile('g', '/data/x')
    await flush()
    const child = children()[0]!
    child.reply(child.lastId(), new Uint8Array())
    await warm

    const dir = await nodeFs.mkdtemp(join(tmpdir(), 'memon-project-io-'))
    try {
      const cloneError = new Error('could not be cloned')
      cloneError.name = 'DataCloneError'
      child.sendThrows = cloneError
      const target = join(dir, 'made')
      expect(await pool.mutate('g', 'mkdir', [target, { recursive: true }])).toBe(target)
      expect((await nodeFs.stat(target)).isDirectory()).toBe(true)

      // Any other synchronous send failure is the caller's error.
      const other = Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
      child.sendThrows = other
      await expect(pool.mutate('g', 'mkdir', [join(dir, 'never')])).rejects.toBe(other)
      await expect(nodeFs.stat(join(dir, 'never'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await nodeFs.rm(dir, { recursive: true, force: true })
    }
  })

  it('maps a mutation reply of null to undefined', async () => {
    const pool = getProjectIo()
    const writing = pool.mutate('g', 'unlink', ['/data/x'])
    await flush()
    const child = children()[0]!
    expect(child.sent.at(-1)).toMatchObject({ op: 'mutate', method: 'unlink', args: ['/data/x'] })
    child.reply(child.lastId(), null)
    expect(await writing).toBeUndefined()
  })

  it('sizes each worker thread pool from the group concurrency within [8, 128]', async () => {
    const sizes: string[] = []
    for (const concurrency of [1, 10, 200, -5]) {
      delete (globalThis as Record<symbol, unknown>)[POOL_SYMBOL]
      fake.children.length = 0
      const pool = getProjectIo()
      pool.configure(10)
      pool.configure(concurrency)
      const reading = pool.readFile('g', '/data/x')
      await flush()
      const child = children()[0]!
      sizes.push(child.options.env.UV_THREADPOOL_SIZE!)
      child.reply(child.lastId(), new Uint8Array())
      await reading
    }
    // A non-positive value is ignored and keeps the previous concurrency.
    expect(sizes).toEqual(['8', '14', '128', '14'])
  })

  it('refuses a mutation outside the allowlist when executed directly', async () => {
    await expect(
      executeProjectIo({ id: 0, op: 'mutate', method: 'symlink' as never, args: [] }),
    ).rejects.toMatchObject({ code: 'EINVAL', syscall: 'projectIo' })
  })
})
