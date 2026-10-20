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
import { runProjectInit } from './project.js'
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
  expect((await captureCli(() => runProjectInit(base))).exitCode).toBe(0)
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
