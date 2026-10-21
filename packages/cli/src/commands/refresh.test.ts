import { promises as fs } from 'node:fs'
import { buildLightweightExperimentBundle, lightweightPublicationErrorPath } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { Command } from 'commander'
import { afterEach, expect, it, vi } from 'vitest'
import {
  beginCliInvocation,
  finishCliInvocation,
  resetCliInvocationForTest,
} from '../lib/invocation.js'
import { captureCli } from '../test-support/results-project.js'
import { registerRefreshCommand, runRefresh } from './refresh.js'

afterEach(async () => {
  vi.restoreAllMocks()
  resetCliInvocationForTest()
  await removeTempDirs()
})
const timestamp = '2026-10-20T12:00:00+08:00'
const id = 'E0001-example'
const run = 'logs/E0001/V0001/trial'

async function fixture() {
  const project = await createTempProject({
    files: {
      '.memon/version.json': JSON.stringify({
        fs_convention_version: 11,
        installed_at: timestamp,
        last_migrated_at: null,
      }),
    },
    experiments: {
      [id]: buildLightweightExperimentBundle({ id, slug: 'example', timestamp }),
      'E0002-other': buildLightweightExperimentBundle({
        id: 'E0002-other',
        slug: 'other',
        timestamp,
      }),
    },
    runs: {
      [run]: {
        'run.json': JSON.stringify({
          id: 'trial',
          status: 'READY',
          active: true,
          created_at: timestamp,
          params: { rate: 0.1 },
        }),
        'result.csv': 'path,stat,value\n',
      },
    },
  })
  const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
  expect((await captureCli(() => runRefresh({ ...base, experiments: [] }))).exitCode).toBe(0)
  return { project, base }
}

it('publishes direct edits and inventory through the real command hooks without reading other Runs', async () => {
  const { project, base } = await fixture()
  const metadataPath = project.path(run, 'run.json')
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
  await fs.writeFile(
    metadataPath,
    JSON.stringify({
      ...metadata,
      status: 'FINISHED',
      params: { rate: 0.2 },
      finished_at: timestamp,
      name: 'Measured',
      wandb: 'https://example.com/trial',
    }),
  )
  await fs.writeFile(project.path(run, 'result.csv'), 'path,stat,value\nmetrics.loss,,0.4\n')
  await fs.mkdir(project.path('logs/E0002/V0001/broken'), { recursive: true })
  await fs.writeFile(project.path('logs/E0002/V0001/broken/run.json'), 'unreadable metadata')
  const reads = vi.spyOn(fs, 'readFile')
  const walks = vi.spyOn(fs, 'readdir')
  const program = new Command('memon')
  program.hook('preAction', async (_parent, command) => {
    await beginCliInvocation({ command, globalProjectRoot: project.root, cwd: project.root })
  })
  program.hook('postAction', finishCliInvocation)
  registerRefreshCommand(program, () => base)
  const output = await captureCli(() =>
    program.parseAsync(['refresh', 'E0001', id], { from: 'user' }),
  )
  expect(output.exitCode).toBe(0)
  expect(output.json.experiments).toHaveLength(1)
  expect(
    [...reads.mock.calls, ...walks.mock.calls].some(([path]) =>
      String(path).includes('/logs/E0002'),
    ),
  ).toBe(false)
  const table = await fs.readFile(project.path(`docs/experiments/${id}/results.csv`), 'utf8')
  expect(table).toContain('V0001,params.rate,,0.2')
  expect(table).toContain('V0001,metrics.loss,,0.4')
  const index = JSON.parse(await fs.readFile(project.path('.memon/index/snapshot.json'), 'utf8'))
  expect(index.runs[run]).toMatchObject({
    status: 'FINISHED',
    row: { name: 'Measured', params: { rate: 0.2 }, wandb: 'https://example.com/trial' },
  })
  expect(await fs.readFile(metadataPath, 'utf8')).toContain(
    '"finished_at":"2026-10-20T12:00:00+08:00"',
  )
})

it('reports incomplete inventory publication and supports explicit repair', async () => {
  const { project, base } = await fixture()
  const snapshot = project.path('.memon/index/snapshot.json')
  await fs.writeFile(snapshot, 'broken snapshot')
  const output = await captureCli(() => runRefresh({ ...base, experiments: [id] }))
  expect(output.exitCode).toBe(1)
  expect(output.json.ok).toBe(false)
  expect(output.json.experiments[0].error.message).toMatch(/inventory publication incomplete/)
  expect(await fs.readFile(project.path(lightweightPublicationErrorPath(id)), 'utf8')).toMatch(
    /incomplete/,
  )
  expect(JSON.parse(await fs.readFile(project.path(run, 'run.json'), 'utf8')).status).toBe('READY')
  expect((await captureCli(() => runRefresh({ ...base, experiments: [] }))).exitCode).toBe(0)
  expect((await captureCli(() => runRefresh({ ...base, experiments: [id] }))).exitCode).toBe(0)
})

