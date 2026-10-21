// Native modes only: unit tests do not build or run the Go file agent, whose
// own Go tests cover the source kernel.

import { readFile, rename, writeFile } from 'node:fs/promises'
import { join as nativeJoin } from 'node:path'
import { join } from '@memon/file-protocol/paths'
import { createTempProject, makeTempDir, removeTempDirs } from '@memon/test-utils'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { readMountTable } from '../mount-table.js'
import { configureProjectFileCache, getProjectFileCache } from '../project-file-cache.js'
import type { ProjectFileContext } from '../project-file-context.js'
import { readProjectFile } from './conditional.js'
import { projectFs, withProjectFileContext } from './index.js'
import { getStore } from './runtime.js'

vi.mock('../mount-table.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mount-table.js')>()),
  readMountTable: vi.fn(async () => []),
}))
afterAll(async () => {
  await configureProjectFileCache(undefined)
  await removeTempDirs()
})
const freshStore = () => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('memon.project-file-store.v2')]
}

describe('native transport/cache modes through one file boundary', () => {
  it.each([
    'none',
    'memory',
    'sshfs',
  ] as const)('preserves conditional semantics and cache restart policy for %s', async (mode) => {
    await configureProjectFileCache(undefined)
    freshStore()
    const native = await createTempProject({ files: { 'note.txt': 'first' } })
    const root = native.root
    const tiered = mode === 'sshfs'
    // SSHFS exercises the real worker and memory cache with a simulated mount identity.
    // It does not claim a real network mount or test SSH transport.
    vi.mocked(readMountTable).mockResolvedValue(
      mode === 'sshfs'
        ? [{ mountPoint: root, fsType: 'fuse.sshfs', source: 'cluster-a:/srv/project-a' }]
        : [],
    )
    const context: ProjectFileContext = {
      root,
      storage: mode === 'none' ? 'local' : 'sshfs',
      cachePolicy: mode === 'none' ? 'none' : tiered ? 'memory-disk' : 'memory',
      persistentCache: tiered,
      reason: 'open',
    }
    const directory = await makeTempDir('memon-parity-cache-')
    const cache = {
      dumpPath: nativeJoin(directory, 'cache.bin'),
      dumpIntervalMs: 30000,
      wikiTtlMs: 30000,
      defaultTtlMs: 1800000,
    }
    await configureProjectFileCache(cache)
    const path = join(root, 'note.txt')
    const first = await readProjectFile(context, path)
    expect(first.outcome).toBe('present')
    if (first.outcome !== 'present') throw new Error('missing fixture')
    const checks = getStore().metricsSnapshot().byOperation.readFile.samples
    const conditional = await readProjectFile(context, path, {
      knownVersion: first.version,
      policy: 'cached',
    })
    expect(conditional).toMatchObject({ outcome: 'unchanged', version: first.version })
    expect(conditional).not.toHaveProperty('content')
    expect(getStore().metricsSnapshot().byOperation.readFile.samples).toBe(checks)
    await writeFile(nativeJoin(native.root, 'note.txt'), 'other')
    expect(await withProjectFileContext(context, () => projectFs.readFile(path, 'utf8'))).toBe(
      mode === 'none' ? 'other' : 'first',
    )
    freshStore()
    await configureProjectFileCache(cache)
    const restarted = await readProjectFile(context, path)
    expect(restarted.outcome).toBe('present')
    if (restarted.outcome === 'present')
      expect(Buffer.from(restarted.content, 'base64').toString()).toBe('other')
    expect(getProjectFileCache()).toBeNull()
    await expect(readFile(cache.dumpPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await withProjectFileContext(context, async () => {
      const handle = await projectFs.open(path, 'r')
      try {
        const prior = await handle.stat()
        const first = Buffer.alloc(2)
        await handle.read(first, 0, 2, 0)
        await writeFile(nativeJoin(native.root, 'note.txt.next'), 'new-content')
        await rename(nativeJoin(native.root, 'note.txt.next'), nativeJoin(native.root, 'note.txt'))
        const rest: Buffer[] = [first]
        for await (const chunk of handle.createReadStream({ start: 2, highWaterMark: 2 }))
          rest.push(chunk as Buffer)
        expect(Buffer.concat(rest).toString()).toBe('other')
        expect(prior.size).toBe(5)
      } finally {
        await handle.close()
      }
    })
    await writeFile(nativeJoin(native.root, 'note.txt'), 'other')
    const current = await readProjectFile(context, path, {
      knownVersion: first.version,
      policy: 'revalidate',
    })
    expect(current.outcome).toBe('present')
    if (current.outcome === 'present')
      expect(Buffer.from(current.content, 'base64').toString()).toBe('other')
  })
})
