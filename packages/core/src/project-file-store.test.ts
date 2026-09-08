import { promises as nodeFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isArchivedSidecar } from './discovery/archive.js'
import { discoverRuns } from './discovery/discover.js'
import { getProjectIo } from './project-io.js'
import {
  configureProjectFileStore,
  getFileOperationMetrics,
  getProjectFileStatus,
  invalidateProjectFile,
  projectFs,
  withProjectFileContext,
} from './project-file-store.js'

let root: string

beforeEach(async () => {
  root = await nodeFs.mkdtemp(join(tmpdir(), 'memon-file-store-'))
})

afterEach(async () => {
  invalidateProjectFile(root)
  await nodeFs.rm(root, { recursive: true, force: true })
})

function physicalReads(): number {
  return getFileOperationMetrics().byOperation.readFile.samples
}

describe('projectFs inside a project file context', () => {
  it('answers a warm read from cache and stays fresh outside a context', async () => {
    const file = join(root, 'README.md')
    await nodeFs.writeFile(file, 'first\n')

    const cached = await withProjectFileContext({ root, reason: 'automatic' }, async () => {
      const initial = await projectFs.readFile(file, 'utf8')
      await nodeFs.writeFile(file, 'second\n')
      const warm = await projectFs.readFile(file, 'utf8')
      return { initial, warm }
    })

    expect(cached.initial).toBe('first\n')
    // The second read must not have touched the disk, so it cannot see the
    // external rewrite yet.
    expect(cached.warm).toBe('first\n')
    // The CLI (no context) always reads through.
    expect(await projectFs.readFile(file, 'utf8')).toBe('second\n')
  })

  it('coalesces equivalent concurrent reads into one physical operation', async () => {
    const file = join(root, 'notes.md')
    await nodeFs.writeFile(file, 'body\n')

    const before = physicalReads()
    const joinedBefore = getFileOperationMetrics().byOperation.readFile.coalesced
    const results = await withProjectFileContext({ root, reason: 'open' }, async () =>
      Promise.all([
        projectFs.readFile(file, 'utf8'),
        projectFs.readFile(file, 'utf8'),
        projectFs.readFile(file, 'utf8'),
      ]),
    )

    expect(results).toEqual(['body\n', 'body\n', 'body\n'])
    expect(physicalReads() - before).toBe(1)
    expect(getFileOperationMetrics().byOperation.readFile.coalesced - joinedBefore).toBe(2)
  })

  it('keeps queued and running requests outside the completed-value cache', async () => {
    const first = join(root, 'first.txt')
    const second = join(root, 'second.txt')
    await Promise.all([
      nodeFs.writeFile(first, 'first'),
      nodeFs.writeFile(second, 'second'),
    ])
    const before = getFileOperationMetrics()
    const io = getProjectIo()
    const readFile = io.readFile.bind(io)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const blocked = vi.spyOn(io, 'readFile').mockImplementation(async (group, path) => {
      if (path === first) await gate
      return await readFile(group, path)
    })
    configureProjectFileStore({ concurrency: 1 })
    const reading = withProjectFileContext({ root, reason: 'automatic' }, () =>
      Promise.all([projectFs.readFile(first, 'utf8'), projectFs.readFile(second, 'utf8')]),
    )
    try {
      await vi.waitFor(() => expect(getFileOperationMetrics().queued).toBe(before.queued + 1))
      expect(getFileOperationMetrics().inFlight).toBe(before.inFlight + 1)
      expect(getFileOperationMetrics().cacheEntries).toBe(before.cacheEntries)
      release()
      expect(await reading).toEqual(['first', 'second'])
      expect(getFileOperationMetrics().cacheEntries).toBe(before.cacheEntries + 2)
    } finally {
      release()
      await reading.catch(() => undefined)
      blocked.mockRestore()
      configureProjectFileStore(before.options)
    }
  })

  it('accounts for and caches archive sidecar checks without affecting native CLI reads', async () => {
    const before = getFileOperationMetrics().byOperation.stat.samples
    await withProjectFileContext({ root, reason: 'automatic' }, async () => {
      expect(await isArchivedSidecar(root)).toBe(false)
      await nodeFs.writeFile(join(root, '.archived'), '')
      expect(await isArchivedSidecar(root)).toBe(false)
    })
    expect(getFileOperationMetrics().byOperation.stat.samples - before).toBe(1)
    expect(await isArchivedSidecar(root)).toBe(true)
  })

  it('rejects an already aborted read without starting a project operation', async () => {
    const reason = new Error('caller canceled')
    const signal = AbortSignal.abort(reason)
    const before = getFileOperationMetrics()
    await withProjectFileContext({ root, reason: 'open' }, async () => {
      await expect(
        projectFs.readFile(join(root, 'absent.md'), { signal, encoding: 'utf8' }),
      ).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR', cause: reason })
    })
    const after = getFileOperationMetrics()
    expect(after.inFlight).toBe(before.inFlight)
    expect(after.queued).toBe(before.queued)
    expect(physicalReads()).toBe(before.byOperation.readFile.samples)
  })

  it('caches a successful missing result and keeps access errors distinct', async () => {
    const absent = join(root, 'docs', 'nope.yaml')

    await withProjectFileContext({ root, reason: 'automatic', attentionId: 'tab-1' }, async () => {
      await expect(projectFs.readFile(absent, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      // Replayed from the cached negative observation.
      await expect(projectFs.readFile(absent, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    })

    const negative = getProjectFileStatus(root, 'tab-1')
    // A successful "missing" counts as a verified observation, not an error.
    expect(negative.error).toBeNull()
    expect(negative.oldestVerifiedAt).toBeTypeOf('number')
    expect(negative.incomplete).toBe(false)

    await withProjectFileContext({ root, reason: 'automatic', attentionId: 'tab-2' }, async () => {
      // Reading a directory is a real access error: it must not degrade into
      // "missing" or "empty".
      await expect(projectFs.readFile(root, 'utf8')).rejects.toMatchObject({ code: 'EISDIR' })
    })

    const failing = getProjectFileStatus(root, 'tab-2')
    expect(failing.error).toContain('EISDIR')
    expect(failing.incomplete).toBe(true)
    expect(failing.oldestVerifiedAt).toBeNull()
  })

  it('distinguishes an empty file and an empty directory from a missing path', async () => {
    await nodeFs.writeFile(join(root, 'empty.md'), '')
    await nodeFs.mkdir(join(root, 'empty-dir'))

    await withProjectFileContext({ root, reason: 'open' }, async () => {
      expect(await projectFs.readFile(join(root, 'empty.md'), 'utf8')).toBe('')
      expect(await projectFs.readdir(join(root, 'empty-dir'))).toEqual([])
      await expect(projectFs.readdir(join(root, 'gone'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    })
  })

  it('fails closed for a path outside the context root instead of reading it natively', async () => {
    const outside = await nodeFs.mkdtemp(join(tmpdir(), 'memon-outside-'))
    try {
      await nodeFs.writeFile(join(outside, 'secret.md'), 'secret\n')
      await withProjectFileContext({ root, reason: 'open' }, async () => {
        await expect(projectFs.readFile(join(outside, 'secret.md'), 'utf8')).rejects.toMatchObject({
          code: 'EACCES',
        })
        await expect(projectFs.readdir(outside)).rejects.toMatchObject({ code: 'EACCES' })
        await expect(projectFs.stat(join(outside, 'secret.md'))).rejects.toMatchObject({
          code: 'EACCES',
        })
        await expect(projectFs.realpath(join(outside, 'secret.md'))).rejects.toMatchObject({
          code: 'EACCES',
        })
        await expect(projectFs.writeFile(join(outside, 'x.md'), 'nope')).rejects.toMatchObject({
          code: 'EACCES',
        })
      })
      // The CLI (no context) is unaffected.
      expect(await projectFs.readFile(join(outside, 'secret.md'), 'utf8')).toBe('secret\n')
    } finally {
      await nodeFs.rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses a lexically contained path that escapes through a symlink', async () => {
    const outside = await nodeFs.mkdtemp(join(tmpdir(), 'memon-escape-'))
    try {
      await nodeFs.writeFile(join(outside, 'secret.md'), 'secret\n')
      await nodeFs.mkdir(join(outside, 'sink'))
      await nodeFs.symlink(join(outside, 'secret.md'), join(root, 'linked.md'), 'file')
      await nodeFs.symlink(outside, join(root, 'escape'), 'dir')
      await nodeFs.symlink(join(outside, 'sink'), join(root, 'sink'), 'dir')

      await withProjectFileContext({ root, reason: 'open' }, async () => {
        await expect(projectFs.readFile(join(root, 'linked.md'), 'utf8')).rejects.toMatchObject({
          code: 'EACCES',
        })
        await expect(
          projectFs.readFile(join(root, 'escape', 'secret.md'), 'utf8'),
        ).rejects.toMatchObject({ code: 'EACCES' })
        await expect(projectFs.readdir(join(root, 'escape'))).rejects.toMatchObject({
          code: 'EACCES',
        })
        await expect(projectFs.stat(join(root, 'linked.md'))).rejects.toMatchObject({
          code: 'EACCES',
        })
        await expect(projectFs.realpath(join(root, 'linked.md'))).rejects.toMatchObject({
          code: 'EACCES',
        })
        // lstat observes the link itself, which lives inside the root.
        expect((await projectFs.lstat(join(root, 'linked.md'))).isSymbolicLink()).toBe(true)
        // A write must not land outside the root through a linked destination.
        await expect(
          projectFs.writeFile(join(root, 'sink', 'planted.md'), 'nope'),
        ).rejects.toMatchObject({ code: 'EACCES' })
      })

      expect(await nodeFs.readdir(join(outside, 'sink'))).toEqual([])
    } finally {
      await nodeFs.rm(outside, { recursive: true, force: true })
    }
  })

  it('resolves internal links and preserves missing and non-directory realpath errors', async () => {
    const target = join(root, 'target.md')
    await nodeFs.writeFile(target, 'inside\n')
    await nodeFs.symlink(target, join(root, 'alias.md'))
    await withProjectFileContext({ root, reason: 'open' }, async () => {
      expect(await projectFs.realpath(join(root, 'alias.md'))).toBe(await nodeFs.realpath(target))
      await expect(projectFs.realpath(join(root, 'missing'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      await expect(projectFs.realpath(join(target, 'child'))).rejects.toMatchObject({
        code: 'ENOTDIR',
      })
    })
  })

  it('keeps one page id independent per project root', async () => {
    const other = await nodeFs.mkdtemp(join(tmpdir(), 'memon-other-root-'))
    try {
      await nodeFs.writeFile(join(root, 'a.md'), 'a\n')
      await nodeFs.writeFile(join(other, 'b.md'), 'b\n')
      await withProjectFileContext({ root, reason: 'open', attentionId: 'tab' }, async () => {
        await projectFs.readFile(join(root, 'a.md'), 'utf8')
      })
      await withProjectFileContext(
        { root: other, reason: 'open', attentionId: 'tab' },
        async () => {
          await projectFs.readFile(join(other, 'b.md'), 'utf8')
        },
      )

      // Each root keeps its own dependency set for the shared page id.
      expect(getProjectFileStatus(root, 'tab').incomplete).toBe(false)
      expect(getProjectFileStatus(other, 'tab').incomplete).toBe(false)
      expect(getProjectFileStatus(root, 'tab').version).not.toBe(
        getProjectFileStatus(other, 'tab').version,
      )
    } finally {
      invalidateProjectFile(other)
      await nodeFs.rm(other, { recursive: true, force: true })
    }
  })

  it('refuses recursive listings and mutations under a read-only policy', async () => {
    await withProjectFileContext({ root, reason: 'open', readOnly: true }, async () => {
      await expect(projectFs.readdir(root, { recursive: true })).rejects.toThrow(/recursive/)
      await expect(projectFs.writeFile(join(root, 'x.md'), 'nope')).rejects.toMatchObject({
        code: 'EROFS',
      })
    })
    await expect(nodeFs.readFile(join(root, 'x.md'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('invalidates the exact entry and parent listing on a write', async () => {
    const file = join(root, 'page.md')
    await nodeFs.writeFile(file, 'old\n')

    await withProjectFileContext({ root, reason: 'open' }, async () => {
      expect(await projectFs.readFile(file, 'utf8')).toBe('old\n')
      expect(await projectFs.readdir(root)).toEqual(['page.md'])

      await projectFs.writeFile(join(root, 'new.md'), 'created\n')
      await projectFs.writeFile(file, 'new\n')

      expect(await projectFs.readFile(file, 'utf8')).toBe('new\n')
      expect((await projectFs.readdir(root)).sort()).toEqual(['new.md', 'page.md'])
    })
  })

  it('bumps the observation version only when the observed content changes', async () => {
    const file = join(root, 'stable.md')
    await nodeFs.writeFile(file, 'same\n')

    const first = await withProjectFileContext(
      { root, reason: 'open', attentionId: 'tab-v' },
      async () => {
        await projectFs.readFile(file, 'utf8')
        return getProjectFileStatus(root, 'tab-v').version
      },
    )

    invalidateProjectFile(root, file)
    const unchanged = await withProjectFileContext(
      { root, reason: 'open', attentionId: 'tab-v' },
      async () => {
        await projectFs.readFile(file, 'utf8')
        return getProjectFileStatus(root, 'tab-v').version
      },
    )
    expect(unchanged).toBe(first)

    invalidateProjectFile(root, file)
    await nodeFs.writeFile(file, 'different\n')
    const changed = await withProjectFileContext(
      { root, reason: 'open', attentionId: 'tab-v' },
      async () => {
        await projectFs.readFile(file, 'utf8')
        return getProjectFileStatus(root, 'tab-v').version
      },
    )
    expect(changed).not.toBe(first)
  })

  it('reports queue and execution latency per group, operation and origin', async () => {
    const file = join(root, 'metrics.md')
    await nodeFs.writeFile(file, 'body\n')

    await withProjectFileContext({ root, storageGroup: 'mounted', reason: 'open' }, async () => {
      await projectFs.readFile(file, 'utf8')
      await projectFs.readFile(file, 'utf8')
    })

    const metrics = getFileOperationMetrics()
    const series = metrics.series.find(
      (entry) =>
        entry.storageGroup === 'mounted' &&
        entry.operation === 'readFile' &&
        entry.origin === 'human',
    )
    expect(series).toBeDefined()
    expect(series!.samples).toBe(1)
    expect(series!.cacheHits).toBeGreaterThanOrEqual(1)
    expect(series!.readBytes).toBe(5)
    expect(series!.queueWaitMs.meanMs).toBeGreaterThanOrEqual(0)
    expect(series!.executionMs.p95Ms).toBeGreaterThanOrEqual(0)
    expect(metrics.groups.some((group) => group.storageGroup === 'mounted')).toBe(true)
    expect(metrics.options.concurrency).toBe(10)
  })
})

describe('Run walk over cached listings', () => {
  it('reuses cached listings for a warm walk and re-reads after invalidation', async () => {
    await nodeFs.mkdir(join(root, 'logs', 'alpha-260501-100000'), { recursive: true })
    const project = { name: 'p', root, include: [], exclude: [] }

    const warm = await withProjectFileContext({ root, reason: 'automatic' }, async () => {
      const first = await discoverRuns(project)
      await nodeFs.rm(join(root, 'logs', 'alpha-260501-100000'), { recursive: true, force: true })
      const second = await discoverRuns(project)
      return { first, second }
    })

    expect(warm.first).toEqual([join(root, 'logs', 'alpha-260501-100000')])
    // The repeat walk composed the cached listings instead of enumerating.
    expect(warm.second).toEqual(warm.first)

    invalidateProjectFile(root)
    const fresh = await withProjectFileContext({ root, reason: 'manual' }, async () =>
      discoverRuns(project),
    )
    expect(fresh).toEqual([])
  })
})
