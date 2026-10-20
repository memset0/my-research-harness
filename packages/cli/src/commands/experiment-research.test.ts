import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  emptyExperimentDescription,
  initializeExperimentResearch,
  serializeExperimentDescription,
} from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  captureCli,
  makeResultsProject,
  type ResultsProject,
  writeExperiment,
} from '../test-support/results-project.js'
import { runExperimentLink, runExperimentUnlink } from './experiment-doc.js'
import { runResearchMutation, runResearchShow } from './experiment-research.js'
import { runRunRecord } from './run-record.js'

const EXP = 'E0001-example'
const DIR = `docs/experiments/${EXP}`
const RUN = 'logs/example-261001-100000'
describe('research CLI', () => {
  let project: ResultsProject
  const globals = () => ({ projectRoot: project.root, cwd: project.root, format: 'json' as const })
  const input = () => ({ ...globals(), idOrSlug: EXP })
  async function tokens() {
    const shown = await captureCli(() => runResearchShow(input()))
    return {
      expectedMtime: String(shown.json.mtime),
      expectedHash: shown.json.hash,
      reason: 'Correct the comparison protocol',
    }
  }
  beforeEach(async () => {
    project = await makeResultsProject('memon-research-cli-')
    const description = initializeExperimentResearch(
      emptyExperimentDescription(),
      [],
      '2026-10-01T09:00:00+08:00',
      'Initial version',
    )
    description.variants.push({ id: 'V0001', name: 'baseline', values: {}, runs: [] })
    await writeExperiment(project, EXP, {
      runs: {},
      description: serializeExperimentDescription(description),
    })
  })
  afterEach(async () => project.cleanup())

  it('advances with CAS and rejects a stale retry without modifying Runs', async () => {
    const lock = await tokens()
    const first = await captureCli(async () =>
      runResearchMutation(input(), 'advance', { ...lock, expectedVersion: '1' }),
    )
    expect(first.json.currentVersion).toBe(2)
    const before = await project.read(`${DIR}/experiment.json`)
    const retry = await captureCli(async () =>
      runResearchMutation(input(), 'advance', { ...lock, expectedVersion: '1' }),
    )
    expect(retry.exitCode).toBe(9)
    expect(await project.read(`${DIR}/experiment.json`)).toBe(before)
  })
  it('deprecates and restores with retained audit history and unchanged lifecycle', async () => {
    const deprecated = await captureCli(async () =>
      runResearchMutation(input(), 'deprecate', { ...(await tokens()), variant: 'V0001' }),
    )
    expect(deprecated.exitCode).toBe(0)
    const restored = await captureCli(async () =>
      runResearchMutation(input(), 'restore', { ...(await tokens()), variant: 'V0001' }),
    )
    expect(restored.exitCode).toBe(0)
    const json = JSON.parse(await project.read(`${DIR}/experiment.json`))
    expect(json.variants.V0001.deprecated).toBe(false)
    expect(json.variants.V0001.deprecation_history).toHaveLength(1)
    expect(json.research.current_version).toBe(1)
  })
  it('records attribution before membership and keeps it through advance and relink', async () => {
    await fs.mkdir(join(project.root, RUN), { recursive: true })
    const record = await captureCli(() =>
      runRunRecord({
        ...globals(),
        target: join(project.root, RUN),
        experiment: EXP,
        status: 'RUNNING',
      }),
    )
    expect(record.exitCode).toBe(0)
    const runBytes = await project.read(`${RUN}/README.md`)
    await captureCli(async () =>
      runResearchMutation(input(), 'advance', { ...(await tokens()), expectedVersion: '1' }),
    )
    const bind = { ...globals(), experimentIdOrSlug: EXP, runIdOrDir: RUN }
    expect((await captureCli(() => runExperimentUnlink(bind))).exitCode).toBe(0)
    expect((await captureCli(() => runExperimentLink(bind))).exitCode).toBe(0)
    expect(
      JSON.parse(await project.read(`${DIR}/experiment.json`)).research.run_versions[RUN],
    ).toBe(1)
    expect(await project.read(`${RUN}/README.md`)).toBe(runBytes)
  })
  it('requires historical enrollment for an existing Run and rejects promotion', async () => {
    await fs.mkdir(join(project.root, RUN), { recursive: true })
    await captureCli(() =>
      runRunRecord({ ...globals(), target: join(project.root, RUN), status: 'FINISHED' }),
    )
    const bind = { ...globals(), experimentIdOrSlug: EXP, runIdOrDir: RUN }
    expect((await captureCli(() => runExperimentLink(bind))).exitCode).not.toBe(0)
    await captureCli(async () =>
      runResearchMutation(input(), 'advance', { ...(await tokens()), expectedVersion: '1' }),
    )
    expect(
      (
        await captureCli(async () =>
          runResearchMutation(input(), 'import', { ...(await tokens()), run: RUN, version: '2' }),
        )
      ).exitCode,
    ).not.toBe(0)
    expect(
      (
        await captureCli(async () =>
          runResearchMutation(input(), 'import', {
            ...(await tokens()),
            run: RUN,
            version: '1',
            variant: 'V0001',
          }),
        )
      ).exitCode,
    ).toBe(0)
    const json = JSON.parse(await project.read(`${DIR}/experiment.json`))
    expect(json.research.run_versions[RUN]).toBe(1)
    expect(json.research.versions[0].snapshot.variants.V0001.runs).toContain(RUN)
  })
  it('keeps legacy reads and explicitly rejects new research operations', async () => {
    await project.write(
      `${DIR}/experiment.json`,
      serializeExperimentDescription(emptyExperimentDescription()),
    )
    const shown = await captureCli(() => runResearchShow(input()))
    expect(shown.json.mode).toBe('legacy-fs9')
    const advance = await captureCli(async () =>
      runResearchMutation(input(), 'advance', { ...(await tokens()), expectedVersion: '1' }),
    )
    expect(advance.error?.message).toContain('FS10_MIGRATION_REQUIRED')
    expect(Array.isArray(JSON.parse(await project.read(`${DIR}/experiment.json`)).variants)).toBe(
      true,
    )
  })
})
