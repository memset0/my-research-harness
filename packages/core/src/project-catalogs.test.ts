import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createTempProject, removeTempDirs, type TempProject } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { defaultIndexFs } from './derived-index/fs.js'
import { rebuildIndex } from './derived-index/rebuild.js'
import {
  checkPublishedCatalog,
  experimentCatalogEntries,
  type ProjectCatalogKind,
  writeProjectCatalog,
} from './project-catalogs.js'

afterEach(removeTempDirs)
it('retains the complete old catalog when atomic publication fails', async () => {
  const p = await createTempProject()
  const entry = {
    id: 'R0001',
    slug: 'example',
    resource: 'docs/reports/R0001-example/README.md',
    summary: {
      id: 'R0001',
      slug: 'example',
      resource: 'docs/reports/R0001-example/README.md',
      title: 'Original',
      mtime: 0,
      format: 'bundle',
    },
  }
  await writeProjectCatalog(p.root, 'reports', [entry])
  const before = await readFile(p.path('.memon/index/reports.json'), 'utf8')
  await expect(
    writeProjectCatalog(
      p.root,
      'reports',
      [{ ...entry, summary: { ...entry.summary, title: 'Changed' } }],
      {
        ...defaultIndexFs,
        rename: async () => {
          throw new Error('disk failure')
        },
      },
    ),
  ).rejects.toThrow('disk failure')
  expect(await readFile(p.path('.memon/index/reports.json'), 'utf8')).toBe(before)
  expect(await defaultIndexFs.readdir(p.path('.memon/index'))).not.toEqual(
    expect.arrayContaining([expect.stringContaining('.tmp-')]),
  )
})
it('publishes active-run display state and keeps smoke out of required variants', async () => {
  const time = '2026-01-01T10:00:00+08:00'
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\nrun_dirs: [logs/E*/V*/*, logs/E*/smoke/*]\n',
      'docs/experiments/E0001-example/README.md': `---\nid: E0001-example\ntitle: Example\nstatus: ACTIVE\ncreated_at: ${time}\nupdated_at: ${time}\n---\n# Research\n`,
      'docs/experiments/E0001-example/experiment.json': JSON.stringify({ format: 'lightweight' }),
      'logs/E0001/V0001/ready/run.json': JSON.stringify({
        id: 'ready',
        status: 'READY',
        active: true,
        created_at: time,
      }),
      'logs/E0001/smoke/check/run.json': JSON.stringify({
        id: 'check',
        status: 'RUNNING',
        active: true,
        created_at: time,
      }),
    },
  })
  const result = await rebuildIndex(p.root)
  expect(Object.values(result.snapshot!.experiments)[0]?.format).toBe('lightweight')
  expect(Object.keys(result.snapshot!.runs)).toHaveLength(2)
  const entries = experimentCatalogEntries(result.snapshot!)
  expect(entries[0]?.summary).toMatchObject({
    requiredVariantCount: 1,
    displayStatus: 'RUNNING',
    runCount: 2,
  })
  const run = result.snapshot!.runs['logs/E0001/V0001/ready']!
  run.status = 'FINISHED'
  result.snapshot!.runs['logs/E0001/smoke/check']!.status = 'FINISHED'
  expect(experimentCatalogEntries(result.snapshot!)[0]?.summary).toMatchObject({
    requiredVariantCount: 1,
    displayStatus: 'COMPLETED',
  })
  run.row.assessment = { kind: 'INVALID', reason: 'Invalid measurement' }
  expect(experimentCatalogEntries(result.snapshot!)[0]?.summary.displayStatus).toBe('ACTIVE')
})

const TIME = '2026-01-01T10:00:00+08:00'
const report = (title: string) => `---\ntitle: ${title}\ncreated_at: ${TIME}\n---\n# ${title}\n`
const wiki = (id: string) =>
  `---\nid: ${id}\nkind: finding\ntitle: ${id}\nstatus: TENTATIVE\ncreated_at: ${TIME}\nupdated_at: ${TIME}\n---\n# ${id}\n`
const INDEX_FILES = ['snapshot.json', 'experiments.json', 'wiki.json', 'reports.json']

async function put(p: TempProject, path: string, content: string): Promise<void> {
  await mkdir(dirname(p.path(path)), { recursive: true })
  await writeFile(p.path(path), content, 'utf8')
}

async function catalogProject() {
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/experiments/E0001-example/README.md': `---\nid: E0001-example\ntitle: Example\nstatus: ACTIVE\ncreated_at: ${TIME}\nupdated_at: ${TIME}\n---\n# Research\n`,
      'docs/experiments/E0001-example/experiment.json': JSON.stringify({ format: 'lightweight' }),
      'docs/wiki/finding/W0001-first/README.md': wiki('W0001'),
      'docs/reports/R0001-weekly/README.md': report('Weekly'),
    },
  })
  const first = await rebuildIndex(p.root)
  expect(first.status).toBe('rebuilt')
  return p
}

it('refuses publication, lists every unindexable document and keeps the index', async () => {
  const p = await catalogProject()
  const before = await Promise.all(
    INDEX_FILES.map((name) => readFile(p.path(`.memon/index/${name}`), 'utf8')),
  )
  await put(p, 'docs/reports/R0002-broken/manifest.json', '{"type":"html"}\n')
  await put(p, 'docs/reports/methods/R0003-also-broken/manifest.json', '{"type":"html"}\n')
  await put(p, 'docs/reports/R0004-good/README.md', report('Good'))
  await put(p, 'docs/wiki/finding/W0002-second/README.md', wiki('W0002'))

  const result = await rebuildIndex(p.root)

  expect(result.status).toBe('invalid')
  expect(result.snapshot).toBeNull()
  expect(result.invalid?.map((issue) => issue.resource).sort()).toEqual([
    'docs/reports/R0002-broken/manifest.json',
    'docs/reports/methods/R0003-also-broken/manifest.json',
  ])
  expect(result.invalid?.every((issue) => /title/.test(issue.message))).toBe(true)
  const after = await Promise.all(
    INDEX_FILES.map((name) => readFile(p.path(`.memon/index/${name}`), 'utf8')),
  )
  expect(after).toEqual(before)
})

it('reports duplicate IDs with both documents and counts Reports when publishing', async () => {
  const p = await catalogProject()
  await put(p, 'docs/reports/methods/R0001-copy/README.md', report('Copy'))
  const refused = await rebuildIndex(p.root)
  expect(refused.status).toBe('invalid')
  expect(refused.invalid).toEqual([
    expect.objectContaining({
      kind: 'reports',
      message: expect.stringMatching(/duplicate ID R0001/),
    }),
  ])
  await rm(p.path('docs/reports/methods/R0001-copy'), { recursive: true, force: true })
  const published = await rebuildIndex(p.root)
  expect(published.status).toBe('rebuilt')
  expect(published.counts).toMatchObject({ experiments: 1, wiki: 1, reports: 1 })
})

it('checks published catalogs against the files without writing', async () => {
  const p = await catalogProject()
  const check = async () => {
    const dry = await rebuildIndex(p.root, { dryRun: true })
    return Promise.all(
      (['experiments', 'wiki', 'reports'] as ProjectCatalogKind[]).map((kind) =>
        checkPublishedCatalog(p.root, kind, dry.catalogs![kind]),
      ),
    )
  }
  expect((await check()).map((drift) => drift.state)).toEqual(['current', 'current', 'current'])

  await put(p, 'docs/wiki/finding/W0004-new/README.md', wiki('W0004'))
  const before = await readFile(p.path('.memon/index/wiki.json'), 'utf8')
  const [, wikiDrift] = await check()
  expect(wikiDrift).toMatchObject({ state: 'stale', missing: ['W0004'] })
  expect(await readFile(p.path('.memon/index/wiki.json'), 'utf8')).toBe(before)

  await rm(p.path('.memon/index/reports.json'), { recursive: true, force: true })
  const [, , reportsDrift] = await check()
  expect(reportsDrift?.state).toBe('unreadable')

  await rebuildIndex(p.root)
  expect((await check()).map((drift) => drift.state)).toEqual(['current', 'current', 'current'])
})

it('warns about standalone documents that are new since the previous publication', async () => {
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/reports/R0001-legacy.md': report('Legacy'),
    },
  })
  const first = await rebuildIndex(p.root)
  expect(first.status).toBe('rebuilt')
  expect(first.warnings).toBeUndefined()

  await put(p, 'docs/reports/R0002-flat.md', report('Flat'))
  await put(p, 'docs/reports/R0003-folder/README.md', report('Folder'))
  await put(p, 'docs/wiki/finding/W0002-flat.md', wiki('W0002'))
  const second = await rebuildIndex(p.root)
  expect(second.status).toBe('rebuilt')
  expect(second.counts.reports).toBe(3)
  expect(second.warnings?.map((issue) => issue.resource).sort()).toEqual([
    'docs/reports/R0002-flat.md',
    'docs/wiki/finding/W0002-flat.md',
  ])
  expect(second.warnings?.[0]?.message).toMatch(/create docs\/.+\/README\.md instead/)

  const third = await rebuildIndex(p.root)
  expect(third.warnings).toBeUndefined()
})
