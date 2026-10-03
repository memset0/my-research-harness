import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  captureCli,
  makeResultsProject,
  type ResultsProject,
  resultCsv,
  writeExperiment,
} from '../test-support/results-project.js'
import {
  runExperimentResults,
  runExperimentResultsAnnotationGet,
  runExperimentResultsAnnotationSet,
  runExperimentResultsRebuild,
  runExperimentResultsSummary,
} from './experiment-results.js'
import { registerExperimentResultsCommands } from './results-commands.js'

const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-100000'
const C = 'logs/c-260901-110000'
const D = 'logs/d-260901-120000'
const E = 'logs/e-260901-130000'
const EXP = 'E0001-foo'

function description(version = 1) {
  return {
    experiment_schema_version: version,
    groups: { 'metrics.eval': { label: 'Evaluation' } },
    columns: [
      {
        path: 'params.precision',
        label: 'Precision',
        type: 'enum',
        options: ['fp32', 'bf16'],
        description: 'Controls **training precision**.',
        value_descriptions: { bf16: 'Uses **bfloat16** arithmetic.' },
      },
      { path: 'metrics.eval.accuracy', label: 'Accuracy', type: 'number', direction: 'higher' },
      { path: 'metrics.eval.loss', label: 'Loss', type: 'number', direction: 'lower' },
      {
        path: 'metrics.eval.clip',
        label: 'CLIP',
        type: 'stats',
        across: 'sample',
        direction: 'higher',
      },
    ],
    variants: [
      { id: 'V0001', name: 'BF16', values: { 'params.precision': 'bf16' }, runs: [A] },
      { id: 'V0002', name: 'FP32 seeds', values: { 'params.precision': 'fp32' }, runs: [B, C, D] },
      { id: 'V0003', name: 'Broken', runs: [E] },
      {
        id: 'V0004',
        name: 'Child',
        status: 'BLOCKED',
        description: 'Waits for the V0001 checkpoint.',
        runs: [],
      },
      {
        id: 'V0005',
        name: 'Planned',
        status: 'PLANNED',
        values: { 'params.precision': 'bf16' },
        runs: [],
      },
    ],
  }
}

async function seed(project: ResultsProject, version = 1, id = EXP) {
  await writeExperiment(project, id, {
    runs: { [A]: 'FINISHED', [B]: 'FINISHED', [C]: 'FINISHED', [D]: 'FINISHED', [E]: 'FAILED' },
    description: description(version),
  })
  await project.write(
    `${A}/result.csv`,
    resultCsv(version, [
      ['params.precision', '', 'bf16'],
      ['metrics.eval.accuracy', '', '0.95'],
      ['metrics.eval.loss', '', '0.125'],
      ['metrics.eval.clip', 'mean', '0.312'],
      ['metrics.eval.clip', 'std', '0.021'],
      ['metrics.eval.clip', 'n', '500'],
    ]),
  )
  for (const [index, run] of [B, C, D].entries())
    await project.write(
      `${run}/result.csv`,
      resultCsv(version, [
        ['params.precision', '', 'fp32'],
        ['params.seed', '', String(index)],
        ['metrics.eval.accuracy', '', String(10 + index)],
      ]),
    )
}

