import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { FileAgentClient } from '@memon/file-protocol/client'
import { createTempProject, removeTempDirs, startFileAgentFixture } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireFileWriterLock,
  FILE_WRITER_LOCK_PATH,
  withFileWriterLock,
} from './file-writer-lock.js'
import {
  configureProjectFileStore,
  projectFs,
  withProjectFileContext,
} from './project-file-store.js'

let agent: Awaited<ReturnType<typeof startFileAgentFixture>> | undefined
afterEach(async () => {
  await agent?.stop()
  agent = undefined
  await removeTempDirs()
})
describe('common native writer lock', () => {
  it('serializes a Node writer and a separate Go agent before source precondition validation', async () => {
    const project = await createTempProject({ files: { 'README.md': 'original' } })
    agent = await startFileAgentFixture(project.root)
    const client = new FileAgentClient({
      endpoint: agent.endpoint,
      ca: await readFile(agent.tls.ca),
      certificate: await readFile(agent.tls.client),
      key: await readFile(agent.tls.clientKey),
      expectedSourceIdentity: agent.sourceIdentity,
    })
    const target = { project: 'project-a', path: 'README.md' }
    await vi.waitFor(() => client.stat(target), { timeout: 10_000, interval: 50 })
    const before = await client.read(target)
    const metadata = await client.stat(target)
    if (before.outcome !== 'present' || metadata.outcome !== 'present')
      throw new Error('expected original document')
    const lock = await acquireFileWriterLock(project.root)
    let completed = false
    const result = client
      .mutate({
        ...target,
        operation: 'replace',
        content: 'c3RhbGU=',
        precondition: {
          kind: 'match',
          expectedMtime: metadata.metadata.mtimeMs,
          expectedHash: before.version.slice(7),
        },
        requestId: 'competing-writer',
        lockVersion: 1,
      })
      .then(
        () => {
          completed = true
          return 'applied'
        },
        (error) => {
          completed = true
          return (error as { code?: string }).code
        },
      )
    try {
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(completed).toBe(false)
      expect(await readFile(project.path('README.md'), 'utf8')).toBe('original')
      await writeFile(project.path('README.md'), 'native-newer')
    } finally {
      lock.release()
    }
    expect(await result).toBe('CONFLICT')
    expect(await readFile(project.path('README.md'), 'utf8')).toBe('native-newer')
  }, 40_000)
  it('uses asynchronous primitives for a cached central lock and permits nested writes at concurrency one', async () => {
    const project = await createTempProject({ files: { 'note.txt': 'first' } })
    configureProjectFileStore({ concurrency: 1 })
    try {
      await withProjectFileContext(
        { root: project.root, cachePolicy: 'memory', reason: 'write' },
        () =>
          withFileWriterLock(project.root, async () => {
            expect(await readFile(project.path('.memon/locks/.gitignore'), 'utf8')).toBe('*\n')
            await withFileWriterLock(project.root, () =>
              projectFs.writeFile(project.path('note.txt'), 'other'),
            )
          }),
      )
      expect(await readFile(project.path('note.txt'), 'utf8')).toBe('other')
      await expect(projectFs.stat(project.path(FILE_WRITER_LOCK_PATH))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      configureProjectFileStore({ concurrency: 10 })
    }
  })
  it('never steals an abandoned lock based on its age', async () => {
    const project = await createTempProject()
    await mkdir(project.path(FILE_WRITER_LOCK_PATH), { recursive: true })
    await expect(acquireFileWriterLock(project.root, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'EBUSY',
    })
  })
})
