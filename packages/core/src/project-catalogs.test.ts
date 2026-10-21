import { readFile } from 'node:fs/promises'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { defaultIndexFs } from './derived-index/fs.js'
import { rebuildIndex } from './derived-index/rebuild.js'
import { experimentCatalogEntries, writeProjectCatalog } from './project-catalogs.js'

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
