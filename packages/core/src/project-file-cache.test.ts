import { promises as nodeFs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { containingMount, NETWORK_FS_TYPES, readMountTable } from './mount-table.js'
import {
  configureProjectFileCache,
  getProjectFileCache,
  DEFAULT_DOCUMENT_TTL_MS,
  DEFAULT_DUMP_INTERVAL_MS,
  DEFAULT_WIKI_TTL_MS,
  type PersistedObservation,
  ProjectFileCache,
  projectFileTtlMs,
} from './project-file-cache.js'
import {
  getFileOperationMetrics,
  invalidateProjectFile,
  projectFs,
  withProjectFileContext,
} from './project-file-store.js'

let directory: string
let dumpPath: string

const SSHFS = {
  mountPoint: '/mnt/remote',
  fsType: 'fuse.sshfs',
  source: 'host:/srv/project',
}

const OPTIONS = {
  dumpIntervalMs: DEFAULT_DUMP_INTERVAL_MS,
  wikiTtlMs: DEFAULT_WIKI_TTL_MS,
  defaultTtlMs: DEFAULT_DOCUMENT_TTL_MS,
}

beforeEach(async () => {
  directory = await nodeFs.mkdtemp(join(tmpdir(), 'memon-file-cache-'))
  dumpPath = join(directory, 'cache', 'memon-project-files.cache')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await configureProjectFileCache(undefined)
  await nodeFs.rm(directory, { recursive: true, force: true })
})

async function awaitPhysicalReads(target: number): Promise<number> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const samples = getFileOperationMetrics().byOperation.readFile.samples
    if (samples >= target) return samples
    await new Promise((done) => setImmediate(done))
  }
  return getFileOperationMetrics().byOperation.readFile.samples
}