it('keeps the saved table when active evidence conflicts; inventory-only refresh does not aggregate', async () => {
  const { project, base } = await fixture()
  expect(
    (await captureCli(() => runRefresh({ ...base, experiments: [id, 'E0002'] }))).exitCode,
  ).toBe(0)
  const tablePath = project.path(`docs/experiments/${id}/results.csv`)
  const previous = await fs.readFile(tablePath, 'utf8')
  await fs.mkdir(project.path('logs/E0001/V0001/retry'))
  await fs.writeFile(
    project.path('logs/E0001/V0001/retry/run.json'),
    JSON.stringify({
      id: 'retry',
      status: 'READY',
      active: true,
      created_at: timestamp,
    }),
  )
  expect((await captureCli(() => runRefresh({ ...base, experiments: [] }))).exitCode).toBe(0)
  expect(await fs.readFile(tablePath, 'utf8')).toBe(previous)
  const failed = await captureCli(() => runRefresh({ ...base, experiments: [id] }))
  expect(failed.exitCode).toBe(1)
  expect(failed.json.experiments[0].error.message).toMatch(/multiple active/)
  expect(await fs.readFile(tablePath, 'utf8')).toBe(previous)
})

it('removes stale inventory entries only within the refreshed Experiment', async () => {
  const { project, base } = await fixture()
  await fs.rm(project.path(run), { recursive: true })
  expect((await captureCli(() => runRefresh({ ...base, experiments: [id] }))).exitCode).toBe(0)
  const snapshot = JSON.parse(await fs.readFile(project.path('.memon/index/snapshot.json'), 'utf8'))
  expect(snapshot.runs[run]).toBeUndefined()
  expect(Object.keys(snapshot.experiments)).toHaveLength(2)
})

it('reports invalid direct metadata and Wiki edits during publication', async () => {
  const { project, base } = await fixture()
  await fs.writeFile(project.path(run, 'run.json'), '{"id":"trial","status":"not-a-state"}')
  const scoped = await captureCli(() => runRefresh({ ...base, experiments: [id] }))
  expect(scoped.exitCode).toBe(1)
  expect(scoped.json.ok).toBe(false)
  await fs.mkdir(project.path('docs/wiki/note'), { recursive: true })
  await fs.writeFile(
    project.path('docs/wiki/note/W0001-broken.md'),
    '---\nid: W0001\nkind: note\n---\n',
  )
  const inventory = await captureCli(() => runRefresh({ ...base, experiments: [] }))
  expect(inventory.exitCode).toBe(1)
  expect(inventory.json.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ severity: 'error' })]),
  )
})

const wikiPage = (pageId: string) =>
  `---\nid: ${pageId}\nkind: finding\ntitle: ${pageId}\nstatus: TENTATIVE\ncreated_at: ${timestamp}\nupdated_at: ${timestamp}\n---\n# ${pageId}\n`

async function put(path: string, content: string): Promise<void> {
  await fs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await fs.writeFile(path, content)
}

it('refuses publication, listing every unindexable document, and leaves the index unchanged', async () => {
  const { project, base } = await fixture()
  const wikiBefore = await fs.readFile(project.path('.memon/index/wiki.json'), 'utf8')
  await put(project.path('docs/reports/R0001-broken/manifest.json'), '{"type":"html"}\n')
  await put(project.path('docs/reports/R0002-also/manifest.json'), '{"type":"html"}\n')
  await put(project.path('docs/wiki/finding/W0001-first/README.md'), wikiPage('W0001'))

  const refused = await captureCli(() => runRefresh({ ...base, experiments: [] }))

  expect(refused.exitCode).not.toBe(0)
  expect(refused.error).toMatchObject({ code: 'INVALID_DOCUMENTS' })
  const details = (refused.error as { details?: { published: boolean; invalid: unknown[] } })
    .details
  expect(details?.published).toBe(false)
  expect(details?.invalid).toHaveLength(2)
  expect(await fs.readFile(project.path('.memon/index/wiki.json'), 'utf8')).toBe(wikiBefore)

  // The refusal released the project writer lock: a repaired tree publishes.
  await fs.rm(project.path('docs/reports'), { recursive: true })
  const repaired = await captureCli(() => runRefresh({ ...base, experiments: [] }))
  expect(repaired.exitCode).toBe(0)
  expect(repaired.json).toMatchObject({ published: true, counts: { wiki: 1, reports: 0 } })
})

it('checks the published index without writing and reports it current after refresh', async () => {
  const { project, base } = await fixture()
  await put(project.path('docs/wiki/finding/W0001-first/README.md'), wikiPage('W0001'))
  await put(
    project.path('docs/reports/R0001-weekly/README.md'),
    `---\ntitle: Weekly\ncreated_at: ${timestamp}\n---\n# Weekly\n`,
  )
  const wikiBefore = await fs.readFile(project.path('.memon/index/wiki.json'), 'utf8')

  const stale = await captureCli(() => runRefresh({ ...base, experiments: [], check: true }))
  expect(stale.exitCode).toBe(1)
  expect(stale.json).toMatchObject({ current: false })
  expect(stale.json.catalogs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'wiki', state: 'stale', missing: ['W0001'] }),
      expect.objectContaining({ kind: 'reports', state: 'stale', missing: ['R0001'] }),
    ]),
  )
  expect(await fs.readFile(project.path('.memon/index/wiki.json'), 'utf8')).toBe(wikiBefore)

  const published = await captureCli(() => runRefresh({ ...base, experiments: [] }))
  expect(published.exitCode).toBe(0)
  expect(published.json).toMatchObject({
    published: true,
    counts: { experiments: 2, wiki: 1, reports: 1 },
  })

  const current = await captureCli(() => runRefresh({ ...base, experiments: [], check: true }))
  expect(current.exitCode).toBe(0)
  expect(current.json).toMatchObject({ current: true, invalid: [] })

  const mixed = await captureCli(() => runRefresh({ ...base, experiments: [id], check: true }))
  expect(mixed.error).toMatchObject({ code: 'BAD_REQUEST' })
})
