import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { resetCliInvocationForTest } from '../lib/invocation.js'
import { parseProgram } from '../lib/program.js'
import { createResearchProgram } from '../research-program.js'
import { captureCli } from '../test-support/results-project.js'
import { runExperimentCreate } from './experiment-doc.js'

afterEach(async () => {
  resetCliInvocationForTest()
  vi.restoreAllMocks()
  await removeTempDirs()
})

it('creates fresh research and publishes prepared parameters and native measurements through the six-command interface', async () => {
  const project = await createTempProject({ files: { 'train.py': '# ordinary project code\n' } })
  const cli = (...args: string[]) =>
    captureCli(() =>
      parseProgram(createResearchProgram(), [
        'node',
        'memon',
        '--project-root',
        project.root,
        ...args,
      ]),
    )
  const experiment = await cli('experiment', 'create', 'study')
  expect(experiment.exitCode).toBe(0)
  const id = 'E0001-study'
  expect(await fs.readFile(project.path('docs/experiments', id, 'README.md'), 'utf8')).not.toMatch(
    /hypothes/i,
  )
  expect((await cli('experiment', 'create', 'retired', '--hypotheses', 'H0001')).exitCode).not.toBe(
    0,
  )
  const marker = JSON.parse(await fs.readFile(project.path('.memon/version.json'), 'utf8'))
  expect(marker.fs_convention_version).toBe(11)
  expect(marker.installed_at).toMatch(/[+-]\d{2}:\d{2}$/)
  expect((await fs.readdir(project.path('docs/experiments', id))).sort()).toEqual([
    'README.md',
    'experiment.json',
  ])
  const history = '## H0001. Old claim\n\nHistorical evidence.\n'
  await fs.writeFile(project.path('docs/hypotheses.md'), history)
  const created = await cli(
    'run',
    'create',
    'trial',
    '--experiment',
    id,
    '--params',
    '{"rate":0.1}',
  )
  expect(created.exitCode).toBe(0)
  const run = 'logs/E0001/V0001/trial'
  expect(await fs.readFile(project.path(run, 'result.csv'), 'utf8')).toContain('params.rate,,0.1')
  const table = () => fs.readFile(project.path('docs/experiments', id, 'results.csv'), 'utf8')
  expect(await table()).toContain('V0001,params.rate,,0.1')
  expect((await cli('show', id, '--results')).exitCode).toBe(0)
  expect((await cli('run', 'update', run, '--status', 'QUEUED', '--job-id', '42')).exitCode).toBe(0)
  expect((await cli('run', 'update', run, '--status', 'RUNNING')).exitCode).toBe(0)
  // A native analysis script can write only useful measurements. No result-set or receipt step.
  await fs.writeFile(project.path(run, 'result.csv'), 'path,stat,value\nmetrics.loss,,0.2\n')
  expect((await cli('run', 'update', run, '--status', 'FINISHED')).exitCode).toBe(0)
  expect(await table()).toContain('V0001,metrics.loss,,0.2')
  const record = (await cli('show', run)).json
  expect(record.metadata).toMatchObject({ status: 'FINISHED', params: { rate: 0.1 } })
  expect((await cli('show')).json.runs).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: run, status: 'FINISHED' })]),
  )
  expect(await fs.readdir(project.path(run))).not.toContain('README.md')
  const draft = await cli('run', 'create', '--experiment', id, '--params', '{"rate":0.2}')
  expect(draft.exitCode).toBe(0)
  expect(await table()).toContain('V0002,params.rate,,0.2')
  const metadata = JSON.parse(await fs.readFile(project.path(run, 'run.json'), 'utf8'))
  await fs.writeFile(project.path(run, 'run.json'), JSON.stringify({ ...metadata, active: false }))
  expect((await cli('refresh', 'E0001')).exitCode).toBe(0)
  expect(await table()).not.toContain('V0001,metrics.loss')
  expect(
    (await cli('run', 'create', 'check', '--experiment', id, '--variant', 'smoke')).exitCode,
  ).toBe(0)
  expect((await cli('show')).json.runs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'logs/E0001/smoke/check', status: 'READY' }),
    ]),
  )
  expect(await table()).not.toContain('smoke,')
  expect(await fs.readFile(project.path('docs/hypotheses.md'), 'utf8')).toBe(history)
})

it('does not relabel unmarked old research or overwrite a malformed marker', async () => {
  const fixtures: Record<string, string>[] = [
    { 'logs/old/output.txt': 'original evidence' },
    { '.memon/version.json': 'broken marker' },
  ]
  for (const files of fixtures) {
    const project = await createTempProject({ files })
    const input = { projectRoot: project.root, cwd: project.root, slug: 'study' }
    if ('logs/old/output.txt' in files) {
      const result = await captureCli(() => runExperimentCreate(input))
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Unmarked research')
      expect(await fs.readFile(project.path('logs/old/output.txt'), 'utf8')).toBe(
        'original evidence',
      )
    } else {
      await expect(captureCli(() => runExperimentCreate(input))).rejects.toThrow('failed to parse')
      expect(await fs.readFile(project.path('.memon/version.json'), 'utf8')).toBe('broken marker')
    }
    await expect(fs.stat(project.path('docs/experiments'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  }
})