async function awaitDump(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const exists = await nodeFs.stat(path).then(
      () => true,
      () => false,
    )
    if (exists) return
    await new Promise((done) => setImmediate(done))
  }
  throw new Error(`snapshot was not written: ${path}`)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('snapshot observation cache', () => {
  it('keeps the configured singleton usable when startup configuration overlaps or repeats', async () => {
    const options = { dumpPath, ...OPTIONS }
    await Promise.all([
      configureProjectFileCache(options),
      configureProjectFileCache(options),
      configureProjectFileCache(options),
    ])
    const writer = getProjectFileCache()!
    const namespaceId = await writer.namespaceId({ root: '/projects/repeated', mount: SSHFS })

    await configureProjectFileCache(options)
    expect(getProjectFileCache()).toBe(writer)
    await writer.put(namespaceId, 'readFile', '/projects/repeated/README.md', {
      payload: { kind: 'file', bytes: Buffer.from('still writable') },
      fingerprint: 'repeat',
      observedAtWall: Date.now(),
    })
    expect(
      (await writer.load(namespaceId, 'readFile', '/projects/repeated/README.md'))?.payload,
    ).toEqual({ kind: 'file', bytes: Buffer.from('still writable') })
  })

  it('restores binary, directory, stat and missing observations with their original age', async () => {
    const first = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await first.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const observedAtWall = Date.now() - 45_000
    const binary = Buffer.from([0, 255, 10, 128, 1])
    await first.put(namespaceId, 'readFile', '/projects/alpha/data.bin', {
      payload: { kind: 'file', bytes: binary },
      fingerprint: 'binary',
      observedAtWall,
    })
    const hot = await first.load(namespaceId, 'readFile', '/projects/alpha/data.bin')
    expect(hot?.payload.kind).toBe('file')
    if (hot?.payload.kind !== 'file') throw new Error('expected a hot file observation')
    expect(hot.payload.bytes).toBe(binary)
    await first.put(namespaceId, 'readdir', '/projects/alpha/docs', {
      payload: {
        kind: 'dir',
        entries: [
          { name: 'wiki', kind: 'directory' },
          { name: 'latest', kind: 'symlink' },
        ],
      },
      fingerprint: 'directory',
      observedAtWall,
    })
    await first.put(namespaceId, 'lstat', '/projects/alpha/data.bin', {
      payload: {
        kind: 'stat',
        stats: { mode: 33_188n, size: 5n, mtimeMs: 12_345n, mtimeNs: 12_345_000_000n },
      },
      fingerprint: 'stat',
      observedAtWall,
    })
    await first.put(namespaceId, 'readFile', '/projects/alpha/gone.md', {
      payload: { kind: 'missing', code: 'ENOENT' },
      fingerprint: 'missing:ENOENT',
      observedAtWall,
    })
    await first.close()

    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const sameNamespace = await reopened.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    expect(sameNamespace).toBe(namespaceId)
    expect(await reopened.load(namespaceId, 'readFile', '/projects/alpha/data.bin')).toEqual({
      payload: { kind: 'file', bytes: binary },
      fingerprint: 'binary',
      observedAtWall,
    })
    expect((await reopened.load(namespaceId, 'readdir', '/projects/alpha/docs'))?.payload).toEqual({
      kind: 'dir',
      entries: [
        { name: 'wiki', kind: 'directory' },
        { name: 'latest', kind: 'symlink' },
      ],
    })
    expect(
      (await reopened.load(namespaceId, 'lstat', '/projects/alpha/data.bin'))?.payload,
    ).toEqual({
      kind: 'stat',
      stats: { mode: 33_188n, size: 5n, mtimeMs: 12_345n, mtimeNs: 12_345_000_000n },
    })
    expect(
      (await reopened.load(namespaceId, 'readFile', '/projects/alpha/gone.md'))?.payload,
    ).toEqual({ kind: 'missing', code: 'ENOENT' })
    await reopened.close()
  })

  it('writes dirty observations periodically without keeping serialization on the put path', async () => {
    const first = await ProjectFileCache.open({ dumpPath, ...OPTIONS, dumpIntervalMs: 5 })
    const namespaceId = await first.namespaceId({ root: '/projects/periodic', mount: SSHFS })
    const queued = Promise.resolve('memory-only')
    await first.put(namespaceId, 'readFile', '/projects/periodic/README.md', {
      payload: { kind: 'file', bytes: Buffer.from('periodic') },
      fingerprint: 'periodic',
      observedAtWall: Date.now(),
      queued,
    } as PersistedObservation)

    await awaitDump(dumpPath)
    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(
      (await reopened.load(namespaceId, 'readFile', '/projects/periodic/README.md'))?.payload,
    ).toEqual({ kind: 'file', bytes: Buffer.from('periodic') })
    await reopened.close()
    await first.close()
  })

  it('preserves mutations made during a dump and coalesces them into the final close', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const path = '/projects/alpha/README.md'
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.from('first') },
      fingerprint: 'first',
      observedAtWall: 1,
    })

    const entered = deferred()
    const release = deferred()
    const rename = nodeFs.rename.bind(nodeFs)
    vi.spyOn(nodeFs, 'rename').mockImplementationOnce(async (from, to) => {
      entered.resolve()
      await release.promise
      await rename(from, to)
    })
    const flushing = cache.flush()
    await entered.promise
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.from('second') },
      fingerprint: 'second',
      observedAtWall: 2,
    })
    const firstClose = cache.close()
    const secondClose = cache.close()
    release.resolve()
    await Promise.all([flushing, firstClose, secondClose])

    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await reopened.load(namespaceId, 'readFile', path)).toEqual({
      payload: { kind: 'file', bytes: Buffer.from('second') },
      fingerprint: 'second',
      observedAtWall: 2,
    })
    await reopened.close()
  })

  it('leaves the previous snapshot intact and removes temporary files when a dump fails', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const path = '/projects/alpha/README.md'
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.from('safe') },
      fingerprint: 'safe',
      observedAtWall: 1,
    })
    await cache.flush()
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.from('not committed') },
      fingerprint: 'new',
      observedAtWall: 2,
    })

    vi.spyOn(nodeFs, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'))
    await expect(cache.flush()).rejects.toThrow('simulated rename failure')
    vi.restoreAllMocks()
    expect((await nodeFs.readdir(dirname(dumpPath))).sort()).toEqual([basename(dumpPath)])

    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await reopened.load(namespaceId, 'readFile', path)).toEqual({
      payload: { kind: 'file', bytes: Buffer.from('safe') },
      fingerprint: 'safe',
      observedAtWall: 1,
    })
    await reopened.close()
    await cache.close()
  })

  it('treats corrupt and wrong-version dumps as cold caches that remain usable', async () => {
    await nodeFs.mkdir(dirname(dumpPath), { recursive: true })
    await nodeFs.writeFile(dumpPath, Buffer.from('not a v8 snapshot'))
    const cold = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cold.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    expect(await cold.load(namespaceId, 'readFile', '/projects/alpha/README.md')).toBeNull()
    await cold.put(namespaceId, 'readFile', '/projects/alpha/README.md', {
      payload: { kind: 'file', bytes: Buffer.from('current') },
      fingerprint: 'current',
      observedAtWall: 10,
    })
    await cold.close()

    const envelope = deserialize(await nodeFs.readFile(dumpPath)) as { version: number }
    envelope.version = 999
    await nodeFs.writeFile(dumpPath, serialize(envelope))
    const wrongVersion = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await wrongVersion.load(namespaceId, 'readFile', '/projects/alpha/README.md')).toBeNull()
    await wrongVersion.put(namespaceId, 'readFile', '/projects/alpha/new.md', {
      payload: { kind: 'file', bytes: Buffer.from('new') },
      fingerprint: 'new',
      observedAtWall: 20,
    })
    await wrongVersion.close()

    const recovered = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(
      (await recovered.load(namespaceId, 'readFile', '/projects/alpha/new.md'))?.payload,
    ).toEqual({ kind: 'file', bytes: Buffer.from('new') })
    await recovered.close()
  })

  it('rejects operation-mismatched, non-numeric and incomplete observations', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const path = '/projects/alpha/item'
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.from('old') },
      fingerprint: 'old',
      observedAtWall: 1,
    })
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'dir', entries: [] },
      fingerprint: 'wrong-operation',
      observedAtWall: 2,
    } as PersistedObservation)
    await cache.put(namespaceId, 'stat', '/projects/alpha/bad-stat', {
      payload: { kind: 'stat', stats: { mode: 33_188, size: Number.NaN } },
      fingerprint: 'bad-stat',
      observedAtWall: 2,
    })
    await cache.put(namespaceId, 'readFile', '/projects/alpha/pending', {
      payload: { kind: 'file', bytes: Promise.resolve(Buffer.from('pending')) },
      fingerprint: 'pending',
      observedAtWall: 2,
    } as unknown as PersistedObservation)

    expect(await cache.load(namespaceId, 'readFile', path)).toBeNull()
    expect(await cache.load(namespaceId, 'stat', '/projects/alpha/bad-stat')).toBeNull()
    expect(await cache.load(namespaceId, 'readFile', '/projects/alpha/pending')).toBeNull()
    await cache.close()
  })

  it('does not persist access failures as successful missing observations', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const path = '/projects/alpha/denied'
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'missing', code: 'EACCES' },
      fingerprint: 'denied',
      observedAtWall: Date.now(),
    })
    expect(await cache.load(namespaceId, 'readFile', path)).toBeNull()
    await cache.close()
    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await reopened.load(namespaceId, 'readFile', path)).toBeNull()
    await reopened.close()
  })

  it('rejects a snapshot whose shared payloads exceed the restored memory budget', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    await cache.put(namespaceId, 'readFile', '/projects/alpha/seed', {
      payload: { kind: 'file', bytes: Buffer.alloc(4 * 1024 * 1024) },
      fingerprint: 'shared',
      observedAtWall: Date.now(),
    })
    await cache.close()
    const envelope = deserialize(await nodeFs.readFile(dumpPath))
    const original = envelope.entries[0][1].value
    // V8 preserves the shared Buffer reference, so this small input describes
    // more than 512 MiB of individually retained observations.
    envelope.entries = Array.from({ length: 129 }, (_, index) => {
      const path = `/projects/alpha/item-${index}`
      return [
        `${namespaceId}\u0000readFile\u0000${path}`,
        {
          value: { ...original, path },
        },
      ]
    })
    await nodeFs.writeFile(dumpPath, serialize(envelope))
    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await reopened.load(namespaceId, 'readFile', '/projects/alpha/item-0')).toBeNull()
    await reopened.close()
  })

  it('keeps oversized observations out and removes a previous smaller value', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const path = '/projects/alpha/large.bin'
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.from('small') },
      fingerprint: 'small',
      observedAtWall: 1,
    })
    await cache.put(namespaceId, 'readFile', path, {
      payload: { kind: 'file', bytes: Buffer.alloc(9 * 1024 * 1024) },
      fingerprint: 'large',
      observedAtWall: 2,
    })
    expect(await cache.load(namespaceId, 'readFile', path)).toBeNull()
    await cache.close()

    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await reopened.load(namespaceId, 'readFile', path)).toBeNull()
    await reopened.close()
  })

  it('separates mount namespaces and persists path and namespace invalidation', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const original = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    const remapped = await cache.namespaceId({
      root: '/projects/alpha',
      mount: { ...SSHFS, source: 'other-host:/srv/project' },
    })
    const other = await cache.namespaceId({ root: '/projects/beta', mount: SSHFS })
    expect(remapped).not.toBe(original)
    const path = '/projects/alpha/page.md'
    for (const operation of ['readFile', 'stat'] as const) {
      await cache.put(original, operation, path, {
        payload:
          operation === 'readFile'
            ? { kind: 'file', bytes: Buffer.from('old') }
            : { kind: 'stat', stats: { mode: 33_188, size: 3 } },
        fingerprint: operation,
        observedAtWall: 1,
      })
    }
    await cache.put(other, 'readFile', '/projects/beta/README.md', {
      payload: { kind: 'file', bytes: Buffer.from('beta') },
      fingerprint: 'beta',
      observedAtWall: 1,
    })
    expect(await cache.load(remapped, 'readFile', path)).toBeNull()
    await cache.deletePath(original, path)
    await cache.deleteNamespace(other)
    await cache.close()

    const reopened = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    expect(await reopened.load(original, 'readFile', path)).toBeNull()
    expect(await reopened.load(original, 'stat', path)).toBeNull()
    expect(await reopened.load(other, 'readFile', '/projects/beta/README.md')).toBeNull()
    await reopened.close()
  })

  it('keeps the snapshot and its parent owner-only', async () => {
    const cache = await ProjectFileCache.open({ dumpPath, ...OPTIONS })
    const namespaceId = await cache.namespaceId({ root: '/projects/alpha', mount: SSHFS })
    await cache.put(namespaceId, 'readFile', '/projects/alpha/README.md', {
      payload: { kind: 'file', bytes: Buffer.from('secret') },
      fingerprint: 'secret',
      observedAtWall: Date.now(),
    })
    await cache.close()

    expect((await nodeFs.stat(dumpPath)).mode & 0o777).toBe(0o600)
    expect((await nodeFs.stat(dirname(dumpPath))).mode & 0o777).toBe(0o700)
  })

  it('rejects non-regular dump paths and symlinked parents before writing', async () => {
    await nodeFs.mkdir(dumpPath, { recursive: true })
    await expect(ProjectFileCache.open({ dumpPath, ...OPTIONS })).rejects.toThrow(/regular file/)

    const target = join(directory, 'target')
    const linked = join(directory, 'linked')
    await nodeFs.rm(dumpPath, { recursive: true })
    await nodeFs.mkdir(target)
    await nodeFs.symlink(target, linked, 'dir')
    await expect(
      ProjectFileCache.open({ dumpPath: join(linked, 'cache'), ...OPTIONS }),
    ).rejects.toThrow(/symlink/)
    expect(await nodeFs.readdir(target)).toEqual([])
  })
})

