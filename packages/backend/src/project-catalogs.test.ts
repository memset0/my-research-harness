import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { projectFs, publishReportCatalog, rebuildIndex, writeFsVersion } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { FilesystemDocumentService } from './document-service.js'
import { toHttpError } from './http/errors.js'
import { ProjectCatalogError } from './project-catalogs.js'
import { FilesystemProjectService } from './project-service.js'
import { dropProjectReadIndexes } from './read-index.js'

afterEach(async () => {
  vi.restoreAllMocks()
  dropProjectReadIndexes()
  await removeTempDirs()
})
async function fixture() {
  const p = await createTempProject({
    files: {
      'docs/experiments/E0001-example/README.md':
        '---\nid: E0001-example\ntitle: Example\nstatus: ARCHIVED\ncreated_at: 2026-01-01T10:00:00+08:00\nupdated_at: 2026-01-01T10:00:00+08:00\n---\n# Research\n',
      'docs/wiki/note/W0001-example/README.md':
        '---\nid: W0001\ntitle: Current explanation\ncreated_at: 2026-01-01T10:00:00+08:00\nupdated_at: 2026-01-01T10:00:00+08:00\n---\nWiki body\n',
      'docs/reports/R0001-example/manifest.json': JSON.stringify({
        type: 'html',
        title: 'First report',
        description: 'A report',
        created_at: '2026-01-01T10:00:00+08:00',
      }),
      'docs/reports/R0001-example/index.html': '<h1>Report</h1>',
    },
  })
  await writeFsVersion(p.root, {
    fs_convention_version: 11,
    installed_at: '2026-01-01T10:00:00+08:00',
    last_migrated_at: null,
  })
  await rebuildIndex(p.root)
  const config = { name: 'project-a', root: p.root, include: [], exclude: [] }
  return {
    p,
    docs: new FilesystemDocumentService([config]),
    projects: new FilesystemProjectService([config]),
  }
}
it('lists all three catalogs without directory discovery or reading document bodies', async () => {
  const { p, docs, projects } = await fixture()
  const list = vi.spyOn(projectFs, 'readdir'),
    read = vi.spyOn(projectFs, 'readFile')
  expect(((await docs.listReports('project-a')) as { reports: unknown[] }).reports).toHaveLength(1)
  expect(((await docs.listWiki('project-a')) as { pages: unknown[] }).pages).toHaveLength(1)
  expect(
    ((await projects.listExperiments('project-a')) as { experiments: unknown[] }).experiments,
  ).toHaveLength(1)
  expect(list).not.toHaveBeenCalled()
  expect(read.mock.calls.every(([path]) => String(path).startsWith(p.path('.memon/')))).toBe(true)
})
it('resolves a newly published report without cached directory listings and after restart', async () => {
  const { p, docs } = await fixture()
  await docs.listReports('project-a')
  const path = p.path('docs/reports/topic/R0002-new/README.md')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '---\ntitle: New report\n---\nNew evidence\n')
  await publishReportCatalog(p.root)
  const list = vi.spyOn(projectFs, 'readdir')
  expect((await docs.getReport('project-a', 'R0002')).content).toContain('New evidence')
  dropProjectReadIndexes()
  expect((await docs.getReport('project-a', 'R0002')).title).toBe('New report')
  expect(list).not.toHaveBeenCalled()
})
it('reads only the selected wiki body when opening detail', async () => {
  const { p, docs } = await fixture()
  const list = vi.spyOn(projectFs, 'readdir'),
    read = vi.spyOn(projectFs, 'readFile')
  expect((await docs.getWiki('project-a', 'W0001')).content).toContain('Wiki body')
  expect(list).not.toHaveBeenCalled()
  expect(
    read.mock.calls
      .filter(([path]) => !String(path).startsWith(p.path('.memon/')))
      .map(([path]) => path),
  ).toEqual([p.path('docs/wiki/note/W0001-example/README.md')])
})
it('fails explicitly for missing and malformed catalogs instead of discovering', async () => {
  const { p, docs } = await fixture()
  await rm(p.path('.memon/index/reports.json'))
  const list = vi.spyOn(projectFs, 'readdir')
  await expect(docs.listReports('project-a')).rejects.toThrow('run memon refresh')
  await writeFile(p.path('.memon/index/reports.json'), '{}')
  await expect(docs.getReport('project-a', 'R0001')).rejects.toThrow('PROJECT_CATALOG_UNAVAILABLE')
  expect(list).not.toHaveBeenCalled()
})
it('rejects duplicate identities and escapes including a symlink target', async () => {
  const { p, docs } = await fixture()
  const path = p.path('.memon/index/reports.json')
  const catalog = JSON.parse(await readFile(path, 'utf8'))
  catalog.entries.push(catalog.entries[0])
  await writeFile(path, JSON.stringify(catalog))
  await expect(docs.listReports('project-a')).rejects.toThrow('PROJECT_CATALOG_UNAVAILABLE')
  catalog.entries.pop()
  catalog.entries[0].resource = '../outside.md'
  await writeFile(path, JSON.stringify(catalog))
  await expect(docs.getReport('project-a', 'R0001')).rejects.toThrow('PROJECT_CATALOG_UNAVAILABLE')
  const other = await createTempProject({ files: { 'secret.md': 'private' } })
  await symlink(other.path('secret.md'), p.path('docs/reports/alias.md'))
  catalog.entries[0].resource = 'docs/reports/alias.md'
  await writeFile(path, JSON.stringify(catalog))
  await expect(docs.getReport('project-a', 'R0001')).rejects.toThrow()
})

