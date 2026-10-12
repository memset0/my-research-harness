import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { emptyExperimentDescription } from '../results/description.js'
import { initializeExperimentResearch } from '../results/research.js'
import type { ExperimentStatus, Status } from '../types.js'
import { projectExperimentLifecycle } from './lifecycle.js'
import {
  buildExperimentBundle,
  nodeMutationFs,
  readDocumentState,
  setExperimentArchived,
  setExperimentStatus,
  writeExperimentReadme,
} from './mutations.js'
import { parseExperimentReadme } from './parse.js'

const NOW = '2026-10-12T09:00:00+08:00'
const EXP = 'E0001-test'
const A = 'logs/a-261012-090000'
const B = 'logs/b-261012-090000'
afterEach(removeTempDirs)
function plan() {
  const doc = emptyExperimentDescription()
  doc.variants = [
    { id: 'V0001', name: 'One', values: {}, runs: [A] },
    { id: 'V0002', name: 'Two', values: {}, runs: [B] },
  ]
  return initializeExperimentResearch(doc, [A, B], NOW, 'Initial')
}
const run = (path: string, status: Status, deprecated = false) => ({ path, status, deprecated })
async function fixture(fs10: boolean) {
  const bundle = buildExperimentBundle({
    id: EXP,
    slug: 'test',
    timestamp: NOW,
    researchVersioned: fs10,
  })
  const project = await createTempProject({
    experiments: { [EXP]: { ...bundle } },
    files: { '.memon/version.json': JSON.stringify({ fs_convention_version: fs10 ? 10 : 9 }) },
  })
  const experiment = { id: EXP, path: project.path('docs/experiments', EXP, 'README.md') }
  const state = await readDocumentState(nodeMutationFs, experiment.path)
  return {
    project,
    experiment,
    state,
    lock: { expectedMtime: state.mtime, expectedHash: state.hash },
  }
}
describe('Experiment lifecycle projection', () => {
  it('derives active execution and completion without changing stored lifecycle', () => {
    const description = plan()
    expect(
      projectExperimentLifecycle('ACTIVE', description, [run(A, 'RUNNING'), run(B, 'FINISHED')]),
    ).toMatchObject({ lifecycle: 'ACTIVE', displayStatus: 'RUNNING', currentRunningRunCount: 1 })
    expect(
      projectExperimentLifecycle('ACTIVE', description, [run(A, 'FINISHED'), run(B, 'FINISHED')])
        .displayStatus,
    ).toBe('COMPLETED')
    for (const state of ['PAUSED', 'ARCHIVED', 'RETIRED'] as const)
      expect(projectExperimentLifecycle(state, description, [run(A, 'RUNNING')])).toMatchObject({
        displayStatus: state,
        runningRunCount: 1,
      })
  })
  it('does not treat pending, interrupted, blocked or empty plans as running/completed', () => {
    for (const state of ['PENDING', 'INTERRUPTED', 'FAILED', 'UNKNOWN'] as const)
      expect(
        projectExperimentLifecycle('ACTIVE', plan(), [run(A, state), run(B, 'FINISHED')])
          .displayStatus,
      ).toBe('ACTIVE')
    const description = plan()
    description.variants = []
    expect(projectExperimentLifecycle('ACTIVE', description, []).displayStatus).toBe('ACTIVE')
    description.variants = [
      { id: 'V0001', name: 'blocked', values: {}, runs: [], status: 'BLOCKED' },
    ]
    expect(projectExperimentLifecycle('ACTIVE', description, []).displayStatus).toBe('ACTIVE')
  })
  it('excludes deprecated and dropped Variants and historical Runs but counts all running warnings', () => {
    const description = plan()
    description.variants[1]!.deprecated = true
    expect(
      projectExperimentLifecycle('ACTIVE', description, [run(A, 'FINISHED'), run(B, 'RUNNING')]),
    ).toMatchObject({
      displayStatus: 'COMPLETED',
      requiredVariantCount: 1,
      runningRunCount: 1,
      currentRunningRunCount: 0,
    })
    description.variants[1]!.deprecated = false
    description.variants[1]!.status = 'DROPPED'
    expect(
      projectExperimentLifecycle('ACTIVE', description, [run(A, 'FINISHED'), run(B, 'RUNNING')])
        .displayStatus,
    ).toBe('COMPLETED')
    description.research!.current_version = 2
    expect(projectExperimentLifecycle('ACTIVE', description, [run(A, 'RUNNING')])).toMatchObject({
      displayStatus: 'ACTIVE',
      currentRunningRunCount: 0,
      runningRunCount: 1,
    })
  })
  it('uses current frozen completion but never restores it after advance, keeping legacy unchanged', () => {
    const description = plan()
    description.variants[0]!.runs = []
    description.variants[1]!.runs = []
    for (const variant of description.variants)
      variant.frozen = { status: 'COMPLETED', runs: [], values: [] }
    expect(projectExperimentLifecycle('ACTIVE', description, []).displayStatus).toBe('COMPLETED')
    description.research!.current_version = 2
    for (const variant of description.variants) delete variant.frozen
    expect(projectExperimentLifecycle('ACTIVE', description, []).displayStatus).toBe('ACTIVE')
    expect(projectExperimentLifecycle('OPEN', description, [run(A, 'RUNNING')]).displayStatus).toBe(
      'OPEN',
    )
  })
})
describe('Experiment lifecycle persistence', () => {
  it('rejects contradictory source archive fields even for a status no-op', async () => {
    const { experiment, state } = await fixture(true)
    const invalid = state.content.replace('status: ACTIVE', 'status: ACTIVE\narchived: false')
    await fs.writeFile(experiment.path, invalid)
    const current = await readDocumentState(nodeMutationFs, experiment.path)
    const lock = { expectedMtime: current.mtime, expectedHash: current.hash }
    for (const status of ['ACTIVE', 'PAUSED'] as const)
      await expect(
        setExperimentStatus({ fs: nodeMutationFs, experiment, status, lock }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await fs.readFile(experiment.path, 'utf8')).toBe(invalid)
  })

  it('creates FS10 ACTIVE without archived while preserving FS9 creation', async () => {
    const modern = await fixture(true)
    expect(modern.state.content).toContain('status: ACTIVE')
    expect(modern.state.content).not.toContain('archived:')
    const parsed = parseExperimentReadme(modern.state.content, EXP)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.parseWarnings.some((issue) => issue.field === 'archived')).toBe(false)
    const old = await fixture(false)
    expect(old.state.content).toContain('status: OPEN')
    expect(old.state.content).toContain('archived: false')
  })
  it('maps archive/unarchive to canonical lifecycle and rejects derived or legacy writes', async () => {
    const { experiment, lock } = await fixture(true)
    for (const status of ['OPEN', 'RUNNING', 'COMPLETED'])
      await expect(
        setExperimentStatus({
          fs: nodeMutationFs,
          experiment,
          status: status as ExperimentStatus,
          lock,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const archived = await setExperimentArchived({
      fs: nodeMutationFs,
      experiment,
      archived: true,
      lock,
    })
    expect(archived.content).toContain('status: ARCHIVED')
    expect(archived.content).not.toContain('archived:')
    const active = await setExperimentArchived({
      fs: nodeMutationFs,
      experiment,
      archived: false,
      lock: { expectedMtime: archived.mtime, expectedHash: archived.hash },
    })
    expect(active.content).toContain('status: ACTIVE')
    await expect(
      setExperimentStatus({ fs: nodeMutationFs, experiment, status: 'PAUSED', lock }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it('guards generic README writes and retains legacy status/archive writes', async () => {
    const modern = await fixture(true)
    for (const content of [
      modern.state.content.replace('status: ACTIVE', 'status: RUNNING'),
      modern.state.content.replace('status: ACTIVE', 'status: PAUSED\narchived: false'),
    ])
      await expect(
        writeExperimentReadme({
          fs: nodeMutationFs,
          experiment: modern.experiment,
          content,
          lock: modern.lock,
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const old = await fixture(false)
    await expect(
      setExperimentStatus({
        fs: nodeMutationFs,
        experiment: old.experiment,
        status: 'ACTIVE',
        lock: old.lock,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const changed = await setExperimentStatus({
      fs: nodeMutationFs,
      experiment: old.experiment,
      status: 'RESOLVED',
      lock: old.lock,
    })
    expect(changed.content).toContain('status: RESOLVED')
    expect(changed.content).toContain('archived: false')
  })
})
