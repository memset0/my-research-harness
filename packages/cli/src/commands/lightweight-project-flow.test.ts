import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { Command } from 'commander'
import { afterEach, expect, it, vi } from 'vitest'
import {
  beginCliInvocation,
  finishCliInvocation,
  resetCliInvocationForTest,
} from '../lib/invocation.js'
import { captureCli } from '../test-support/results-project.js'
import { runExperimentCreate } from './experiment-doc.js'
import { registerExperimentResearchCommands } from './experiment-research.js'
import { runProjectInit } from './project.js'
import { registerExperimentResultsCommands } from './results-commands.js'
import { runRunCreate, runRunUpdate } from './run-metadata.js'
import { runRunResultSet } from './run-result.js'

// Exercise the new-project branch before the separate release-version commit.
vi.mock('@memon/core', async (original) => ({
  ...(await original<typeof import('@memon/core')>()),
  FS_CONVENTION_VERSION: 11,
}))
afterEach(removeTempDirs)
afterEach(resetCliInvocationForTest)

it('creates a registered project and publishes planned then measured Variant data using only CLI writes', async () => {
  const project = await createTempProject()
  const base = { projectRoot: project.root, cwd: project.root, format: 'json' as const }
  expect((await captureCli(() => runProjectInit(base))).exitCode).toBe(0)
  const marker = JSON.parse(await fs.readFile(project.path('.memon/version.json'), 'utf8'))
  expect(marker.fs_convention_version).toBe(11)
  expect(marker.installed_at).toMatch(/[+-]\d{2}:\d{2}$/)
  const experiment = await captureCli(() =>
    runExperimentCreate({ ...base, slug: 'example', hypotheses: [] }),
  )
  expect(experiment.exitCode).toBe(0)
  const id = 'E0001-example'
  expect((await fs.readdir(project.path('docs/experiments', id))).sort()).toEqual([
    'README.md',
    'experiment.json',
  ])
  const created = await captureCli(() =>
    runRunCreate({
      ...base,
      experiment: id,
      variant: 'V0001',
      id: 'trial',
      params: '{"rate":0.1}',
    }),
  )
  expect(created.exitCode).toBe(0)
  const path = 'logs/E0001/V0001/trial'
  const table = () => fs.readFile(project.path('docs/experiments', id, 'results.csv'), 'utf8')
  expect(await table()).toContain('V0001,params.rate,,0.1')
  expect(
    (await captureCli(() => runRunUpdate({ ...base, target: path, status: 'QUEUED', jobId: '42' })))
      .exitCode,
  ).toBe(0)
  expect(
    (await captureCli(() => runRunUpdate({ ...base, target: path, status: 'RUNNING' }))).exitCode,
  ).toBe(0)
  expect(
    (
      await captureCli(() =>
        runRunResultSet({ ...base, run: path, assignments: ['metrics.loss=0.2'], unset: [] }),
      )
    ).exitCode,
  ).toBe(0)
  expect(
    (await captureCli(() => runRunUpdate({ ...base, target: path, status: 'FINISHED' }))).exitCode,
  ).toBe(0)
  expect(await table()).toContain('V0001,metrics.loss,,0.2')
  const snapshot = JSON.parse(await fs.readFile(project.path('.memon/index/snapshot.json'), 'utf8'))
  expect(snapshot.runs[path]).toMatchObject({
    status: 'FINISHED',
    owner: id,
    row: { active: true, params: { rate: 0.1 } },
  })
  expect(await fs.readdir(project.path(path))).not.toContain('README.md')

  // Invoke real Commander hooks: direct function calls cannot catch a lock
  // acquired by preAction being acquired again inside a core operation.
  const program = new Command().name('memon')
  program.hook('preAction', async (_parent, command) => {
    await beginCliInvocation({ command, globalProjectRoot: project.root, cwd: project.root })
  })
  program.hook('postAction', finishCliInvocation)
  const experimentCommand = program.command('experiment')
  registerExperimentResultsCommands(experimentCommand, () => base)
  registerExperimentResearchCommands(experimentCommand, () => base)
  const rebuilt = await captureCli(() =>
    program.parseAsync(['experiment', 'results', 'rebuild', id], { from: 'user' }).then(() => {}),
  )
  expect(rebuilt.exitCode).toBe(0)
  expect(await table()).toContain('V0001,metrics.loss,,0.2')
  const prepared = await captureCli(() =>
    program
      .parseAsync(['experiment', 'variant', 'create', id, '--params', '{"rate":0.2}'], {
        from: 'user',
      })
      .then(() => {}),
  )
  expect(prepared.exitCode).toBe(0)
  expect(await table()).toContain('V0002,params.rate,,0.2')
})