it('uses the published experiment path for detail without probing another layout', async () => {
  const { projects } = await fixture()
  const list = vi.spyOn(projectFs, 'readdir')
  const result = await projects.getExperiment('project-a', 'E0001-example')
  expect(result.id).toBe('E0001-example')
  expect(list).not.toHaveBeenCalled()
})

it('exposes source refresh guidance through HTTP without internal paths', () => {
  const error = toHttpError(new ProjectCatalogError('reports', new Error('internal detail')))
  expect(error).toMatchObject({ status: 503, code: 'UNAVAILABLE' })
  expect(error?.message).toContain('memon refresh')
  expect(error?.message).not.toContain('internal detail')
})

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}
async function httpErrorOf(work: () => Promise<unknown>) {
  try {
    await work()
    return null
  } catch (error) {
    return toHttpError(error)
  }
}
it('answers a catalog miss with NOT_REFRESHED only when the source has that well-formed ID', async () => {
  const { p, docs, projects } = await fixture()
  const time = '2026-01-01T10:00:00+08:00'
  await put(
    p.path('docs/wiki/note/W0004-new/README.md'),
    `---\nid: W0004\ntitle: New\ncreated_at: ${time}\nupdated_at: ${time}\n---\nBody\n`,
  )
  await put(
    p.path('docs/reports/methods/R0002-later/README.md'),
    '---\ntitle: Later\n---\n# Later\n',
  )
  await put(
    p.path('docs/experiments/E0002-next/README.md'),
    `---\nid: E0002-next\ntitle: Next\nstatus: ACTIVE\ncreated_at: ${time}\nupdated_at: ${time}\n---\n# Next\n`,
  )

  expect(await httpErrorOf(() => docs.getWiki('project-a', 'W0004'))).toMatchObject({
    status: 404,
    code: 'NOT_REFRESHED',
  })
  expect(await httpErrorOf(() => docs.getReport('project-a', 'R0002'))).toMatchObject({
    status: 404,
    code: 'NOT_REFRESHED',
  })
  expect(await httpErrorOf(() => projects.getExperiment('project-a', 'E0002-next'))).toMatchObject({
    status: 404,
    code: 'NOT_REFRESHED',
  })
  expect(await httpErrorOf(() => docs.getReport('project-a', 'R0099'))).toMatchObject({
    status: 404,
    code: 'NOT_FOUND',
  })

  // A malformed ID never reaches the source directories.
  const list = vi.spyOn(projectFs, 'readdir')
  expect((await httpErrorOf(() => docs.getReport('project-a', 'R!@#')))?.code).not.toBe(
    'NOT_REFRESHED',
  )
  expect(list).not.toHaveBeenCalled()

  await rebuildIndex(p.root)
  dropProjectReadIndexes()
  expect(await httpErrorOf(() => docs.getWiki('project-a', 'W0004'))).toBeNull()
})
