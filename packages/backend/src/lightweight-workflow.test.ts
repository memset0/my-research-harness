import { promises as fs } from 'node:fs'
import {
  BackendExperimentResponseSchema,
  BackendRunResponseSchema,
  buildLightweightExperimentBundle,
  rebuildIndex,
  writeFsVersion,
} from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendExperimentListResponseSchema } from './indexed-experiments.js'
import { FilesystemMutationService } from './mutation-service.js'
import { FilesystemProjectService } from './project-service.js'

afterEach(removeTempDirs)
const time = '2026-10-20T12:00:00+08:00'
const id = 'E0001-study'
async function fixture() {
  const bundle = buildLightweightExperimentBundle({ id, slug: 'study', timestamp: time })
  bundle['experiment.json'] = JSON.stringify({
    format: 'lightweight',
    variants: {},
    columns: [{ path: 'metrics.loss', label: 'Loss', type: 'number' }],
  })
  bundle['results.csv'] = 'variant,path,stat,value\nV0001,metrics.loss,,0.2\n'
  const p = await createTempProject({
    experiments: { [id]: bundle },
    runs: {
      'logs/E0001/V0002/draft': {
        'run.json': JSON.stringify({
          id: 'draft',
          status: 'READY',
          active: true,
          created_at: time,
          params: { rate: 0.1 },
        }),
      },
      'logs/E0001/V0001/trial': {
        'run.json': JSON.stringify({
          id: 'trial',
          status: 'QUEUED',
          active: true,
          description: 'Preliminary measurement',
          scheduler: { system: 'slurm', job_id: '42' },
          created_at: time,
        }),
      },
    },
  })
  await rebuildIndex(p.root, { role: 'cli' })
  await writeFsVersion(p.root, {
    fs_convention_version: 11,
    installed_at: time,
    last_migrated_at: null,
  })
  const config = { name: 'project-a', root: p.root, include: [], exclude: [] }
  return { p, config, service: new FilesystemProjectService([config]) }
}

describe('FS11 browsing and execution records', () => {
  it('serves inventory and saved results even when native outputs are offline', async () => {
    const { p, service } = await fixture()
    await fs.rename(p.path('logs'), p.path('offline-logs'))
    const inventory = (await service.listRuns('project-a')) as {
      runs: Array<{ recordFormat: string; frontMatter: { status: string } }>
    }
    expect(inventory.runs[0]).toMatchObject({
      recordFormat: 'json',
      frontMatter: { status: 'QUEUED' },
    })
    const exp = BackendExperimentResponseSchema.parse(await service.getExperiment('project-a', id))
    expect(exp.frontMatter.runs).toEqual(['logs/E0001/V0001/trial', 'logs/E0001/V0002/draft'])
    expect(exp.documentReadOnly).toBe(false)
    const summary = exp.documents!.results!.summary!
    expect(summary.format).toBe('lightweight')
    expect(summary.variants[0]).toMatchObject({
      runNotes: { 'logs/E0001/V0001/trial': 'Preliminary measurement' },
      cells: { 'metrics.loss': { value: 0.2 } },
    })
    expect(summary.variants[1]).toMatchObject({
      id: 'V0002',
      draft: { rate: 0.1 },
      status: 'PLANNED',
      cells: {},
    })
    expect(
      BackendExperimentListResponseSchema.parse(await service.listExperiments('project-a'))
        .experiments,
    ).toHaveLength(1)
  })
  it('opens a queued JSON Run and keeps lifecycle writes on the source CLI', async () => {
    const { p, service, config } = await fixture()
    const run = BackendRunResponseSchema.parse(
      await service.getRun('project-a', 'logs/E0001/V0001/trial'),
    )
    expect(run).toMatchObject({
      recordFormat: 'json',
      hasReadme: false,
      frontMatter: { scheduler: { system: 'slurm', job_id: '42' }, createdAt: time },
    })
    expect(run.parseWarnings).toEqual([])
    const mutations = new FilesystemMutationService([config])
    await expect(
      mutations.setRunStatus('project-a', 'logs/E0001/V0001/trial', {
        status: 'RUNNING',
        expectedMtime: run.recordMtime!,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(
      JSON.parse(await fs.readFile(p.path('logs/E0001/V0001/trial/run.json'), 'utf8')).status,
    ).toBe('QUEUED')
    await expect(fs.stat(p.path('logs/E0001/V0001/trial/README.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('keeps running smoke or inactive executions visible independently of evidence selection', async () => {
    const { p, service } = await fixture()
    await fs.mkdir(p.path('logs/E0001/smoke/check'), { recursive: true })
    await fs.writeFile(
      p.path('logs/E0001/smoke/check/run.json'),
      JSON.stringify({ id: 'check', status: 'RUNNING', active: false, created_at: time }),
    )
    await rebuildIndex(p.root, { role: 'cli' })
    const result = BackendExperimentListResponseSchema.parse(
      await service.listExperiments('project-a'),
    )
    expect(result.experiments[0]).toMatchObject({ displayStatus: 'RUNNING', runningRunCount: 1 })
  })
  it('fails with a repair message if a published catalog or the inventory is missing', async () => {
    const { p, service } = await fixture()
    await fs.rm(p.path('.memon/index/experiments.json'))
    await expect(service.listExperiments('project-a')).rejects.toThrow(
      /PROJECT_CATALOG_UNAVAILABLE/,
    )
    await fs.rm(p.path('.memon/index/snapshot.json'))
    await expect(service.listRuns('project-a')).rejects.toThrow(/REGISTERED_INDEX_MISSING/)
  })
})

it('keeps legacy progress when a project adopts the registered inventory', async () => {
  const { p, config } = await fixture()
  const directory = p.path('docs/experiments/E0002-legacy')
  await fs.mkdir(directory, { recursive: true })
  const path = 'logs/legacy-260901-120000'
  await fs.mkdir(p.path(path), { recursive: true })
  await fs.writeFile(
    p.path(path, 'README.md'),
    `---\nid: legacy-260901-120000\nstatus: FINISHED\ncreated_at: ${time}\n---\n`,
  )
  await fs.writeFile(
    `${directory}/README.md`,
    `---\nid: E0002-legacy\nstatus: ACTIVE\nruns: [${path}]\n---\n`,
  )
  await fs.writeFile(
    `${directory}/experiment.json`,
    JSON.stringify({
      experiment_schema_version: 1,
      variants: { V0001: { name: 'Legacy baseline', runs: [path] } },
      research: {
        current_version: 1,
        versions: [{ version: 1, started_at: time, reason: 'Initial measurement' }],
        run_versions: { [path]: 1 },
      },
    }),
  )
  await rebuildIndex(p.root, { role: 'cli' })
  const service = new FilesystemProjectService([config])
  const response = await service.listExperiments('project-a')
  expect(
    'experiments' in response &&
      response.experiments.find((entry) => entry.id === 'E0002-legacy')?.displayStatus,
  ).toBe('COMPLETED')
})
