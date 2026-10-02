import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectFs } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectReadIndex } from './read-index.js'

let root: string
let clock: number
let index: ProjectReadIndex

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-read-index-'))
  clock = 1_000_000
  index = new ProjectReadIndex(root, () => clock)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

function counting() {
  return {
    stat: vi.spyOn(projectFs, 'stat'),
    readFile: vi.spyOn(projectFs, 'readFile'),
    readdir: vi.spyOn(projectFs, 'readdir'),
  }
}

describe('ProjectReadIndex.file', () => {
  it('reads once, re-stats when the window passed, reloads only on change', async () => {
    const path = join(root, 'a.md')
    await fs.writeFile(path, 'one')
    const ops = counting()
    const parse = vi.fn((content: string) => content.toUpperCase())

    expect(await index.file(path, 'upper', 60_000, parse)).toBe('ONE')
    expect(await index.file(path, 'upper', 60_000, parse)).toBe('ONE')
    expect(ops.stat).toHaveBeenCalledTimes(1)
    expect(ops.readFile).toHaveBeenCalledTimes(1)

    clock += 60_001
    expect(await index.file(path, 'upper', 60_000, parse)).toBe('ONE')
    expect(ops.stat).toHaveBeenCalledTimes(2)
    expect(ops.readFile).toHaveBeenCalledTimes(1)

    await fs.writeFile(path, 'two!')
    expect(await index.file(path, 'upper', 0, parse)).toBe('TWO!')
    expect(ops.readFile).toHaveBeenCalledTimes(2)
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('remembers absence, sees creation after validation, and forgets after invalidate', async () => {
    const path = join(root, 'later.md')
    expect(await index.file(path, 'raw', 60_000, (content) => content)).toBeNull()
    await fs.writeFile(path, 'here')
    expect(await index.file(path, 'raw', 60_000, (content) => content)).toBeNull()
    index.invalidate()
    expect(await index.file(path, 'raw', 60_000, (content) => content)).toBe('here')
  })

  it('caches nothing when a load fails', async () => {
    const path = join(root, 'bad.md')
    await fs.writeFile(path, 'x')
    const parse = vi
      .fn<(content: string) => string>()
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
      .mockImplementation((content) => content)
    await expect(index.file(path, 'p', 60_000, parse)).rejects.toThrow('boom')
    expect(await index.file(path, 'p', 60_000, parse)).toBe('x')
  })

  it('shares one validation between concurrent readers', async () => {
    const path = join(root, 'c.md')
    await fs.writeFile(path, 'c')
    const ops = counting()
    await Promise.all([1, 2, 3].map(() => index.file(path, 'p', 0, (content) => content)))
    expect(ops.stat).toHaveBeenCalledTimes(1)
    expect(ops.readFile).toHaveBeenCalledTimes(1)
  })

  it('takes the window from the cached value', async () => {
    const path = join(root, 'd.md')
    await fs.writeFile(path, 'FINISHED')
    const ops = counting()
    const window = (value: string | null) => (value === 'FINISHED' ? 300_000 : 60_000)
    await index.file(path, 'status', window, (content) => content)
    clock += 120_000
    await index.file(path, 'status', window, (content) => content)
    expect(ops.stat).toHaveBeenCalledTimes(1)
  })
})

describe('ProjectReadIndex.listing and walk', () => {
  it('lists entries with types and reuses the listing inside the window', async () => {
    await fs.mkdir(join(root, 'docs', 'k'), { recursive: true })
    await fs.writeFile(join(root, 'docs', 'f.md'), '')
    const ops = counting()
    const listed = await index.listing(join(root, 'docs'), 60_000)
    expect(listed).toEqual([
      { name: 'f.md', type: 'file' },
      { name: 'k', type: 'dir' },
    ])
    await index.listing(join(root, 'docs'), 60_000)
    expect(ops.readdir).toHaveBeenCalledTimes(1)
    expect(await index.listing(join(root, 'missing'), 0)).toBeNull()
  })

  it('walks per request with refresh 0 and serves a stale walk while refreshing', async () => {
    const project = { name: 'p', root, include: [], exclude: [] }
    let generation = 0
    const run = vi.fn(async () => [`walk-${++generation}`])
    expect(await index.walk(project, 0, run)).toEqual(['walk-1'])
    expect(await index.walk(project, 0, run)).toEqual(['walk-2'])
    expect(await index.walk(project, 60_000, run)).toEqual(['walk-2'])
    clock += 60_000
    expect(await index.walk(project, 60_000, run)).toEqual(['walk-2'])
    await new Promise((resolve) => setImmediate(resolve))
    expect(await index.walk(project, 60_000, run)).toEqual(['walk-3'])
  })
})

describe('ProjectReadIndex seeded entries', () => {
  it('hands an expired seeded entry to the stale handler without any I/O', async () => {
    const path = join(root, 'seeded.md')
    await fs.writeFile(path, 'disk')
    const key = `file:${path}#raw`
    index.seed(key, {
      fingerprint: 'f:*:1:1:1:1',
      value: 'snapshot',
      validatedAt: clock - 3_600_000,
    })
    const queued: Array<[string, () => Promise<boolean>]> = []
    index.setStaleHandler((staleKey, revalidate) => queued.push([staleKey, revalidate]))
    const ops = counting()

    // Served from the seed, past its window, with no filesystem call.
    expect(await index.file(path, 'raw', 60_000, (content) => content)).toBe('snapshot')
    expect(ops.stat).not.toHaveBeenCalled()
    expect(queued.map(([staleKey]) => staleKey)).toEqual([key])

    // The handler's revalidation re-takes the fingerprint and reloads.
    expect(await queued[0]![1]()).toBe(true)
    expect(ops.stat).toHaveBeenCalledTimes(1)
    expect(await index.file(path, 'raw', 60_000, (content) => content)).toBe('disk')
    // Already re-validated: a second run is a no-op.
    expect(await queued[0]![1]()).toBe(false)
    expect(ops.stat).toHaveBeenCalledTimes(1)
  })

  it('re-validates synchronously for a zero window and after an invalidation', async () => {
    const path = join(root, 'seeded.md')
    await fs.writeFile(path, 'disk')
    const handler = vi.fn()
    index.setStaleHandler(handler)
    index.seed(`file:${path}#raw`, {
      fingerprint: 'f:*:1:1:1:1',
      value: 'snapshot',
      validatedAt: clock - 3_600_000,
    })
    // An explicit refresh (window 0) reads the disk for this request.
    expect(await index.file(path, 'raw', 0, (content) => content)).toBe('disk')
    const other = new ProjectReadIndex(root, () => clock)
    other.setStaleHandler(handler)
    other.seed(`file:${path}#raw`, {
      fingerprint: 'f:*:1:1:1:1',
      value: 'snapshot',
      validatedAt: clock - 3_600_000,
    })
    // A central write invalidates: no stale serving afterwards.
    other.invalidate()
    expect(await other.file(path, 'raw', 60_000, (content) => content)).toBe('disk')
    expect(handler).not.toHaveBeenCalled()
  })
})
