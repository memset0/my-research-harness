import { mkdir } from 'node:fs/promises'
import {
  BackendWikiPagesResponseSchema,
  type ProjectConfig,
  projectFs,
  scanProjectRoot,
} from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { FilesystemDocumentService } from './document-service.js'
import { FilesystemProjectService } from './project-service.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})

it('does not open retired hypotheses when scanning or reading Wiki and experiment inventories', async () => {
  const fixture = await createTempProject({
    wiki: {
      'notes/W0001-current/README.md':
        '---\nid: W0001\ntitle: Current\nsources: [H0001]\n---\n\nHistorical @H0001 remains text.\n',
    },
  })
  // Reading this historical path as a document would fail with EISDIR.
  await mkdir(fixture.path('docs/hypotheses.md'))
  const accesses = [
    vi.spyOn(projectFs, 'stat'),
    vi.spyOn(projectFs, 'readFile'),
    vi.spyOn(projectFs, 'realpath'),
  ]
  const project = {
    name: 'project-a',
    root: fixture.root,
    include: [],
    exclude: [],
  } satisfies ProjectConfig
  const snapshot = await scanProjectRoot(fixture.root)
  expect(snapshot).not.toHaveProperty('hypotheses')
  const projects = new FilesystemProjectService([project])
  await expect(projects.listExperiments('project-a')).resolves.toMatchObject({ experiments: [] })
  const documents = new FilesystemDocumentService([project])
  const wiki = BackendWikiPagesResponseSchema.parse(await documents.listWiki('project-a'))
  expect(wiki.pages).toHaveLength(1)
  expect(wiki.pages[0]).toMatchObject({ sources: ['H0001'], stale: false })
  expect(projects).not.toHaveProperty('getHypotheses')
  expect(
    accesses.some((spy) =>
      spy.mock.calls.some(([path]) => String(path) === fixture.path('docs/hypotheses.md')),
    ),
  ).toBe(false)
})
