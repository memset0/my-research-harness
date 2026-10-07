import { FileAccessError } from '@memon/file-protocol'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverRuns } from '../discovery/discover.js'
import { discoverWikiPages } from '../wiki/discover.js'
import { projectFs, withProjectFileContext } from './index.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})
describe('central discovery distinguishes outage from absence', () => {
  it.each([
    'SOURCE_UNAVAILABLE',
    'EIO',
  ] as const)('does not turn a failed Run listing (%s) into an empty walk', async (code) => {
    const project = await createTempProject({
      files: { 'logs/run-one-261006-010203/README.md': 'run' },
    })
    const error =
      code === 'SOURCE_UNAVAILABLE'
        ? new FileAccessError(code)
        : Object.assign(new Error('failed source'), { code })
    vi.spyOn(projectFs, 'readdir').mockRejectedValue(error)
    await expect(
      withProjectFileContext({ root: project.root, cachePolicy: 'memory' }, () =>
        discoverRuns({ name: 'project-a', root: project.root, include: [], exclude: [] }),
      ),
    ).rejects.toBe(error)
  })
  it('does not omit a Wiki page when its source read fails', async () => {
    const project = await createTempProject({
      files: { 'docs/wiki/knowledge/W0001-note.md': '# Note' },
    })
    const error = new FileAccessError('SOURCE_UNAVAILABLE')
    const read = projectFs.readFile
    vi.spyOn(projectFs, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('W0001-note.md')) throw error
      return Reflect.apply(read, projectFs, args)
    })
    await expect(
      withProjectFileContext({ root: project.root, cachePolicy: 'memory' }, () =>
        discoverWikiPages(project.root),
      ),
    ).rejects.toBe(error)
  })
})
