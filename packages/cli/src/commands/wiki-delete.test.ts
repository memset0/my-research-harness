import { promises as fs } from 'node:fs'
import { rebuildIndex } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { runWikiCreate, runWikiDelete, runWikiMove } from './wiki.js'

afterEach(removeTempDirs)

it('reports a source and line, then deletes only after that link is repaired', async () => {
  const p = await createTempProject()
  const options = { projectRoot: p.root, cwd: p.root, format: 'json' }
  expect(
    (
      await captureCli(() =>
        runWikiCreate({ ...options, kind: 'methods', slug: 'model', title: 'Model' }),
      )
    ).exitCode,
  ).toBe(0)
  await fs.mkdir(p.path('docs/reports'), { recursive: true })
  await fs.writeFile(p.path('docs/reports/R0001-review.md'), 'See @W0001.\n')
  const blocked = await captureCli(() => runWikiDelete({ ...options, page: 'W0001' }))
  expect(blocked.exitCode).not.toBe(0)
  expect(JSON.parse(blocked.stderr)).toMatchObject({
    error: {
      code: 'WIKI_REFERENCED',
      details: {
        references: expect.arrayContaining([
          expect.objectContaining({ source: 'docs/reports/R0001-review.md', line: 1 }),
        ]),
      },
    },
  })
  await fs.mkdir(p.path('docs/reports'), { recursive: true })
  await fs.writeFile(p.path('docs/reports/R0001-review.md'), 'The explanation moved to a Report.\n')
  const deleted = await captureCli(() => runWikiDelete({ ...options, page: 'W0001' }))
  expect(deleted.exitCode, deleted.stderr).toBe(0)
  expect(JSON.parse(deleted.stdout)).toMatchObject({
    ok: true,
    id: 'W0001',
    deleted: ['docs/wiki/methods/W0001-model'],
  })
  await fs.rm(p.path('.memon/index'), { recursive: true })
  await rebuildIndex(p.root, { role: 'cli' })
  const next = await captureCli(() =>
    runWikiCreate({ ...options, kind: 'methods', slug: 'next', title: 'Next' }),
  )
  expect(next.exitCode, next.stderr).toBe(0)
  expect(JSON.parse(next.stdout).id).toBe('W0002')
})

it('keeps minimal authoring optional while preserving legacy standalone creation', async () => {
  const p = await createTempProject()
  const options = { projectRoot: p.root, cwd: p.root, format: 'json' }
  const create = await captureCli(() =>
    runWikiCreate({ ...options, kind: 'finding', slug: 'finding', title: 'Finding' }),
  )
  expect(create.exitCode, create.stderr).toBe(0)
  const text = await fs.readFile(p.path('docs/wiki/finding/W0001-finding/README.md'), 'utf8')
  expect(text).not.toMatch(/^status:|^sources:|^## /m)
  expect(text).toMatch(/created_at: .*\+\d\d:\d\d/)
  const legacy = await captureCli(() =>
    runWikiCreate({ ...options, kind: 'note', slug: 'legacy', title: 'Legacy', bundle: false }),
  )
  expect(legacy.exitCode, legacy.stderr).toBe(0)
  expect(JSON.parse(legacy.stdout).path).toBe('docs/wiki/note/W0002-legacy.md')
})

it('moves manifest bundles without converting JSON to Markdown or losing extensions', async () => {
  const p = await createTempProject({
    files: {
      'docs/wiki/analysis/W0007-explorer/manifest.json': JSON.stringify({
        id: 'W0007',
        title: 'Explorer',
        type: 'html',
        entry: 'index.html',
        custom: { theme: 'night' },
        created_at: '2026-10-20T12:00:00+08:00',
      }),
      'docs/wiki/analysis/W0007-explorer/index.html': '<main>Explorer</main>',
    },
  })
  const moved = await captureCli(() =>
    runWikiMove({
      projectRoot: p.root,
      cwd: p.root,
      format: 'json',
      page: 'W0007',
      target: 'tools/explorer-v2',
    }),
  )
  expect(moved.exitCode, moved.stderr).toBe(0)
  expect(
    JSON.parse(
      await fs.readFile(p.path('docs/wiki/tools/W0007-explorer-v2/manifest.json'), 'utf8'),
    ),
  ).toMatchObject({
    id: 'W0007',
    kind: 'tools',
    type: 'html',
    custom: { theme: 'night' },
    created_at: '2026-10-20T12:00:00+08:00',
  })
  expect(await fs.readFile(p.path('docs/wiki/tools/W0007-explorer-v2/index.html'), 'utf8')).toBe(
    '<main>Explorer</main>',
  )
})

it('serializes creation so concurrent callers receive different stable IDs', async () => {
  const p = await createTempProject()
  // Capture both outputs together; individual capture helpers replace globals.
  const result = await captureCli(() =>
    Promise.all(
      ['first', 'second'].map((slug) =>
        runWikiCreate({
          projectRoot: p.root,
          cwd: p.root,
          kind: 'topic',
          slug,
          title: slug,
          format: 'json',
        }),
      ),
    ),
  )
  expect(result.exitCode, result.stderr).toBe(0)
  const entries = await fs.readdir(p.path('docs/wiki/topic'))
  expect(entries.map((entry) => entry.slice(0, 5)).sort()).toEqual(['W0001', 'W0002'])
})

it('does not treat an unreachable deployment mapping as a confirmed other project', async () => {
  const p = await createTempProject()
  const options = { projectRoot: p.root, cwd: p.root, format: 'json' }
  const created = await captureCli(() =>
    runWikiCreate({ ...options, kind: 'note', slug: 'alpha', title: 'Alpha' }),
  )
  expect(created.exitCode, created.stderr).toBe(0)
  await fs.writeFile(
    p.path('config.yml'),
    `projects:\n  - name: registered\n    root: ${JSON.stringify(p.path('unreachable'))}\n`,
  )
  await fs.mkdir(p.path('docs/reports'), { recursive: true })
  await fs.writeFile(p.path('docs/reports/R0001-review.md'), '[Page](/p/registered/wiki/W0001)\n')
  const result = await captureCli(() => runWikiDelete({ ...options, page: 'W0001' }))
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr).toContain('WIKI_REFERENCE_AMBIGUOUS')
  expect(await fs.readFile(p.path('docs/wiki/note/W0001-alpha/README.md'), 'utf8')).toContain(
    '# Alpha',
  )
})
