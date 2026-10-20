import { promises as fs } from 'node:fs'
import { buildLightweightExperimentBundle } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { Command } from 'commander'
import { afterEach, describe, expect, it } from 'vitest'
import { captureCli } from '../test-support/results-project.js'
import { registerExperimentResearchCommands } from './experiment-research.js'
import { runExperimentResults, runExperimentResultsRebuild } from './experiment-results.js'
import { runRunResultGet, runRunResultLint } from './run-result.js'

afterEach(removeTempDirs)
const time = '2026-10-19T12:00:00+08:00'
const ID = 'E0001-study'
const EXP = `docs/experiments/${ID}`
async function fixture() {
  const bundle = buildLightweightExperimentBundle({ id: ID, slug: 'study', timestamp: time })
  bundle['experiment.json'] = JSON.stringify({
    format: 'lightweight',
    variants: {},
    columns: [{ path: 'run.status', label: 'Execution', type: 'string' }],
  })
  return createTempProject({
    experiments: { [ID]: bundle },
    runs: {
      'logs/E0001/V0001/run-a': {
        'run.json': JSON.stringify({
          id: 'run-a',
          status: 'QUEUED',
          active: true,
          created_at: time,
        }),
        'result.csv': 'path,stat,value\nmetrics.loss,,0.200\n',
      },
    },
    files: { '.memon/project.yml': 'schema_version: 1\nrun_dirs: [logs/*/*/*]\n' },
  })
}

describe('lightweight Experiment CLI', () => {
  it('rebuilds the tracked CSV and reads exactly its stored bytes without Run access', async () => {
    const p = await fixture()
    const base = { projectRoot: p.root, cwd: p.root, format: 'json' as const }
    const rebuilt = await captureCli(() =>
      runExperimentResultsRebuild({ ...base, idOrSlug: ID, all: false }),
    )
    expect(rebuilt.exitCode).toBe(0)
    const saved = await fs.readFile(p.path(EXP, 'results.csv'), 'utf8')
    expect(saved).toBe(
      'variant,path,stat,value\nV0001,metrics.loss,,0.200\nV0001,run.status,,QUEUED\n',
    )
    await fs.rm(p.path('logs'), { recursive: true })
    const output = await captureCli(() =>
      runExperimentResults({ ...base, idOrSlug: ID, output: 'csv', columnGroup: 'all' }),
    )
    expect(output.exitCode).toBe(0)
    expect(output.stdout).toBe(saved)
  })
  it('reports multi-Run failure without replacing the saved result', async () => {
    const p = await fixture()
    const base = { projectRoot: p.root, cwd: p.root, format: 'json' as const }
    await fs.mkdir(p.path('logs/E0001/V0001/b'))
    await fs.writeFile(
      p.path('logs/E0001/V0001/b/run.json'),
      JSON.stringify({ id: 'b', status: 'READY', active: true, created_at: time }),
    )
    await fs.writeFile(p.path(EXP, 'results.csv'), 'prior bytes')
    const out = await captureCli(() =>
      runExperimentResultsRebuild({ ...base, idOrSlug: ID, all: false }),
    )
    expect(out.exitCode).toBe(1)
    expect(out.json.experiments[0].error.message).toMatch(/V0001.*multiple/)
    expect(await fs.readFile(p.path(EXP, 'results.csv'), 'utf8')).toBe('prior bytes')
  })
  it('creates a named draft from the existing Variant command group', async () => {
    const p = await fixture()
    const program = new Command('memon')
    const exp = program.command('experiment')
    registerExperimentResearchCommands(exp, () => ({
      projectRoot: p.root,
      cwd: p.root,
      format: 'json',
    }))
    const result = await captureCli(() =>
      program
        .parseAsync([
          'node',
          'memon',
          'experiment',
          'variant',
          'create',
          ID,
          '--name',
          'New idea',
          '--draft',
          'Try a higher rate',
        ])
        .then(() => {}),
    )
    expect(result.exitCode).toBe(0)
    expect(result.json.id).toBe('V0002')
    const data = JSON.parse(await fs.readFile(p.path(EXP, 'experiment.json'), 'utf8'))
    expect(data.variants).toEqual({})
    expect(
      JSON.parse(
        await fs.readFile(p.path(`logs/E0001/V0002/${result.json.runId}/run.json`), 'utf8'),
      ),
    ).toMatchObject({
      name: 'New idea',
      description: 'Try a higher rate',
      status: 'READY',
      active: true,
    })
  })
  it('reads and lints an unversioned Run result without requiring README', async () => {
    const p = await fixture()
    const input = {
      projectRoot: p.root,
      cwd: p.root,
      format: 'json' as const,
      run: 'logs/E0001/V0001/run-a',
    }
    const get = await captureCli(() => runRunResultGet(input))
    expect(get.exitCode).toBe(0)
    expect(get.json.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RESULT_SCHEMA_VERSION_MISSING' })]),
    )
    const lint = await captureCli(() => runRunResultLint(input))
    expect(lint.exitCode).toBe(0)
  })
})
