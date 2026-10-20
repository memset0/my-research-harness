import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  captureCli,
  makeResultsProject,
  type ResultsProject,
  resultCsv,
  writeExperiment,
} from '../test-support/results-project.js'
import { runExperimentResults } from './experiment-results.js'
import { runExperimentSchemaUpgrade } from './experiment-schema.js'

const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-100000'
const EXP = 'E0001-foo'
const FOLDER = `docs/experiments/${EXP}`

function description(version: number, fidPath = 'metrics.fid') {
  return {
    experiment_schema_version: version,
    groups: {},
    columns: [{ path: fidPath, label: 'FID', type: 'number', direction: 'lower' }],
    variants: [{ id: 'V0001', name: 'seeds', runs: [A, B] }],
  }
}

const RENAME = `${JSON.stringify({
  from: 1,
  to: 2,
  operations: [{ op: 'rename', from: 'metrics.fid', to: 'metrics.eval.fid' }],
})}\n`

async function snapshot(project: ResultsProject): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const rel of [`${FOLDER}/experiment.json`, `${A}/result.csv`, `${B}/result.csv`])
    out[rel] = await project.read(rel)
  return out
}

describe('memon experiment schema upgrade', () => {
  let project: ResultsProject
  const upgrade = (to: string, apply: boolean) =>
    captureCli(() =>
      runExperimentSchemaUpgrade({
        projectRoot: project.root,
        cwd: project.root,
        format: 'json',
        idOrSlug: EXP,
        to,
        apply,
      }),
    )

  beforeEach(async () => {
    project = await makeResultsProject('memon-schema-cli-')
  })
  afterEach(async () => {
    await project.cleanup()
  })

  async function seed(options: { descriptionVersion?: number; status?: string } = {}) {
    const version = options.descriptionVersion ?? 1
    await writeExperiment(project, EXP, {
      runs: { [A]: options.status ?? 'FINISHED', [B]: 'FINISHED' },
      description: description(version, version === 1 ? 'metrics.fid' : 'metrics.eval.fid'),
    })
    await project.write(`${A}/result.csv`, resultCsv(1, [['metrics.fid', '', '12']]))
    await project.write(`${B}/result.csv`, resultCsv(1, [['metrics.fid', '', '11']]))
    await project.write(`${FOLDER}/schema-upgrades/1-to-2.json`, RENAME)
  }

  it('lists every file with its row differences in a dry run and writes nothing', async () => {
    await seed()
    const before = await snapshot(project)
    const out = await upgrade('2', false)
    expect(out.exitCode).toBe(0)
    expect(out.json).toMatchObject({ ok: true, applied: false, experimentId: EXP, to: 2 })
    expect(out.json.changed).toEqual([
      `${FOLDER}/experiment.json`,
      `${A}/result.csv`,
      `${B}/result.csv`,
    ])
    const fileA = out.json.files.find((file: { path: string }) => file.path === `${A}/result.csv`)
    expect(fileA.rows).toEqual([
      {
        change: 'changed',
        path: 'metrics.eval.fid',
        stat: null,
        before: 'metrics.fid=12',
        after: 'metrics.eval.fid=12',
      },
    ])
    expect(await snapshot(project)).toEqual(before)
    expect(await project.exists('.memon/backups')).toBe(false)
  })

  it('applies with a backup, after which every file records the new version', async () => {
    await seed()
    const out = await upgrade('2', true)
    expect(out.exitCode).toBe(0)
    expect(out.json).toMatchObject({ ok: true, applied: true, status: 'applied', to: 2 })
    expect(out.json.backup).toMatch(/^\.memon\/backups\/schema-upgrade\/E0001-foo-1-to-2-/)
    expect(await project.read(`${A}/result.csv`)).toBe(
      resultCsv(2, [['metrics.eval.fid', '', '12']]),
    )
    expect(JSON.parse(await project.read(`${FOLDER}/experiment.json`))).toMatchObject({
      experiment_schema_version: 2,
      columns: [{ path: 'metrics.eval.fid' }],
    })
    expect(await project.read('.memon/backups/.gitignore')).toBe('*\n')
    const again = await upgrade('2', true)
    expect(again.json).toMatchObject({ applied: false, status: 'unchanged', changed: [] })
  })

  it('unblocks a summary that failed because the description file was raised', async () => {
    await seed({ descriptionVersion: 2 })
    const table = () =>
      captureCli(() =>
        runExperimentResults({
          projectRoot: project.root,
          cwd: project.root,
          format: 'json',
          idOrSlug: EXP,
          columnGroup: 'all',
          output: 'json',
        }),
      )
    const blocked = await table()
    expect(blocked.error?.code).toBe('RESULT_SCHEMA_MISMATCH')
    expect(blocked.error?.details.upgradeCommand).toBe(
      `memon experiment schema upgrade ${EXP} --to 2`,
    )
    const out = await upgrade('2', true)
    expect(out.exitCode).toBe(0)
    expect(out.json.changed).toEqual([`${A}/result.csv`, `${B}/result.csv`])
    const fixed = await table()
    expect(fixed.exitCode).toBe(0)
    expect(fixed.json.rows[0].values['metrics.eval.fid']).toMatchObject({
      stats: { mean: 11.5, n: 2 },
    })
  })

  it('names a missing step with BAD_REQUEST and changes nothing', async () => {
    await seed()
    await fs.rm(join(project.root, FOLDER, 'schema-upgrades/1-to-2.json'))
    await project.write(
      `${FOLDER}/schema-upgrades/2-to-3.json`,
      `${JSON.stringify({ from: 2, to: 3, operations: [] })}\n`,
    )
    const before = await snapshot(project)
    const out = await upgrade('3', true)
    expect(out.exitCode).toBe(2)
    expect(out.error?.code).toBe('BAD_REQUEST')
    expect(out.error?.message).toContain('1-to-2')
    expect(await snapshot(project)).toEqual(before)
    const bad = await upgrade('two', false)
    expect(bad.exitCode).toBe(2)
  })

  it('refuses to apply while a member Run is RUNNING', async () => {
    await seed({ status: 'RUNNING' })
    const before = await snapshot(project)
    const out = await upgrade('2', true)
    expect(out.exitCode).toBe(1)
    expect(out.error?.code).toBe('BAD_STATE')
    expect(out.error?.message).toContain(A)
    expect(await snapshot(project)).toEqual(before)
  })

  it('rolls every file back byte-for-byte when verification fails', async () => {
    await seed()
    await project.write(
      `${A}/result.csv`,
      resultCsv(1, [
        ['metrics.fid', '', '12'],
        ['metrics.eval.fid', '', '99'],
      ]),
    )
    const before = await snapshot(project)
    const dry = await upgrade('2', false)
    expect(dry.json.problems).toEqual([
      expect.stringContaining(`${A}/result.csv: duplicate (metrics.eval.fid`),
    ])
    const out = await upgrade('2', true)
    expect(out.exitCode).toBe(1)
    expect(out.error?.message).toContain(`${A}/result.csv`)
    expect(out.error?.details.reason).toBe('SCHEMA_UPGRADE_VERIFY_FAILED')
    expect(await snapshot(project)).toEqual(before)
  })
})
