import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
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

afterEach(async () => {
  await removeTempDirs()
})
describe('common native writer lock', () => {
  it('enters an explicitly acquired CLI lock scope without reacquisition', async () => {
    const project = await createTempProject()
    const lock = await acquireFileWriterLock(project.root)
    try {
      await lock.run(() =>
        withFileWriterLock(project.root, () => writeFile(project.path('note.txt'), 'recorded')),
      )
      expect(await readFile(project.path('note.txt'), 'utf8')).toBe('recorded')
    } finally {
      lock.release()
    }
    expect(() => lock.run(async () => undefined)).toThrow('released')
  })
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
