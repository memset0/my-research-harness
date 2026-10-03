import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readJournalInvocations } from '@memon/core'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { beginCliInvocation, classifyCliCommand, finishCliInvocation } from '../lib/invocation.js'
import {
  captureCli,
  makeResultsProject,
  type ResultsProject,
  resultCsv,
  runReadme,
  writeExperiment,
} from '../test-support/results-project.js'
import { registerRunResultCommands } from './results-commands.js'
import {
  parseResultAssignment,
  runRunResultGet,
  runRunResultLint,
  runRunResultSet,
} from './run-result.js'

const RUN = 'logs/a-260901-090000'
const EXP = 'E0001-foo'

function description(version = 1) {
  return {
    experiment_schema_version: version,
    groups: {},
    columns: [
      { path: 'params.precision', label: 'Precision', type: 'enum', options: ['fp32', 'bf16'] },
      { path: 'metrics.eval.fid', label: 'FID', type: 'number', direction: 'lower' },
      { path: 'metrics.eval.clip', label: 'CLIP', type: 'stats', across: 'sample' },
      {
        path: 'metrics.serve.latency_ms',
        label: 'Latency',
        type: 'stats',
        across: 'request',
        over: 'gpu',
      },
    ],
    variants: [{ id: 'V0001', name: 'baseline', runs: [RUN] }],
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' })

describe('memon run result (FS v9)', () => {
  let project: ResultsProject
  const base = () => ({ projectRoot: project.root, cwd: project.root, format: 'json' as const })
  const set = (assignments: string[], extra: Partial<Parameters<typeof runRunResultSet>[0]> = {}) =>
    captureCli(() => runRunResultSet({ ...base(), run: RUN, assignments, unset: [], ...extra }))

  beforeEach(async () => {
    project = await makeResultsProject('memon-run-result-')
    await writeExperiment(project, EXP, { runs: { [RUN]: 'FINISHED' }, description: description() })
  })
  afterEach(async () => {
    await project.cleanup()
  })

  it('parses path[:stat]=value assignments at the first "=" and ":"', () => {
    expect(parseResultAssignment('metrics.eval.clip:mean=0.31')).toEqual({
      ok: true,
      value: { path: 'metrics.eval.clip', stat: 'mean', value: '0.31' },
    })
    expect(parseResultAssignment('params.note=a=b:c')).toEqual({
      ok: true,
      value: { path: 'params.note', stat: null, value: 'a=b:c' },
    })
    expect(parseResultAssignment('metrics.notes=')).toMatchObject({ ok: true })
    expect(parseResultAssignment('no-equals').ok).toBe(false)
    expect(parseResultAssignment('metrics.x:=1').ok).toBe(false)
  })

  it('records two statistics as one row each and prints the new hash', async () => {
    const out = await set(['metrics.eval.clip:mean=0.31', 'metrics.eval.clip:std=0.02'])
    expect(out.exitCode).toBe(0)
    const content = await project.read(`${RUN}/result.csv`)
    expect(content).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.clip,mean,0.31\nmetrics.eval.clip,std,0.02\n',
    )
    expect(out.json).toMatchObject({
      ok: true,
      run: RUN,
      file: `${RUN}/result.csv`,
      owner: EXP,
      experimentSchemaVersion: 1,
      created: true,
      changed: true,
      appended: 2,
      hash: sha256(content),
      warnings: [],
    })
  })

  it('upserts in place, keeps unrelated rows byte-identical, unsets pairs and reads --from', async () => {
    await project.write(
      `${RUN}/result.csv`,
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,12.3\nmetrics.eval.is,,"a,b"\n',
    )
    const updated = await set(['metrics.eval.fid=11.9'])
    expect(updated.json).toMatchObject({ created: false, replaced: 1, appended: 0 })
    expect(await project.read(`${RUN}/result.csv`)).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,11.9\nmetrics.eval.is,,"a,b"\n',
    )
    const unset = await set([], { unset: ['metrics.eval.is'] })
    expect(unset.json).toMatchObject({ removed: 1 })
    await project.write(
      'input.csv',
      'path,stat,value\n$experiment_schema_version,,1\nparams.precision,,bf16\nmetrics.serve.latency_ms,max.p99,140.2\n',
    )
    const fromFile = await set([], { from: join(project.root, 'input.csv') })
    expect(fromFile.exitCode).toBe(0)
    expect(await project.read(`${RUN}/result.csv`)).toBe(
      'path,stat,value\n$experiment_schema_version,,1\nmetrics.eval.fid,,11.9\nparams.precision,,bf16\nmetrics.serve.latency_ms,max.p99,140.2\n',
    )
    const noop = await set(['metrics.eval.fid=11.9'])
    expect(noop.json).toMatchObject({ changed: false })
  })

  it('writes nothing for an invalid value (BAD_REQUEST naming the path)', async () => {
    const out = await set(['metrics.eval.fid=abc', 'metrics.eval.clip:mean=0.3'])
    expect(out.exitCode).toBe(2)
    expect(out.error?.code).toBe('BAD_REQUEST')
    expect(out.error?.message).toContain('metrics.eval.fid')
    expect(await project.exists(`${RUN}/result.csv`)).toBe(false)
    const enumValue = await set(['params.precision=fp8'])
    expect(enumValue.exitCode).toBe(2)
    const twoLevel = await set(['metrics.serve.latency_ms:max=1'])
    expect(twoLevel.exitCode).toBe(2)
    const duplicate = await set(['metrics.eval.fid=1', 'metrics.eval.fid=2'])
    expect(duplicate.exitCode).toBe(2)
    expect(await project.exists(`${RUN}/result.csv`)).toBe(false)
  })

  it('refuses an orphan Run with BAD_STATE naming experiment link, creating nothing', async () => {
    const orphan = 'logs/orphan-260901-100000'
    await project.write(`${orphan}/README.md`, runReadme(orphan, 'FINISHED'))
    const out = await captureCli(() =>
      runRunResultSet({ ...base(), run: orphan, assignments: ['metrics.x=1'], unset: [] }),
    )
    expect(out.exitCode).toBe(1)
    expect(out.error?.code).toBe('BAD_STATE')
    expect(out.error?.message).toContain('memon experiment link')
    expect(await project.exists(`${orphan}/result.csv`)).toBe(false)
  })

  it('refuses a stale file version with RESULT_SCHEMA_MISMATCH and the upgrade command', async () => {
    await project.write(
      `docs/experiments/${EXP}/experiment.json`,
      `${JSON.stringify(description(2), null, 2)}\n`,
    )
    const before = resultCsv(1, [['metrics.eval.fid', '', '12.3']])
    await project.write(`${RUN}/result.csv`, before)
    const out = await set(['metrics.eval.fid=11'])
    expect(out.exitCode).toBe(1)
    expect(out.error?.code).toBe('RESULT_SCHEMA_MISMATCH')
    expect(out.error?.details.upgradeCommand).toBe(`memon experiment schema upgrade ${EXP} --to 2`)
    expect(await project.read(`${RUN}/result.csv`)).toBe(before)
  })

  it('refuses a stale --expected-hash with CONFLICT (exit 9)', async () => {
    const before = resultCsv(1, [['metrics.eval.fid', '', '12.3']])
    await project.write(`${RUN}/result.csv`, before)
    const out = await set(['metrics.eval.fid=11'], { expectedHash: sha256('something else') })
    expect(out.exitCode).toBe(9)
    expect(out.error?.code).toBe('CONFLICT')
    expect(await project.read(`${RUN}/result.csv`)).toBe(before)
    const fresh = await set(['metrics.eval.fid=11'], { expectedHash: sha256(before) })
    expect(fresh.exitCode).toBe(0)
  })

  it('writes an ignored new file in Git with RESULT_FILE_IGNORED and leaves .gitignore unchanged', async () => {
    const gitignore = 'logs/*/*\n!logs/*/README.md\n'
    await project.write('.gitignore', gitignore)
    git(project.root, 'init', '-q', '-b', 'main')
    const out = await set(['metrics.eval.fid=12.3'])
    expect(out.exitCode).toBe(0)
    expect(await project.exists(`${RUN}/result.csv`)).toBe(true)
    expect(out.json.warnings).toHaveLength(1)
    const warning = out.json.warnings[0]
    expect(warning.code).toBe('RESULT_FILE_IGNORED')
    expect(warning.details.rule).toBe('.gitignore:1:logs/*/*')
    expect(warning.details.target).toBe('.gitignore')
    expect(warning.details.lines).toContain('!/logs/*/result.csv')
    expect(warning.details.command).toContain('!/logs/*/result.csv')
    expect(warning.details.command).toContain(">> '.gitignore'")
    expect(out.stderr).toContain('RESULT_FILE_IGNORED')
    expect(await project.read('.gitignore')).toBe(gitignore)

    const lint = await captureCli(() => runRunResultLint({ ...base(), run: RUN }))
    expect(lint.exitCode).toBe(0)
    expect(lint.json.diagnostics.map((item: { code: string }) => item.code)).toEqual([
      'RESULT_FILE_IGNORED',
    ])
    expect(await project.read('.gitignore')).toBe(gitignore)
  })

  it('makes no ignore check outside a Git work tree', async () => {
    await project.write('.gitignore', 'logs/*/*\n')
    const out = await set(['metrics.eval.fid=12.3'], {})
    expect(out.exitCode).toBe(0)
    expect(out.json.warnings).toEqual([])
  })

  it('get prints reserved rows separately and filters by path; lint reports type errors', async () => {
    await project.write(
      `${RUN}/result.csv`,
      resultCsv(1, [
        ['metrics.eval.fid', '', 'abc'],
        ['metrics.eval.clip', 'mean', '0.3'],
        ['metrics.eval.clip', 'median', '0.3'],
      ]),
    )
    const got = await captureCli(() =>
      runRunResultGet({ ...base(), run: RUN, path: 'metrics.eval.clip' }),
    )
    expect(got.json).toMatchObject({
      run: RUN,
      exists: true,
      experimentSchemaVersion: 1,
      reserved: [{ line: 2, path: '$experiment_schema_version', stat: null, value: '1' }],
      rows: [
        { line: 4, path: 'metrics.eval.clip', stat: 'mean', value: '0.3' },
        { line: 5, path: 'metrics.eval.clip', stat: 'median', value: '0.3' },
      ],
    })
    const lint = await captureCli(() => runRunResultLint({ ...base(), run: RUN }))
    expect(lint.exitCode).toBe(1)
    const codes = lint.json.diagnostics.map((item: { code: string }) => item.code)
    expect(codes).toContain('RESULT_STAT_UNKNOWN')
    expect(codes).toContain('RESULT_VALUE_TYPE_MISMATCH')

    const absent = 'logs/b-260901-100000'
    await project.write(`${absent}/README.md`, runReadme(absent, 'FAILED'))
    const none = await captureCli(() => runRunResultGet({ ...base(), run: absent }))
    expect(none.json).toMatchObject({ exists: false, rows: [], diagnostics: [] })
    const clean = await captureCli(() => runRunResultLint({ ...base(), run: absent }))
    expect(clean.exitCode).toBe(0)
  })

  it('lint reports a version mismatch with the upgrade command', async () => {
    await project.write(
      `docs/experiments/${EXP}/experiment.json`,
      `${JSON.stringify(description(2), null, 2)}\n`,
    )
    await project.write(`${RUN}/result.csv`, resultCsv(1, [['metrics.eval.fid', '', '1']]))
    const lint = await captureCli(() => runRunResultLint({ ...base(), run: RUN }))
    expect(lint.exitCode).toBe(1)
    expect(lint.json.diagnostics[0]).toMatchObject({ code: 'RESULT_SCHEMA_MISMATCH' })
    expect(lint.json.diagnostics[0].message).toContain(
      `memon experiment schema upgrade ${EXP} --to 2`,
    )
  })

  it('records a receipt for set through the CLI hooks, and none for get or lint', async () => {
    const program = new Command()
    program.name('memon').exitOverride()
    program.hook('preAction', async (_command, action) => {
      await beginCliInvocation({
        command: action,
        globalProjectRoot: project.root,
        cwd: project.root,
      })
    })
    program.hook('postAction', async () => {
      await finishCliInvocation()
    })
    registerRunResultCommands(program.command('run'), () => ({
      projectRoot: project.root,
      format: 'json',
      cwd: project.root,
    }))
    const parse = (...argv: string[]) =>
      captureCli(() => program.parseAsync(['node', 'memon', 'run', 'result', ...argv]))
    expect((await parse('set', RUN, 'metrics.eval.fid=12.3')).exitCode).toBe(0)
    expect((await parse('get', RUN)).json.rows).toHaveLength(1)
    expect((await parse('lint', RUN)).exitCode).toBe(0)
    const records = await readJournalInvocations(project.root)
    expect(records.map((record) => [record.command, record.outcome])).toEqual([
      ['run result set', 'success'],
    ])
  })

  it('journals set but never get or lint', () => {
    expect(classifyCliCommand('run result set', {})).toBe('project')
    expect(classifyCliCommand('run result get', {})).toBe('readonly')
    expect(classifyCliCommand('run result lint', {})).toBe('readonly')
    expect(classifyCliCommand('experiment results rebuild', {})).toBe('readonly')
    expect(classifyCliCommand('experiment schema upgrade', {})).toBe('readonly')
    expect(classifyCliCommand('experiment schema upgrade', { apply: true })).toBe('project')
  })

  it('accepts a unique Run ID as the target', async () => {
    const out = await captureCli(() =>
      runRunResultSet({
        ...base(),
        run: 'a-260901-090000',
        assignments: ['metrics.eval.fid=1'],
        unset: [],
      }),
    )
    expect(out.exitCode).toBe(0)
    expect(out.json.run).toBe(RUN)
    const missing = await captureCli(() =>
      runRunResultGet({ ...base(), run: 'logs/none-260101-000000' }),
    )
    expect(missing.exitCode).toBe(4)
    await fs.rm(join(project.root, RUN, 'result.csv'))
  })
})