describe('memon experiment results (FS v9)', () => {
  let project: ResultsProject
  const base = () => ({ projectRoot: project.root, cwd: project.root, format: 'json' as const })
  const table = (extra: Partial<Parameters<typeof runExperimentResults>[0]> = {}) =>
    captureCli(() =>
      runExperimentResults({
        ...base(),
        idOrSlug: EXP,
        columnGroup: 'all',
        output: 'json',
        ...extra,
      }),
    )

  beforeEach(async () => {
    project = await makeResultsProject()
  })
  afterEach(async () => {
    await project.cleanup()
  })

  it('returns every declared Variant with derived statuses, evidence and values', async () => {
    await seed(project)
    const out = await table()
    expect(out.exitCode).toBe(0)
    expect(out.json.experimentId).toBe(EXP)
    expect(out.json.experimentSchemaVersion).toBe(1)
    expect(out.json.rows).toHaveLength(5)
    for (const row of out.json.rows)
      for (const key of [
        'variantId',
        'variantName',
        'status',
        'declaredStatus',
        'runs',
        'attempts',
        'values',
        'frozen',
      ])
        expect(row).toHaveProperty(key)
    expect(out.json.columns.map((column: { path: string }) => column.path)).toEqual([
      'params.precision',
      'params.seed',
      'metrics.eval.accuracy',
      'metrics.eval.loss',
      'metrics.eval.clip',
    ])
    expect(out.json.columns[0]).toMatchObject({
      description: 'Controls **training precision**.',
      valueDescriptions: { bf16: 'Uses **bfloat16** arithmetic.' },
    })
    expect(out.json.columns[1]).toMatchObject({ path: 'params.seed', declared: false })
    const [v1, v2, v3, v4, v5] = out.json.rows
    expect(v1).toMatchObject({
      variantId: 'V0001',
      status: 'COMPLETED',
      runs: [A],
      attempts: [],
      values: {
        'params.precision': 'bf16',
        'metrics.eval.accuracy': 0.95,
        'metrics.eval.clip': { across: 'sample', stats: { mean: 0.312, std: 0.021, n: 500 } },
      },
    })
    expect(v2.status).toBe('COMPLETED')
    expect(v2.values['params.precision']).toBe('fp32')
    expect(v2.values['params.seed']).toMatchObject({ mixed: expect.any(Array) })
    expect(v2.values['metrics.eval.accuracy']).toMatchObject({
      over: 'run',
      stats: { mean: 11, std: 1, min: 10, max: 12, n: 3 },
    })
    expect(v3).toMatchObject({
      status: 'FAILED',
      runs: [],
      attempts: [{ run: E, status: 'FAILED', deprecated: false }],
    })
    expect(v4).toMatchObject({ status: 'BLOCKED', declaredStatus: 'BLOCKED' })
    expect(v5).toMatchObject({
      status: 'PLANNED',
      values: { 'params.precision': 'bf16' },
    })
    expect(out.json.meta).toMatchObject({ totalVariants: 5, filteredVariants: 5 })
    expect(await project.exists(`.memon/index/results/${EXP}.json`)).toBe(true)
  })

  it('filters by --variant, --status (case-insensitive), --group and --column prefix', async () => {
    await seed(project)
    const variants = await table({ variants: 'V0001,V0003' })
    expect(variants.json.rows.map((row: { variantId: string }) => row.variantId)).toEqual([
      'V0001',
      'V0003',
    ])
    expect(variants.json.meta.filters.variants).toEqual(['V0001', 'V0003'])

    const blocked = await table({ statuses: 'blocked' })
    expect(blocked.json.rows.map((row: { variantId: string }) => row.variantId)).toEqual(['V0004'])
    expect(blocked.json.rows[0].status).toBe('BLOCKED')
    expect(blocked.json.meta.filters.statuses).toEqual(['blocked'])

    const metric = await table({ columnGroup: 'metric' })
    expect(
      metric.json.columns.every((column: { path: string }) => column.path.startsWith('metrics.')),
    ).toBe(true)
    expect(metric.json.meta.filters.columnGroup).toBe('metric')

    const prefix = await table({ columns: 'metrics.eval' })
    expect(prefix.json.columns).toHaveLength(3)

    const empty = await table({ variants: 'V9999' })
    expect(empty.exitCode).toBe(0)
    expect(empty.json.rows).toEqual([])
    expect(empty.json.meta.filteredVariants).toBe(0)
  })

  it('emits RFC 4180 CSV and flattens statistics into path:stat columns', async () => {
    await seed(project)
    const plain = await table({
      variants: 'V0001',
      columns: 'params.precision,metrics.eval.accuracy,metrics.eval.loss',
      output: 'csv',
    })
    expect(plain.stdout.trim().split('\n')).toEqual([
      'variant_id,variant_name,status,params.precision,metrics.eval.accuracy,metrics.eval.loss,runs_count,attempts_count',
      'V0001,BF16,COMPLETED,bf16,0.95,0.125,1,0',
    ])

    const stats = await table({ variants: 'V0001', columns: 'metrics.eval.clip', output: 'csv' })
    expect(stats.stdout.trim().split('\n')).toEqual([
      'variant_id,variant_name,status,metrics.eval.clip:mean,metrics.eval.clip:std,metrics.eval.clip:n,runs_count,attempts_count',
      'V0001,BF16,COMPLETED,0.312,0.021,500,1,0',
    ])

    const seeds = await table({
      variants: 'V0002',
      columns: 'metrics.eval.accuracy',
      output: 'csv',
    })
    const [header, row] = seeds.stdout.trim().split('\n')
    const cells = Object.fromEntries(
      header!.split(',').map((name, index) => [name, row!.split(',')[index]]),
    )
    expect(cells).toMatchObject({
      'metrics.eval.accuracy': '',
      'metrics.eval.accuracy:mean': '11',
      'metrics.eval.accuracy:std': '1',
      'metrics.eval.accuracy:n': '3',
      runs_count: '3',
    })
  })

  it('renders human, markdown and yaml projections of the same table', async () => {
    await seed(project)
    const human = await table({ output: 'human' })
    expect(human.stdout).toContain(`experiment: ${EXP}`)
    expect(human.stdout).toContain('V0001 BF16')
    expect(human.stdout).toContain('COMPLETED')
    expect(human.stdout).toContain('0.95')
    expect(human.stdout).toContain('11 ± 1 (3)')
    expect(human.stdout).toContain('Column annotations:')

    const markdown = await table({ output: 'markdown', variants: 'V0001' })
    const lines = markdown.stdout.split('\n')
    const head = lines.findIndex((line) => line.startsWith('| Variant ID |'))
    expect(head).toBeGreaterThanOrEqual(0)
    expect(lines[head + 1]).toMatch(/^\| --- \|/)
    expect(lines[head + 2]).toContain('**V0001**')

    const yaml = await table({ output: 'yaml', variants: 'V0004' })
    expect(yaml.json.rows).toHaveLength(1)
    expect(yaml.json.rows[0].variantId).toBe('V0004')
  })

  it('regenerates a deleted summary with the same answer', async () => {
    await seed(project)
    const first = await table()
    await fs.rm(join(project.root, '.memon/index/results', `${EXP}.json`))
    const second = await table()
    expect(second.json).toEqual(first.json)
    expect(await project.exists(`.memon/index/results/${EXP}.json`)).toBe(true)
  })

  it('fails with NOT_FOUND naming experiment.json and the migration for an FS v8 bundle', async () => {
    await seed(project)
    await fs.rm(join(project.root, 'docs/experiments', EXP, 'experiment.json'))
    await project.write(`docs/experiments/${EXP}/results.yaml`, 'not: valid: yaml: [')
    const out = await table()
    expect(out.exitCode).toBe(4)
    expect(out.stdout).toBe('')
    expect(out.error?.code).toBe('NOT_FOUND')
    expect(out.error?.message).toContain('experiment.json')
    expect(out.error?.message).toContain('v8-to-v9')
    expect(out.error?.details).toMatchObject({ legacyResultsYaml: true })
    expect(out.error?.details.diagnostics[0].code).toBe('LEGACY_RESULTS_YAML')
  })

  it('fails with RESULT_SCHEMA_MISMATCH listing files and the upgrade command, no rows', async () => {
    await seed(project, 2)
    await project.write(`${B}/result.csv`, resultCsv(1, [['metrics.eval.accuracy', '', '10']]))
    const out = await table()
    expect(out.exitCode).toBe(1)
    expect(out.stdout).toBe('')
    expect(out.error?.code).toBe('RESULT_SCHEMA_MISMATCH')
    expect(out.error?.details.files).toEqual([{ path: `${B}/result.csv`, version: 1 }])
    expect(out.error?.details.upgradeCommand).toBe(`memon experiment schema upgrade ${EXP} --to 2`)
  })

  it('fails with RESULT_DUPLICATE_ROW naming the file and both lines', async () => {
    await seed(project)
    await project.write(
      `${A}/result.csv`,
      resultCsv(1, [
        ['metrics.eval.accuracy', '', '0.9'],
        ['metrics.eval.accuracy', '', '0.95'],
      ]),
    )
    const out = await table()
    expect(out.exitCode).toBe(1)
    expect(out.error?.code).toBe('RESULT_DUPLICATE_ROW')
    expect(out.error?.details.files[0]).toMatchObject({
      path: `${A}/result.csv`,
      duplicates: [{ path: 'metrics.eval.accuracy', stat: null, lines: [3, 4] }],
    })
  })

  it('fails with INVALID_RESULTS for a malformed experiment.json and NOT_FOUND for an unknown id', async () => {
    await seed(project)
    await project.write(`docs/experiments/${EXP}/experiment.json`, '{ "columns": [')
    const invalid = await table()
    expect(invalid.exitCode).toBe(1)
    expect(invalid.error?.code).toBe('INVALID_RESULTS')
    const missing = await captureCli(() =>
      runExperimentResults({
        ...base(),
        idOrSlug: 'E9999-none',
        columnGroup: 'all',
        output: 'json',
      }),
    )
    expect(missing.exitCode).toBe(4)
  })

  it.skipIf(process.getuid?.() === 0)(
    'prints the table and exits 0 with RESULTS_CACHE_FAILED when the cache is read-only',
    async () => {
      await seed(project)
      await project.write('.memon/index/.gitignore', '*\n')
      await fs.mkdir(join(project.root, '.memon/index/results'), { recursive: true })
      await fs.chmod(join(project.root, '.memon/index/results'), 0o500)
      try {
        const out = await table()
        expect(out.exitCode).toBe(0)
        expect(out.json.rows).toHaveLength(5)
        expect(out.json.warnings.map((warning: { code: string }) => warning.code)).toEqual([
          'RESULTS_CACHE_FAILED',
        ])
      } finally {
        await fs.chmod(join(project.root, '.memon/index/results'), 0o700)
      }
    },
  )

  it('summarizes columns, annotations and Variant identities without cell values', async () => {
    await seed(project)
    const out = await captureCli(() =>
      runExperimentResultsSummary({ ...base(), idOrSlug: EXP, output: 'json' }),
    )
    expect(out.exitCode).toBe(0)
    expect(out.json.meta).toEqual({ columnCount: 5, rowCount: 5 })
    expect(out.json.experimentSchemaVersion).toBe(1)
    expect(out.json.columns[0]).toMatchObject({
      path: 'params.precision',
      type: 'enum',
      options: ['fp32', 'bf16'],
      description: 'Controls **training precision**.',
      valueDescriptions: { bf16: 'Uses **bfloat16** arithmetic.' },
    })
    expect(out.json.columns[4]).toMatchObject({ path: 'metrics.eval.clip', across: 'sample' })
    expect(out.json.rows[0]).toEqual({
      id: 'V0001',
      name: 'BF16',
      status: 'COMPLETED',
      declaredStatus: null,
    })
    for (const forbidden of ['0.95', A, '"values"', '"runs"', '"attempts"', '"provenance"'])
      expect(out.stdout).not.toContain(forbidden)
  })

  it('still describes the declared shape when the summary fails, and exits 1', async () => {
    await seed(project, 2)
    await project.write(`${C}/result.csv`, resultCsv(1, [['metrics.eval.accuracy', '', '11']]))
    const out = await captureCli(() =>
      runExperimentResultsSummary({ ...base(), idOrSlug: EXP, output: 'json' }),
    )
    expect(out.exitCode).toBe(1)
    expect(out.json.columns).toHaveLength(4)
    expect(
      out.json.rows.map((row: { declaredStatus: string | null }) => row.declaredStatus),
    ).toEqual([null, null, null, 'BLOCKED', 'PLANNED'])
    expect(out.json.rows.every((row: { status: unknown }) => row.status === null)).toBe(true)
    expect(out.json.error).toMatchObject({
      code: 'RESULT_SCHEMA_MISMATCH',
      upgradeCommand: `memon experiment schema upgrade ${EXP} --to 2`,
    })
    expect(out.error?.code).toBe('RESULT_SCHEMA_MISMATCH')
  })

  it('adds and replaces annotations in experiment.json, keeping every other key', async () => {
    await seed(project)
    const path = `docs/experiments/${EXP}/experiment.json`
    const document = JSON.parse(await project.read(path))
    document.custom_top = { keep: true }
    document.columns[0].custom_column_key = 'keep'
    await project.write(path, `${JSON.stringify(document, null, 2)}\n`)

    const replaced = await captureCli(() =>
      runExperimentResultsAnnotationSet({
        ...base(),
        idOrSlug: EXP,
        column: 'params.precision',
        value: 'bf16',
        description: 'Replaced **bf16** text.',
      }),
    )
    expect(replaced.json).toMatchObject({ ok: true, replaced: true, changed: true })
    const future = await captureCli(() =>
      runExperimentResultsAnnotationSet({
        ...base(),
        idOrSlug: EXP,
        column: 'params.precision',
        value: 'fp4',
        description: 'A future value not yet in `options`.',
      }),
    )
    expect(future.json).toMatchObject({ ok: true, replaced: false, value: 'fp4' })
    const written = JSON.parse(await project.read(path))
    expect(written.custom_top).toEqual({ keep: true })
    expect(written.columns[0]).toMatchObject({
      custom_column_key: 'keep',
      value_descriptions: {
        bf16: 'Replaced **bf16** text.',
        fp4: 'A future value not yet in `options`.',
      },
    })

    const undeclared = await captureCli(() =>
      runExperimentResultsAnnotationSet({
        ...base(),
        idOrSlug: EXP,
        column: 'params.unknown',
        description: 'x',
      }),
    )
    expect(undeclared.exitCode).toBe(2)

    const got = await captureCli(() =>
      runExperimentResultsAnnotationGet({
        ...base(),
        idOrSlug: EXP,
        column: 'params.precision',
        value: 'fp4',
      }),
    )
    expect(got.json).toEqual({
      experimentId: EXP,
      column: 'params.precision',
      value: 'fp4',
      description: 'A future value not yet in `options`.',
    })
    const all = await captureCli(() =>
      runExperimentResultsAnnotationGet({ ...base(), idOrSlug: EXP }),
    )
    expect(Object.keys(all.json.columnAnnotations)).toEqual(['params.precision'])
  })

  it('rebuilds every summary and reports each failure separately', async () => {
    await seed(project, 1, 'E0001-foo')
    await writeExperiment(project, 'E0002-bar', {
      runs: {},
      description: { experiment_schema_version: 1, groups: {}, columns: [], variants: [] },
    })
    await writeExperiment(project, 'E0003-baz', {
      runs: { 'logs/z-260901-090000': 'FINISHED' },
      description: {
        experiment_schema_version: 2,
        groups: {},
        columns: [],
        variants: [{ id: 'V0001', name: 'z', runs: ['logs/z-260901-090000'] }],
      },
    })
    await project.write('logs/z-260901-090000/result.csv', resultCsv(1, [['metrics.x', '', '1']]))
    const out = await captureCli(() => runExperimentResultsRebuild({ ...base(), all: true }))
    expect(out.exitCode).toBe(1)
    expect(out.json.counts).toEqual({ regenerated: 2, unchanged: 0, failed: 1 })
    const failed = out.json.experiments.find((item: { id: string }) => item.id === 'E0003-baz')
    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'RESULT_SCHEMA_MISMATCH',
        files: [{ path: 'logs/z-260901-090000/result.csv', version: 1 }],
        upgradeCommand: 'memon experiment schema upgrade E0003-baz --to 2',
      },
    })
    expect(await project.exists('.memon/index/results/E0001-foo.json')).toBe(true)
    expect(await project.exists('.memon/index/results/E0002-bar.json')).toBe(true)

    const again = await captureCli(() =>
      runExperimentResultsRebuild({ ...base(), idOrSlug: 'foo', all: false }),
    )
    expect(again.exitCode).toBe(0)
    expect(again.json.experiments).toEqual([{ id: 'E0001-foo', status: 'unchanged' }])

    const neither = await captureCli(() => runExperimentResultsRebuild({ ...base(), all: false }))
    expect(neither.exitCode).toBe(2)
  })

  it('lists the results group and schema upgrade in `memon experiment --help`', () => {
    const program = new Command('memon')
    const experiment = program.command('experiment')
    registerExperimentResultsCommands(experiment, () => ({ format: 'json', cwd: process.cwd() }))
    const help = experiment.helpInformation()
    expect(help).toMatch(/results\s+Results commands: table, summary, rebuild, annotation/)
    expect(help).toMatch(/schema\s+Experiment result-schema commands: upgrade/)
    const results = experiment.commands.find((command) => command.name() === 'results')!
    expect(results.commands.map((command) => command.name())).toEqual([
      'show',
      'table',
      'summary',
      'rebuild',
      'annotation',
    ])
    const schema = experiment.commands.find((command) => command.name() === 'schema')!
    expect(schema.commands.map((command) => command.name())).toEqual(['upgrade'])
  })
})
