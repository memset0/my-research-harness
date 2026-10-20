import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readExperimentDoc } from '../experiments/discover.js'
import { buildLightweightExperimentBundle } from '../experiments/mutations.js'
import { buildExperimentDocumentView } from '../experiments/view.js'
import { parseExperimentDescription, serializeExperimentDescription } from './description.js'
import { generateLightweightResultsSummary, serializeExperimentResults } from './lightweight.js'
import {
  aggregateLightweightExperiment,
  createLightweightVariant,
} from './lightweight-aggregate.js'
import { initializeExperimentResearch } from './research.js'
import { planSchemaUpgrade } from './schema-upgrade.js'
import { loadResultsSummary } from './summary-cache.js'
import { writeRunResult } from './writer.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})
const ID = 'E0001-study'
const EXP = `docs/experiments/${ID}`
const time = '2026-10-19T12:00:00+08:00'
const columns = [
  { path: 'metrics.loss', label: 'Loss', type: 'number' },
  { path: 'run.status', label: 'Execution', type: 'string' },
]
const declaration = (variants: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'lightweight', columns, variants, ...extra })
const run = (id: string, status = 'FINISHED', value = '0.2', active = true) => ({
  'run.json': JSON.stringify({
    id,
    status,
    active,
    created_at: time,
    wandb: 'https://example.com/run',
  }),
  'result.csv': `path,stat,value\nmetrics.loss,,${value}\n`,
})
const summary = (raw: string, csv: string | null) =>
  generateLightweightResultsSummary({
    experimentId: ID,
    experimentDir: EXP,
    description: parseExperimentDescription(raw),
    resultsCsv: csv,
    generatedAt: time,
    generator: { release: '11.0.0', role: 'test' },
  })

