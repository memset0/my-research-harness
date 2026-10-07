import { readFile, rename, writeFile } from 'node:fs/promises'
import { join as nativeJoin } from 'node:path'
import { FileAgentClient } from '@memon/file-protocol/client'
import { fileProjectURI, join } from '@memon/file-protocol/paths'
import {
  createTempProject,
  makeTempDir,
  removeTempDirs,
  startFileAgentFixture,
} from '@memon/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readMountTable } from '../mount-table.js'
import { configureProjectFileCache, getProjectFileCache } from '../project-file-cache.js'
import type { ProjectFileContext } from '../project-file-context.js'
import type { ProjectConfig } from '../types.js'
import { configureFileAgentAdapters } from './agent-adapters.js'
import { readProjectFile } from './conditional.js'
import { projectFs, withProjectFileContext } from './index.js'
import { getStore } from './runtime.js'

vi.mock('../mount-table.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mount-table.js')>()),
  readMountTable: vi.fn(async () => []),
}))
let agent: Awaited<ReturnType<typeof startFileAgentFixture>>
let source: Awaited<ReturnType<typeof createTempProject>>
beforeAll(async () => {
  source = await createTempProject({ files: { 'note.txt': 'first' } })
  agent = await startFileAgentFixture(source.root)
  const client = new FileAgentClient({
    endpoint: agent.endpoint,
    ca: await readFile(agent.tls.ca),
    certificate: await readFile(agent.tls.client),
    key: await readFile(agent.tls.clientKey),
    expectedSourceIdentity: agent.sourceIdentity,
  })
  await vi.waitFor(() => client.stat({ project: 'project-a', path: '' }), { timeout: 10000 })
}, 40000)
afterAll(async () => {
  await configureProjectFileCache(undefined)
  await agent?.stop()
  await removeTempDirs()
})
const freshStore = () => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('memon.project-file-store.v2')]
}

describe('four transport/cache modes through one file boundary', () => {
  it.each([
    'none',
    'memory',
    'sshfs',
    'agent',
  ] as const)('preserves conditional semantics and cache restart policy for %s', async (mode) => {
    await configureProjectFileCache(undefined)
    freshStore()
    const native =
      mode === 'agent' ? source : await createTempProject({ files: { 'note.txt': 'first' } })
    if (mode === 'agent') await writeFile(nativeJoin(source.root, 'note.txt'), 'first')
    const root = mode === 'agent' ? fileProjectURI('agent-a', 'project-a') : native.root
    const tiered = mode === 'sshfs' || mode === 'agent'
    // SSHFS exercises the real worker and persistent cache with a simulated mount identity.
    // It does not claim a real network mount or test SSH transport.
    vi.mocked(readMountTable).mockResolvedValue(
      mode === 'sshfs'
        ? [{ mountPoint: root, fsType: 'fuse.sshfs', source: 'cluster-a:/srv/project-a' }]
        : [],
    )
    if (mode === 'agent') {
      const project: ProjectConfig = {
        name: 'project-a',
        root,
        include: [],
        exclude: [],
        access: {
          kind: 'agent',
          cache: 'memory-disk',
          connection: 'agent-a',
          project: 'project-a',
          sourceIdentity: agent.sourceIdentity,
        },
      }
      configureFileAgentAdapters(
        {
          'agent-a': {
            endpoint: agent.endpoint,
            caFile: agent.tls.ca,
            certificateFile: agent.tls.client,
            keyFile: agent.tls.clientKey,
          },
        },
        [project],
      )
    }
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
    if (tiered) {
      await new Promise<void>((done) => setImmediate(done))
      await configureProjectFileCache(undefined)
      freshStore()
      await configureProjectFileCache(cache)
      const restored = await readProjectFile(context, path, { policy: 'cached' })
      expect(restored).toMatchObject({
        outcome: 'present',
        version: first.version,
        checkedAt: first.checkedAt,
      })
      expect(getStore().metricsSnapshot().overall.samples).toBe(0)
      expect(getStore().metricsSnapshot().queued).toBe(0)
    } else {
      await getProjectFileCache()!.flush()
      await expect(readFile(cache.dumpPath)).rejects.toMatchObject({ code: 'ENOENT' })
    }
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
  it('keeps agent outage distinct from missing while a cached answer retains its original check time', async () => {
    const root = fileProjectURI('agent-a', 'project-a'),
      path = join(root, 'note.txt')
    const context: ProjectFileContext = {
      root,
      cachePolicy: 'memory-disk',
      storage: 'sshfs',
      reason: 'open',
    }
    const before = await readProjectFile(context, path, { policy: 'revalidate' })
    await agent.stop()
    expect(await readProjectFile(context, path, { policy: 'cached' })).toEqual(before)
    await expect(readProjectFile(context, path, { policy: 'revalidate' })).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    })
    expect(getStore().observationTime(root, path, 'readFile')).toBe(before.checkedAt)
  })
})