describe('persistence eligibility', () => {
  it('never snapshots a local project even when it opts in', async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), 'memon-local-project-'))
    try {
      await configureProjectFileCache({ dumpPath, ...OPTIONS })
      await nodeFs.writeFile(join(root, 'README.md'), 'local\n')
      await withProjectFileContext({ root, reason: 'open', persistentCache: true }, async () => {
        expect(await projectFs.readFile(join(root, 'README.md'), 'utf8')).toBe('local\n')
        await projectFs.readdir(root)
      })
      await getProjectFileCache()!.flush()
      await expect(nodeFs.stat(dumpPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      invalidateProjectFile(root)
      await nodeFs.rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a dump on network storage before any write reaches it', async () => {
    const table = await readMountTable()
    const remote = (table ?? []).find((entry) => NETWORK_FS_TYPES[entry.fsType] === true)
    if (remote === undefined) return
    await expect(
      ProjectFileCache.open({
        dumpPath: join(remote.mountPoint, 'memon-cache-should-not-exist'),
        ...OPTIONS,
      }),
    ).rejects.toThrow(/local disk/)
    expect(containingMount(remote.mountPoint, table ?? [])?.fsType).toBe(remote.fsType)
  })
})

describe('freshness lifetime', () => {
  it('separates wiki pages from every other cached document path', () => {
    const root = '/projects/alpha'
    expect(projectFileTtlMs(root, join(root, 'docs', 'wiki', 'findings.md'))).toBe(
      DEFAULT_WIKI_TTL_MS,
    )
    expect(projectFileTtlMs(root, join(root, 'docs', 'wiki'))).toBe(DEFAULT_WIKI_TTL_MS)
    expect(projectFileTtlMs(root, join(root, 'docs', 'reports', 'R0001-x.md'))).toBe(
      DEFAULT_DOCUMENT_TTL_MS,
    )
    expect(projectFileTtlMs(root, join(root, 'README.md'))).toBe(DEFAULT_DOCUMENT_TTL_MS)
  })

  it('keeps local-project attention refresh independent of persistent cache TTLs', async () => {
    const root = await nodeFs.mkdtemp(join(tmpdir(), 'memon-ttl-project-'))
    try {
      await configureProjectFileCache({ dumpPath, ...OPTIONS })
      const file = join(root, 'README.md')
      await nodeFs.writeFile(file, 'first\n')

      const before = getFileOperationMetrics().byOperation.readFile.samples
      await withProjectFileContext({ root, reason: 'open' }, () => projectFs.readFile(file, 'utf8'))
      await nodeFs.writeFile(file, 'local edit\n')
      await withProjectFileContext({ root, reason: 'focus', persistentCache: true }, () =>
        projectFs.readFile(file, 'utf8'),
      )
      expect(await awaitPhysicalReads(before + 2)).toBe(before + 2)
      expect(
        await withProjectFileContext({ root, reason: 'automatic' }, () =>
          projectFs.readFile(file, 'utf8'),
        ),
      ).toBe('local edit\n')

      await nodeFs.writeFile(file, 'second\n')
      await withProjectFileContext({ root, reason: 'manual' }, () =>
        projectFs.readFile(file, 'utf8'),
      )
      expect(await awaitPhysicalReads(before + 3)).toBe(before + 3)
      expect(
        await withProjectFileContext({ root, reason: 'automatic' }, () =>
          projectFs.readFile(file, 'utf8'),
        ),
      ).toBe('second\n')
    } finally {
      invalidateProjectFile(root)
      await nodeFs.rm(root, { recursive: true, force: true })
    }
  })
})