describe('lightweight declarations and documents', () => {
  it('roundtrips presentation settings without names, drafts or bindings', () => {
    const raw = declaration({ V0001: { aggregate: 'aggregate_variant.py' } })
    const parsed = parseExperimentDescription(raw)
    expect(parsed.parseErrors).toEqual([])
    expect(JSON.parse(serializeExperimentDescription(parsed.data!))).toEqual({
      format: 'lightweight',
      groups: {},
      columns,
      variants: { V0001: { aggregate: 'aggregate_variant.py' } },
    })
  })
  it('rejects traversing, duplicated selections and accidental legacy evidence', () => {
    for (const variant of [
      { active_runs: ['../x'] },
      { active_runs: ['a', 'a'] },
      { runs: ['a'] },
      { values: { 'metrics.loss': 1 } },
    ])
      expect(parseExperimentDescription(declaration({ V0001: variant })).data).toBeNull()
  })
  it('creates only two files and permits free prose headings', async () => {
    const bundle = buildLightweightExperimentBundle({ id: ID, slug: 'study', timestamp: time })
    expect(Object.keys(bundle)).toEqual(['README.md', 'experiment.json'])
    expect(bundle['README.md']).not.toMatch(/runs:|## |research/)
    bundle['README.md'] += '\n## A question\nUnrestricted text.\n'
    const project = await createTempProject({ experiments: { [ID]: bundle } })
    const experiment = await readExperimentDoc(project.root, 'project-a', ID)
    expect(experiment).not.toBeNull()
    expect(buildExperimentDocumentView(experiment!)).toMatchObject({
      readOnly: false,
      diagnostics: [],
      sections: [
        expect.objectContaining({ heading: 'Overview' }),
        expect.objectContaining({
          heading: 'A question',
          body: 'Unrestricted text.',
          supported: true,
        }),
      ],
    })
  })
  it('prepares a READY Run for the next directory-derived Variant without changing experiment.json', async () => {
    const project = await createTempProject({
      files: { [`${EXP}/experiment.json`]: declaration({}) },
      runs: { 'logs/E0001/V0003/a': run('a') },
    })
    const before = await fs.readFile(project.path(EXP, 'experiment.json'), 'utf8')
    const created = await createLightweightVariant({
      projectRoot: project.root,
      experimentId: ID,
      draft: { rate: 0.2 },
    })
    expect(created.id).toBe('V0004')
    expect(JSON.parse(created.content)).toMatchObject({
      status: 'READY',
      active: true,
      params: { rate: 0.2 },
    })
    expect(await fs.readFile(project.path(EXP, 'experiment.json'), 'utf8')).toBe(before)
  })
  it('does not let legacy version commands add epochs to lightweight Experiments', async () => {
    const bundle = buildLightweightExperimentBundle({ id: ID, slug: 'study', timestamp: time })
    const parsed = parseExperimentDescription(bundle['experiment.json'])
    expect(() => initializeExperimentResearch(parsed.data!, [], time, 'Changed protocol')).toThrow(
      /do not use research versions/,
    )
    const project = await createTempProject({ experiments: { [ID]: bundle } })
    await expect(planSchemaUpgrade(project.root, ID, 2)).rejects.toThrow(
      /do not use result schema versions/,
    )
  })
})

describe('persisted lightweight results', () => {
  it('reads only the two saved files and does not infer a successful execution', async () => {
    const raw = declaration({})
    const csv = 'variant,path,stat,value\nV0001,metrics.loss,,0.2\n'
    const project = await createTempProject({
      files: { [`${EXP}/experiment.json`]: raw, [`${EXP}/results.csv`]: csv },
    })
    const spy = vi.spyOn(fs, 'readFile')
    const loaded = await loadResultsSummary(project.root, ID, { fs })
    expect(loaded?.summary.variants[0]).toMatchObject({
      status: 'PLANNED',
      cells: { 'metrics.loss': { value: 0.2 } },
    })
    expect(spy.mock.calls.map((call) => String(call[0]))).toEqual([
      project.path(EXP, 'experiment.json'),
      project.path('.memon/index/results', `${ID}.publication-error.txt`),
      project.path(EXP, 'results.csv'),
    ])
  })
  it('preserves quoted values and statistic rows without extra metadata', () => {
    const raw = declaration(
      {},
      {
        columns: [
          { path: 'metrics.score', label: 'Score', type: 'stats', across: 'seed' },
          { path: 'params.label', label: 'Label', type: 'string' },
        ],
      },
    )
    const csv = serializeExperimentResults([
      { variant: 'V0001', path: 'metrics.score', stat: 'mean', value: '2.5' },
      { variant: 'V0001', path: 'metrics.score', stat: 'std', value: '0.5' },
      { variant: 'V0001', path: 'params.label', value: 'a,"b"\nc' },
    ])
    const result = summary(raw, csv)
    expect(result.outcome).toBe('ok')
    expect(result.variants[0]?.cells['metrics.score']).toMatchObject({
      kind: 'stats',
      values: { mean: 2.5, std: 0.5 },
    })
    expect(result.variants[0]?.cells['params.label']).toMatchObject({ value: 'a,"b"\nc' })
    expect(csv).not.toMatch(/generated_at|schema|hash/)
  })
})

describe('explicit Variant aggregation', () => {
  it('includes only selected formal results and explicitly requested metadata', async () => {
    const project = await createTempProject({
      files: {
        [`${EXP}/experiment.json`]: declaration({}),
      },
      runs: {
        'logs/E0001/V0002/a': run('a', 'FINISHED', '999', false),
        'logs/E0001/V0002/b': run('b'),
        'logs/E0001/smoke/s': run('s', 'FAILED', '999'),
      },
    })
    const result = await aggregateLightweightExperiment({
      projectRoot: project.root,
      experimentId: ID,
    })
    expect(result.content).toBe(
      'variant,path,stat,value\nV0002,metrics.loss,,0.2\nV0002,run.status,,FINISHED\n',
    )
    expect(await fs.readFile(project.path(EXP, 'results.csv'), 'utf8')).toBe(result.content)
  })
  it('records queued metadata without requiring a metric file', async () => {
    const project = await createTempProject({
      files: { [`${EXP}/experiment.json`]: declaration({}) },
      runs: { 'logs/E0001/V0001/a': { 'run.json': run('a', 'PENDING')['run.json'] } },
    })
    const result = await aggregateLightweightExperiment({
      projectRoot: project.root,
      experimentId: ID,
    })
    expect(result.content).toBe('variant,path,stat,value\nV0001,run.status,,PENDING\n')
  })
  it('fails multiple selections before replacing an existing result', async () => {
    const project = await createTempProject({
      files: {
        [`${EXP}/experiment.json`]: declaration({}),
        [`${EXP}/results.csv`]: 'prior bytes',
      },
      runs: { 'logs/E0001/V0001/a': run('a'), 'logs/E0001/V0001/b': run('b') },
    })
    await expect(
      aggregateLightweightExperiment({ projectRoot: project.root, experimentId: ID }),
    ).rejects.toThrow(/V0001.*multiple/)
    expect(await fs.readFile(project.path(EXP, 'results.csv'), 'utf8')).toBe('prior bytes')
    expect((await loadResultsSummary(project.root, ID, { fs }))?.summary.outcome).toBe('failed')
  })
  it('runs a per-Variant Python script alongside default Variants', async () => {
    const script =
      'import json,sys\nr=json.load(sys.stdin)\nassert r["variant"]["id"]=="V0001"\nassert len(r["runs"])==2\nprint("path,stat,value\\nmetrics.loss,,0.3")\n'
    const project = await createTempProject({
      files: {
        [`${EXP}/experiment.json`]: declaration({
          V0001: { aggregate: 'aggregate_variant.py' },
          V0002: {},
        }),
        [`${EXP}/aggregate_variant.py`]: script,
      },
      runs: {
        'logs/E0001/V0001/a': run('a'),
        'logs/E0001/V0001/b': run('b', 'FINISHED', '0.4'),
        'logs/E0001/V0002/c': run('c'),
      },
    })
    const result = await aggregateLightweightExperiment({
      projectRoot: project.root,
      experimentId: ID,
    })
    expect(result.content).toContain('V0001,metrics.loss,,0.3\nV0002,metrics.loss,,0.2\n')
    await fs.writeFile(project.path(EXP, 'aggregate_variant.py'), 'raise RuntimeError("broken")\n')
    await expect(
      aggregateLightweightExperiment({ projectRoot: project.root, experimentId: ID }),
    ).rejects.toThrow(/broken/)
    expect(await fs.readFile(project.path(EXP, 'results.csv'), 'utf8')).toBe(result.content)
  })

  it('preserves prior results when custom output is invalid or selected input changes', async () => {
    const project = await createTempProject({
      files: {
        [`${EXP}/experiment.json`]: declaration({
          V0001: { aggregate: 'aggregate_variant.py' },
        }),
        [`${EXP}/results.csv`]: 'prior bytes',
        [`${EXP}/aggregate_variant.py`]: 'print("path,stat,value\\nmetrics.loss,,wrong")\n',
      },
      runs: { 'logs/E0001/V0001/a': run('a') },
    })
    await expect(
      aggregateLightweightExperiment({ projectRoot: project.root, experimentId: ID }),
    ).rejects.toThrow(/invalid custom aggregation/)
    const script =
      'import json,sys,pathlib\nr=json.load(sys.stdin)\npathlib.Path(r["runs"][0]["path"],"result.csv").write_text("path,stat,value\\nmetrics.loss,,1\\n")\nprint("path,stat,value\\nmetrics.loss,,0.3")\n'
    await fs.writeFile(project.path(EXP, 'aggregate_variant.py'), script)
    await expect(
      aggregateLightweightExperiment({ projectRoot: project.root, experimentId: ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await fs.readFile(project.path(EXP, 'results.csv'), 'utf8')).toBe('prior bytes')
  })
  it('gives custom aggregation the same eligible evidence in rows and CSV', async () => {
    const invalid = run('invalid')
    invalid['run.json'] = JSON.stringify({
      ...JSON.parse(invalid['run.json']),
      assessment: { kind: 'INVALID', reason: 'Broken timer' },
    })
    const project = await createTempProject({
      files: {
        [`${EXP}/experiment.json`]: declaration({ V0001: { aggregate: 'aggregate_variant.py' } }),
        [`${EXP}/aggregate_variant.py`]:
          'import json,sys,csv,io\nr=json.load(sys.stdin)\nfor run in r["runs"]:\n assert list(csv.DictReader(io.StringIO(run["result_csv"]))) == run["rows"]\n assert all(not row["path"].startswith("metrics.") for row in run["rows"])\nprint("path,stat,value")\n',
      },
      runs: {
        'logs/E0001/V0001/invalid': invalid,
        'logs/E0001/V0001/ready': run('ready', 'READY'),
      },
    })
    expect(
      (await aggregateLightweightExperiment({ projectRoot: project.root, experimentId: ID }))
        .content,
    ).toBe('variant,path,stat,value\n')
  })
  it('rejects symlink escapes, including another Variant in the project', async () => {
    const project = await createTempProject({
      files: { [`${EXP}/experiment.json`]: declaration({}) },
      runs: { 'logs/E0001/V0002/b': run('b') },
    })
    await fs.mkdir(project.path('logs/E0001/V0001'))
    await fs.symlink(project.path('logs/E0001/V0002/b'), project.path('logs/E0001/V0001/a'))
    await expect(
      aggregateLightweightExperiment({ projectRoot: project.root, experimentId: ID }),
    ).rejects.toThrow(/symlinks/)
  })
  it('writes unversioned Run results through the existing CLI writer primitive', async () => {
    const project = await createTempProject({
      experiments: {
        [ID]: buildLightweightExperimentBundle({ id: ID, slug: 'study', timestamp: time }),
      },
      runs: { 'logs/E0001/V0001/a': { 'run.json': run('a')['run.json'] } },
    })
    const result = await writeRunResult({
      projectRoot: project.root,
      runDir: project.path('logs/E0001/V0001/a'),
      set: [{ path: 'metrics.loss', value: 0.3 }],
      checkIgnore: false,
    })
    expect(result.content).toBe('path,stat,value\nmetrics.loss,,0.3\n')
  })
})

it('does not mix inactive history or READY metrics into a replacement Variant', async () => {
  const project = await createTempProject({
    files: { [`${EXP}/experiment.json`]: declaration({}) },
    runs: {
      'logs/E0001/V0001/old': run('old', 'FINISHED', '1'),
      'logs/E0001/V0001/new': run('new', 'READY', '999', false),
    },
  })
  const { activateLightweightRun } = await import('./lightweight-aggregate.js')
  await activateLightweightRun({
    projectRoot: project.root,
    experimentId: ID,
    variantId: 'V0001',
    runId: 'new',
    replace: true,
  })
  const result = await aggregateLightweightExperiment({
    projectRoot: project.root,
    experimentId: ID,
  })
  expect(result.content).toBe('variant,path,stat,value\nV0001,run.status,,READY\n')
  expect(
    JSON.parse(await fs.readFile(project.path('logs/E0001/V0001/old/run.json'), 'utf8')).active,
  ).toBe(false)
  expect(await fs.readFile(project.path('logs/E0001/V0001/old/result.csv'), 'utf8')).toContain(
    'metrics.loss,,1',
  )
})

it('shows planned parameters and assessments from Run inventory without Run I/O', () => {
  const result = generateLightweightResultsSummary({
    experimentId: ID,
    experimentDir: EXP,
    description: parseExperimentDescription(declaration({})),
    resultsCsv: 'variant,path,stat,value\nV0001,params.rate,,0.2\nV0001,metrics.loss,,999\n',
    generatedAt: time,
    generator: { release: '11.0.0', role: 'test' },
    runRecords: {
      'logs/E0001/V0001/a': {
        active: true,
        status: 'READY',
        deprecated: false,
        stop_reason: null,
        params: { rate: 0.2 },
      },
      'logs/E0001/V0001/old': {
        active: false,
        status: 'FINISHED',
        deprecated: false,
        stop_reason: null,
        assessment: { kind: 'LIMITED', reason: 'Too few samples' },
      },
    },
  })
  expect(result.variants[0]).toMatchObject({
    id: 'V0001',
    name: 'V0001',
    status: 'PLANNED',
    draft: { rate: 0.2 },
    others: [expect.objectContaining({ exclusion_reason: 'LIMITED: Too few samples' })],
  })
  expect(result.variants[0]!.cells['metrics.loss']).toBeUndefined()
  expect(result.variants[0]!.cells['params.rate']).toMatchObject({ value: 0.2 })
})

it('separates invalid measurement from limited precision or a superseded method', async () => {
  const a = run('a'),
    b = run('b'),
    c = run('c')
  a['run.json'] = JSON.stringify({
    ...JSON.parse(a['run.json']),
    assessment: { kind: 'INVALID', reason: 'Broken timer' },
  })
  b['run.json'] = JSON.stringify({
    ...JSON.parse(b['run.json']),
    assessment: { kind: 'LIMITED', reason: 'Few samples' },
  })
  c['run.json'] = JSON.stringify({
    ...JSON.parse(c['run.json']),
    assessment: {
      kind: 'SUPERSEDED',
      reason: 'A newer protocol is available; retain this comparison',
    },
  })
  const project = await createTempProject({
    files: { [`${EXP}/experiment.json`]: declaration({}) },
    runs: { 'logs/E0001/V0001/a': a, 'logs/E0001/V0002/b': b, 'logs/E0001/V0003/c': c },
  })
  const result = await aggregateLightweightExperiment({
    projectRoot: project.root,
    experimentId: ID,
  })
  expect(result.content).not.toContain('V0001,metrics.loss')
  expect(result.content).toContain('V0002,metrics.loss,,0.2')
  expect(result.content).toContain('V0003,metrics.loss,,0.2')
})

it('displays custom aggregate output when one selected input is still prepared', () => {
  const result = generateLightweightResultsSummary({
    experimentId: ID,
    experimentDir: EXP,
    description: parseExperimentDescription(
      declaration({ V0001: { aggregate: 'aggregate_variant.py' } }),
    ),
    resultsCsv: 'variant,path,stat,value\nV0001,metrics.loss,,0.2\n',
    generatedAt: time,
    generator: { release: '11.0.0', role: 'test' },
    runRecords: {
      'logs/E0001/V0001/a': { active: true, status: 'READY', deprecated: false, stop_reason: null },
      'logs/E0001/V0001/b': {
        active: true,
        status: 'FINISHED',
        deprecated: false,
        stop_reason: null,
      },
    },
  })
  expect(result.variants[0]!.cells['metrics.loss']).toMatchObject({ value: 0.2, source: 'runs' })
})
