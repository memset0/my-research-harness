import { promises as fs } from 'node:fs'
import { buildLightweightExperimentBundle } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { runRefresh } from './refresh.js'
import { runShow } from './show.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})

it('reads an explicit JSON Run without walking or reading unrelated Runs', async () => {
  const run = 'logs/E0001/V0001/trial'
  const project = await createTempProject({
    runs: {
      [run]: {
        'run.json': JSON.stringify({
          id: 'trial',
          status: 'QUEUED',
          active: true,
          created_at: '2026-10-20T08:00:00+08:00',
        }),
      },
      'logs/E0002/V0001/broken': { 'run.json': 'invalid metadata' },
    },
  })
  const read = vi.spyOn(fs, 'readFile')
  const walk = vi.spyOn(fs, 'readdir')
  const result = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      id: run,
    }),
  )
  expect(result.exitCode).toBe(0)
  expect(result.json.metadata.status).toBe('QUEUED')
  expect(
    [...read.mock.calls, ...walk.mock.calls].some(([path]) => String(path).includes('/logs/E0002')),
  ).toBe(false)
})

it('keeps legacy README inspection available', async () => {
  const run = 'logs/trial-261020-080000'
  const project = await createTempProject({
    runs: { [run]: { 'README.md': '---\nstatus: FINISHED\n---\n\nA useful result.\n' } },
  })
  const output = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'human',
      id: run,
    }),
  )
  expect(output.exitCode).toBe(0)
  expect(output.stdout).toContain('A useful result.')
})

it('rejects an ambiguous ID without choosing or hydrating a Run', async () => {
  const metadata = JSON.stringify({
    id: 'trial',
    status: 'READY',
    active: true,
    created_at: '2026-10-20T08:00:00+08:00',
  })
  const project = await createTempProject({
    runs: {
      'logs/E0001/V0001/trial': { 'run.json': metadata },
      'logs/E0001/V0002/trial': { 'run.json': metadata },
    },
    files: {
      '.memon/version.json': JSON.stringify({
        fs_convention_version: 11,
        installed_at: '2026-10-20T08:00:00+08:00',
        last_migrated_at: null,
      }),
    },
  })
  const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
  expect((await captureCli(() => runRefresh({ ...base, experiments: [] }))).exitCode).toBe(0)
  const read = vi.spyOn(fs, 'readFile')
  await expect(captureCli(() => runShow({ ...base, id: 'trial' }))).rejects.toThrow(
    'Ambiguous Run ID',
  )
  expect(read.mock.calls.some(([path]) => String(path).endsWith('/run.json'))).toBe(false)
})

it('reads inventory without Run IO and keeps retired evidence explicitly accessible', async () => {
  const time = '2026-10-20T08:00:00+08:00'
  const current = buildLightweightExperimentBundle({
    id: 'E0001-current',
    slug: 'current',
    timestamp: time,
  })
  const retired = buildLightweightExperimentBundle({
    id: 'E0002-old',
    slug: 'old',
    timestamp: time,
  })
  retired['README.md'] = retired['README.md']!.replace('status: ACTIVE', 'status: RETIRED')
  const record = (id: string, active: boolean) => ({
    'run.json': JSON.stringify({ id, status: 'FINISHED', active, created_at: time }),
  })
  const project = await createTempProject({
    experiments: { 'E0001-current': current, 'E0002-old': retired },
    runs: {
      'logs/E0001/V0001/current': record('current', true),
      'logs/E0001/V0001/retry': record('retry', false),
      'logs/E0002/V0001/old': record('old', true),
    },
    files: { '.memon/project.yml': 'schema_version: 1\nrun_dirs: [logs/*/*/*]\n' },
  })
  const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
  expect((await captureCli(() => runRefresh({ ...base, experiments: [] }))).exitCode).toBe(0)
  const reads = vi.spyOn(fs, 'readFile')
  const walks = vi.spyOn(fs, 'readdir')
  const currentOutput = await captureCli(() => runShow(base))
  expect(currentOutput.json.experiments.map((e: { id: string }) => e.id)).toEqual(['E0001-current'])
  expect(currentOutput.json.runs.map((r: { id: string }) => r.id)).toEqual(['current'])
  const history = await captureCli(() => runShow({ ...base, includeHistory: true }))
  expect(history.json.runs).toHaveLength(3)
  expect(
    [...reads.mock.calls, ...walks.mock.calls].some(([path]) => String(path).includes('/logs')),
  ).toBe(false)
  expect(
    (await captureCli(() => runShow({ ...base, id: 'logs/E0002/V0001/old' }))).json.metadata.active,
  ).toBe(true)
})

it('reports missing inventory without scanning or creating it', async () => {
  const project = await createTempProject()
  const walk = vi.spyOn(fs, 'readdir')
  const result = await captureCli(() =>
    runShow({ projectRoot: project.root, cwd: project.root, format: 'json' }),
  )
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('memon refresh')
  expect(walk.mock.calls.some(([path]) => String(path).includes('/logs'))).toBe(false)
  expect(await fs.readdir(project.root)).toEqual([])
})

it('reads Wiki content and diagnostics without resolving its Experiment source', async () => {
  const project = await createTempProject({
    files: {
      'docs/wiki/note/W0001-summary.md':
        '---\nid: W0001\nkind: note\ntitle: Summary\nsources: [E9999]\ncreated_at: 2026-10-20T08:00:00+08:00\nupdated_at: 2026-10-20T08:00:00+08:00\n---\nA short finding.\n',
    },
  })
  const read = vi.spyOn(fs, 'readFile')
  const result = await captureCli(() =>
    runShow({ projectRoot: project.root, cwd: project.root, format: 'json', id: 'W0001' }),
  )
  expect(result.exitCode).toBe(0)
  expect(result.json.content).toContain('A short finding.')
  expect(result.json.diagnostics).toBeDefined()
  expect(read.mock.calls.some(([path]) => String(path).includes('/docs/experiments'))).toBe(false)
})

it('rejects escaping Experiment addresses', async () => {
  const project = await createTempProject()
  const output = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      id: '../E0001',
      kind: 'experiment',
    }),
  )
  expect(output.exitCode).toBe(2)
})
