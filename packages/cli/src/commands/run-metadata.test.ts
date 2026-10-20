import { promises as fs } from 'node:fs'
import { createTempProject, ExitCalled, removeTempDirs, spyExit } from '@memon/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runRunCreate } from './run-metadata.js'
import { runRunRecord } from './run-record.js'

beforeEach(() => {
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})

async function projectFixture() {
  return createTempProject({
    experiments: {
      'E0001-example': {
        'README.md': '---\nid: E0001-example\nstatus: ACTIVE\ntitle: Example\n---\n',
        'experiment.json': JSON.stringify({
          format: 'lightweight',
          variants: {},
          columns: [],
          groups: {},
        }),
      },
    },
  })
}

describe('lightweight Run CLI', () => {
  it('allocates distinct Variants concurrently and skips existing empty directories', async () => {
    const project = await projectFixture()
    await fs.mkdir(project.path('logs/E0001/V0007'), { recursive: true })
    const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
    await Promise.all([
      runRunCreate({ ...base, experiment: 'E0001', id: 'first', params: '{"rate":0.1}' }),
      runRunCreate({ ...base, experiment: 'E0001', id: 'second', params: '{"rate":0.2}' }),
    ])
    const responses = vi
      .mocked(process.stdout.write)
      .mock.calls.map(([text]) => JSON.parse(String(text)))
    expect(responses.map((item) => item.variantId).sort()).toEqual(['V0008', 'V0009'])
    for (const response of responses) {
      expect(response.experimentId).toBe('E0001-example')
      expect(response.path).toBe(`${response.directory}/run.json`)
      const metadata = JSON.parse(await fs.readFile(project.path(response.path), 'utf8'))
      expect(metadata).toMatchObject({ status: 'READY', active: true })
      expect(metadata.created_at).toMatch(/[+-]\d{2}:\d{2}$/)
      expect(await fs.readdir(project.path(response.directory))).not.toContain('README.md')
    }
  })

  it('records an existing smoke directory without inferring times from its name or mtime', async () => {
    const project = await projectFixture()
    const directory = project.path('logs/E0001/smoke/test-200101-000000')
    await fs.mkdir(directory, { recursive: true })
    await fs.utimes(directory, new Date(0), new Date(0))
    await runRunRecord({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      target: directory,
    })
    const metadata = JSON.parse(await fs.readFile(`${directory}/run.json`, 'utf8'))
    expect(metadata.created_at).not.toMatch(/^2020|^1970/)
    expect(await fs.readdir(directory)).toEqual(['result.csv', 'run.json'])
  })

  it('rejects invalid timestamps before creating any Run files', async () => {
    const project = await projectFixture()
    const exit = spyExit()
    try {
      await expect(
        runRunCreate({
          projectRoot: project.root,
          cwd: project.root,
          format: 'json',
          experiment: 'E0001',
          variant: 'V0001',
          id: 'bad',
          createdAt: '2026-02-30T12:00:00+08:00',
        }),
      ).rejects.toBeInstanceOf(ExitCalled)
      await expect(fs.stat(project.path('logs/E0001/V0001/bad'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      exit.restore()
    }
  })
})

it('selects the first Run, preserves an existing selection, and activates only explicitly', async () => {
  const project = await projectFixture()
  const base = {
    projectRoot: project.root,
    cwd: project.root,
    format: 'json' as const,
    experiment: 'E0001',
    variant: 'V0001',
  }
  const read = async (id: string) =>
    JSON.parse(await fs.readFile(project.path(`logs/E0001/V0001/${id}/run.json`), 'utf8'))
  await runRunCreate({ ...base, id: 'first', params: '{"rate":0.2}' })
  expect(await read('first')).toMatchObject({
    active: true,
    status: 'READY',
    params: { rate: 0.2 },
  })
  const table = () =>
    fs.readFile(project.path('docs/experiments/E0001-example/results.csv'), 'utf8')
  expect(await table()).toContain('V0001,params.rate,,0.2')
  await runRunCreate({ ...base, id: 'retry' })
  expect((await read('retry')).active).toBe(false)
  await runRunCreate({ ...base, id: 'chosen', activate: true, params: '{"rate":0.4}' })
  expect((await read('first')).active).toBe(false)
  expect((await read('chosen')).active).toBe(true)
  expect(await table()).toContain('V0001,params.rate,,0.4')
  expect(await table()).not.toContain('0.2')
  await runRunCreate({ ...base, variant: 'smoke', id: 'check' })
  expect(await table()).not.toContain('smoke')
  const declaration = JSON.parse(
    await fs.readFile(project.path('docs/experiments/E0001-example/experiment.json'), 'utf8'),
  )
  expect(declaration.variants).toEqual({})
})

it('reports a saved record but incomplete publication when custom aggregation fails', async () => {
  const { captureCli } = await import('../test-support/results-project.js')
  const project = await projectFixture()
  const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
  const directory = 'docs/experiments/E0001-example'
  await fs.writeFile(
    project.path(directory, 'experiment.json'),
    JSON.stringify({
      format: 'lightweight',
      variants: { V0001: { aggregate: 'aggregate_variant.py' } },
    }),
  )
  await fs.writeFile(
    project.path(directory, 'aggregate_variant.py'),
    'raise RuntimeError("measurement unavailable")\n',
  )
  await fs.writeFile(
    project.path(directory, 'results.csv'),
    'variant,path,stat,value\nV0001,metrics.loss,,0.9\n',
  )
  const result = await captureCli(() =>
    runRunCreate({ ...base, experiment: 'E0001', variant: 'V0001', id: 'prepared' }),
  )
  expect(result.exitCode).toBe(1)
  expect(result.json).toMatchObject({ ok: false, created: true, incomplete: true })
  expect(
    JSON.parse(await fs.readFile(project.path('logs/E0001/V0001/prepared/run.json'), 'utf8'))
      .status,
  ).toBe('READY')
  expect(await fs.readFile(project.path(directory, 'results.csv'), 'utf8')).toContain(
    'metrics.loss,,0.9',
  )
  expect(result.stderr).toContain('memon refresh E0001')
})
