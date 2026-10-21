import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { configureProjectFileCache, getProjectFileCache } from './project-file-cache.js'
import * as clock from './project-file-store/clock.js'
import { getStore } from './project-file-store/runtime.js'
import { projectFs, withProjectFileContext } from './project-file-store.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})
it('ignores an old dump across restart and never modifies it', async () => {
  const p = await createTempProject({
    files: { 'note.txt': 'new source', 'old.dump': 'obsolete bytes' },
  })
  const dumpPath = join(p.root, 'old.dump')
  await configureProjectFileCache({
    dumpPath,
    dumpIntervalMs: 1,
    wikiTtlMs: 30000,
    defaultTtlMs: 1800000,
  })
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('memon.project-file-store.v2')]
  const result = await withProjectFileContext(
    { root: p.root, storage: 'sshfs', persistentCache: true },
    () => projectFs.readFile(join(p.root, 'note.txt'), 'utf8'),
  )
  expect(result).toBe('new source')
  expect(getProjectFileCache()).toBeNull()
  expect(await readFile(dumpPath, 'utf8')).toBe('obsolete bytes')
})
it('bounds reuse to 30 seconds and manual reads bypass reuse', async () => {
  let now = 0
  vi.spyOn(clock, 'monotonic').mockImplementation(() => now)
  const p = await createTempProject({ files: { 'note.txt': 'first' } })
  const path = join(p.root, 'note.txt'),
    context = { root: p.root, storage: 'sshfs' as const, reason: 'open' as const }
  const read = () => withProjectFileContext(context, () => projectFs.readFile(path, 'utf8'))
  expect(await read()).toBe('first')
  await writeFile(path, 'second')
  now = 29999
  expect(await read()).toBe('first')
  now = 30000
  expect(await read()).toBe('second')
  await writeFile(path, 'third')
  expect(
    await withProjectFileContext({ ...context, reason: 'manual' }, () =>
      projectFs.readFile(path, 'utf8'),
    ),
  ).toBe('third')
  expect(getStore().nextCheckDelay(p.root, path, 'readFile')).toBeLessThanOrEqual(30000)
})

it('does not extend successful data freshness through an error backoff', async () => {
  let now = 0
  vi.spyOn(clock, 'monotonic').mockImplementation(() => now)
  const p = await createTempProject({ files: { 'note.txt': 'first' } })
  const path = join(p.root, 'note.txt'),
    context = { root: p.root, storage: 'sshfs' as const, reason: 'open' as const }
  const read = () => withProjectFileContext(context, () => projectFs.readFile(path, 'utf8'))
  await read()
  const { getProjectIo } = await import('./project-io.js')
  vi.spyOn(getProjectIo(), 'readFile').mockRejectedValue(
    Object.assign(new Error('offline'), { code: 'EIO' }),
  )
  now = 30000
  await expect(read()).rejects.toMatchObject({ code: 'EIO' })
  now = 30001
  await expect(read()).rejects.toMatchObject({ code: 'EIO' })
})
