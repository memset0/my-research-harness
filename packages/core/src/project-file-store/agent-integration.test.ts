import { mkdir, readFile, rename, stat, utimes, writeFile } from 'node:fs/promises'
import { join as nativeJoin } from 'node:path'
import { FileAgentClient } from '@memon/file-protocol/client'
import { fileProjectURI, join } from '@memon/file-protocol/paths'
import { createTempProject, removeTempDirs, startFileAgentFixture } from '@memon/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { writeFileAtomic } from '../atomic-write.js'
import { compactIndex } from '../derived-index/compact.js'
import { rebuildIndex } from '../derived-index/rebuild.js'
import { writeFsVersion } from '../fs-version/write.js'
import { LineIndex } from '../log/line-index.js'
import { formatIsoLocal } from '../time.js'
import type { ProjectConfig } from '../types.js'
import { FS_CONVENTION_VERSION } from '../version.js'
import { configureFileAgentAdapters } from './agent-adapters.js'
import { invalidateProjectFile, projectFs, withProjectFileContext } from './index.js'

let source: Awaited<ReturnType<typeof createTempProject>>
let agent: Awaited<ReturnType<typeof startFileAgentFixture>>
const root = fileProjectURI('agent-a', 'project-a')
const context = {
  root,
  cachePolicy: 'memory-disk' as const,
  storage: 'sshfs' as const,
  reason: 'manual' as const,
}
beforeAll(async () => {
  source = await createTempProject({
    files: {
      'docs/file.txt': 'first',
      'logs/run.log': 'one\ntwo\nthree\n',
      'docs/bundle/README.md': 'document',
    },
  })
  agent = await startFileAgentFixture(source.root)
  const client = new FileAgentClient({
    endpoint: agent.endpoint,
    ca: await readFile(agent.tls.ca),
    certificate: await readFile(agent.tls.client),
    key: await readFile(agent.tls.clientKey),
    expectedSourceIdentity: agent.sourceIdentity,
  })
  await vi.waitFor(() => client.stat({ project: 'project-a', path: '' }), {
    timeout: 10_000,
    interval: 50,
  })
  const project: ProjectConfig = {
    name: 'project-a',
    root,
    include: [],
    exclude: [],
    storage: 'sshfs',
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
}, 40_000)
afterAll(async () => {
  await agent?.stop()
  invalidateProjectFile(root)
  await removeTempDirs()
})

describe('real agent through the project file boundary', () => {
  it('pins a download to opened bytes and metadata across atomic replacement', async () => {
    const native = nativeJoin(source.root, 'stable.bin')
    await writeFile(native, 'AAAAAA')
    await withProjectFileContext(context, async () => {
      const handle = await projectFs.open(join(root, 'stable.bin'), 'r')
      try {
        expect((await handle.stat()).size).toBe(6)
        const first = Buffer.alloc(3)
        await handle.read(first, 0, 3, 0)
        await writeFile(`${native}.next`, 'BBBBBBBBB')
        await rename(`${native}.next`, native)
        const chunks: Buffer[] = [first]
        for await (const chunk of handle.createReadStream({ start: 3, highWaterMark: 2 }))
          chunks.push(chunk as Buffer)
        expect(Buffer.concat(chunks).toString()).toBe('AAAAAA')
        expect((await handle.stat()).size).toBe(6)
      } finally {
        await handle.close()
      }
      const current = await projectFs.open(join(root, 'stable.bin'), 'r')
      expect((await current.stat()).size).toBe(9)
      await current.close()
    })
  })
  it('shares cached bytes and explicitly revalidates remote changes', async () => {
    const path = join(root, 'docs/file.txt')
    expect(await withProjectFileContext(context, () => projectFs.readFile(path, 'utf8'))).toBe(
      'first',
    )
    await writeFile(nativeJoin(source.root, 'docs/file.txt'), 'other')
    expect(
      await withProjectFileContext({ ...context, reason: 'open' }, () =>
        projectFs.readFile(path, 'utf8'),
      ),
    ).toBe('first')
    expect(await withProjectFileContext(context, () => projectFs.readFile(path, 'utf8'))).toBe(
      'other',
    )
    expect(await withProjectFileContext(context, () => projectFs.readFile(path, 'utf8'))).toBe(
      'other',
    )
  })
  it('prevents an external rewrite from being overwritten by a computed edit', async () => {
    const path = join(root, 'docs/file.txt')
    await expect(
      withProjectFileContext(context, async () => {
        await projectFs.readFile(path, 'utf8')
        await projectFs.stat(path)
        await writeFile(nativeJoin(source.root, 'docs/file.txt'), 'newer')
        await writeFileAtomic(path, 'stale')
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(nativeJoin(source.root, 'docs/file.txt'), 'utf8')).toBe('newer')
  })
  it('atomically replaces an observed file and preserves its mode', async () => {
    const path = join(root, 'docs/file.txt')
    const mode = (await stat(nativeJoin(source.root, 'docs/file.txt'))).mode & 0o777
    await withProjectFileContext(context, async () => {
      await projectFs.readFile(path, 'utf8')
      await projectFs.stat(path)
      await writeFileAtomic(path, 'accepted')
    })
    expect(await readFile(nativeJoin(source.root, 'docs/file.txt'), 'utf8')).toBe('accepted')
    expect((await stat(nativeJoin(source.root, 'docs/file.txt'))).mode & 0o777).toBe(mode)
  })
  it('renames and removes a bundle through contained directory primitives', async () => {
    await withProjectFileContext(context, async () => {
      await projectFs.rename(join(root, 'docs/bundle'), join(root, 'docs/moved'))
      expect(await projectFs.readFile(join(root, 'docs/moved/README.md'), 'utf8')).toBe('document')
      await projectFs.rm(join(root, 'docs/moved'), { recursive: true })
    })
    await expect(stat(nativeJoin(source.root, 'docs/moved'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it.each([
    'rename',
    'rm',
  ] as const)('protects observed descendant documents before directory %s', async (operation) => {
    const bundle = `docs/guard-${operation}`
    const nativeFile = nativeJoin(source.root, bundle, 'README.md')
    await mkdir(nativeJoin(source.root, bundle))
    await writeFile(nativeFile, 'before')
    const file = join(root, bundle, 'README.md')
    await expect(
      withProjectFileContext(context, async () => {
        expect(await projectFs.readFile(file, 'utf8')).toBe('before')
        const prior = await projectFs.stat(file)
        await writeFile(nativeFile, 'edited')
        await utimes(nativeFile, prior.atime, prior.mtime)
        if (operation === 'rename')
          await projectFs.rename(join(root, bundle), join(root, `${bundle}-moved`))
        else await projectFs.rm(join(root, bundle), { recursive: true })
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(nativeFile, 'utf8')).toBe('edited')
    await expect(stat(nativeJoin(source.root, `${bundle}-moved`))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('rebuilds and compacts the derived index entirely through remote primitives', async () => {
    await withProjectFileContext({ ...context, reason: 'write' }, async () => {
      await writeFsVersion(root, {
        fs_convention_version: FS_CONVENTION_VERSION,
        installed_at: formatIsoLocal(new Date()),
        last_migrated_at: null,
      })
      const rebuilt = await rebuildIndex(root, { role: 'central' })
      expect(rebuilt.snapshot).not.toBeNull()
      const compacted = await compactIndex(root, { role: 'central' })
      expect(compacted.status).not.toBe('conflict')
      await expect(
        projectFs.writeFile(join(root, '.memon/index/.gitignore'), '*\n', { flag: 'wx' }),
      ).rejects.toMatchObject({ code: 'EEXIST' })
    })
  })
  it('detects replacement using opaque descriptor identity without treating append as rotation', async () => {
    const native = nativeJoin(source.root, 'logs/rotating.log')
    await writeFile(native, 'one\n')
    await withProjectFileContext(context, async () => {
      const index = await LineIndex.build(join(root, 'logs/rotating.log'))
      expect(index.fileId).toMatch(/^sha256:/)
      await writeFile(native, 'one\ntwo\n')
      expect(await index.appendDelta()).toEqual({ added: 1, rotated: false })
      await writeFile(`${native}.next`, 'new\nlog\n')
      await rename(`${native}.next`, native)
      expect(await index.appendDelta()).toEqual({ added: 0, rotated: true })
    })
  })
  it('builds and reads a sparse log index using bounded remote ranges', async () => {
    await withProjectFileContext(context, async () => {
      const index = await LineIndex.build(join(root, 'logs/run.log'), { anchorEvery: 1 })
      expect(index.totalLines).toBe(3)
      expect(await index.range(3, 2)).toEqual([
        { lineNumber: 2, text: 'two' },
        { lineNumber: 3, text: 'three' },
      ])
    })
  })
  it('refuses a logical path outside a configured context and cross-authority writes', async () => {
    await expect(projectFs.readFile(join(root, 'docs/file.txt'))).rejects.toMatchObject({
      code: 'EACCES',
    })
    await expect(
      withProjectFileContext(context, () =>
        projectFs.rename(
          join(root, 'docs/file.txt'),
          join(fileProjectURI('agent-a', 'project-b'), 'x'),
        ),
      ),
    ).rejects.toMatchObject({ code: 'EACCES' })
  })
  it('rejects a changed credential before returning a previously cached body and recovers after replacement', async () => {
    const path = join(root, 'docs/file.txt')
    const key = await readFile(agent.tls.clientKey)
    await withProjectFileContext({ ...context, reason: 'manual' }, () => projectFs.readFile(path))
    try {
      await writeFile(agent.tls.clientKey, 'invalid private key')
      await expect(
        withProjectFileContext({ ...context, reason: 'open', observationPolicy: 'cached' }, () =>
          projectFs.readFile(path),
        ),
      ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' })
    } finally {
      await writeFile(agent.tls.clientKey, key)
    }
    expect(
      await withProjectFileContext({ ...context, reason: 'manual' }, () =>
        projectFs.readFile(path),
      ),
    ).toBeInstanceOf(Buffer)
  })
})
