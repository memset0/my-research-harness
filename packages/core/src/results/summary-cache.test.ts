import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isResultsSummaryFresh,
  loadResultsSummary,
  readStoredResultsSummary,
  rebuildResultsSummaries,
  resultsSummaryPath,
  takeResultsInputFingerprints,
} from './summary-cache.js'
import { projectResultsTable } from './summary-render.js'

const MOCK = resolve(__dirname, '../../../../mock/project-a')
let root: string

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'memon-summary-cache-')))
})

afterEach(async () => {
  await fs.chmod(join(root, '.memon/index/results'), 0o755).catch(() => undefined)
  await fs.rm(root, { recursive: true, force: true })
})

async function write(rel: string, content: string) {
  await fs.mkdir(join(root, rel, '..'), { recursive: true })
  await fs.writeFile(join(root, rel), content)
}

const runReadme = (status: string) => `---\nstatus: ${status}\n---\n`
const csv = (version: number, rows: string[]) =>
  `path,stat,value\n$experiment_schema_version,,${version}\n${rows.map((row) => `${row}\n`).join('')}`

async function experiment(id: string, runs: string[], description: unknown) {
  await write(
    `docs/experiments/${id}/README.md`,
    `---\nid: ${id}\nslug: ${id.slice(6)}\ntitle: T\nstatus: OPEN\nruns: [${runs.map((run) => `"${run}"`).join(', ')}]\n---\n`,
  )
  if (description !== null)
    await write(
      `docs/experiments/${id}/experiment.json`,
      `${JSON.stringify(description, null, 2)}\n`,
    )
}

const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-090000'

async function seeds() {
  await write(`${A}/README.md`, runReadme('FINISHED'))
  await write(`${B}/README.md`, runReadme('FINISHED'))
  await write(`${A}/result.csv`, csv(1, ['metrics.fid,,10']))
  await write(`${B}/result.csv`, csv(1, ['metrics.fid,,12']))
  await experiment('E0001-foo', [A, B], {
    experiment_schema_version: 1,
    columns: [{ path: 'metrics.fid', label: 'FID', type: 'number' }],
    variants: [{ id: 'V0001', name: 'seeds', runs: [A, B] }],
  })
}

const fid = (summary: { variants: Array<{ cells: Record<string, unknown> }> }) =>
  summary.variants[0]!.cells['metrics.fid']

describe('loadResultsSummary', () => {
  it('regenerates a deleted summary with the same content and stores it', async () => {
    await seeds()
    const first = await loadResultsSummary(root, 'E0001-foo')
    expect(first).toMatchObject({ cache: 'regenerated', written: true, warnings: [] })
    expect(fid(first!.summary)).toMatchObject({ values: { mean: 11, n: 2 } })
    const again = await loadResultsSummary(root, 'E0001-foo')
    expect(again?.cache).toBe('hit')
    await fs.rm(resultsSummaryPath(root, 'E0001-foo'))
    const rebuilt = await loadResultsSummary(root, 'E0001-foo')
    expect(rebuilt?.cache).toBe('regenerated')
    expect({ ...rebuilt!.summary, generated_at: '', digest: '' }).toEqual({
      ...first!.summary,
      generated_at: '',
      digest: '',
    })
    expect(await readStoredResultsSummary(root, 'E0001-foo')).not.toBeNull()
  })

  it('discards a hand-edited summary', async () => {
    await seeds()
    await loadResultsSummary(root, 'E0001-foo')
    const path = resultsSummaryPath(root, 'E0001-foo')
    const stored = JSON.parse(await fs.readFile(path, 'utf8'))
    stored.variants[0].cells['metrics.fid'].values.mean = 99
    await fs.writeFile(path, JSON.stringify(stored))
    expect(await readStoredResultsSummary(root, 'E0001-foo')).toBeNull()
    const loaded = await loadResultsSummary(root, 'E0001-foo')
    expect(loaded?.cache).toBe('regenerated')
    expect(fid(loaded!.summary)).toMatchObject({ values: { mean: 11 } })
  })

  it('regenerates when a member result file changes or a member is added', async () => {
    await seeds()
    await loadResultsSummary(root, 'E0001-foo')
    await write(`${B}/result.csv`, csv(1, ['metrics.fid,,14']))
    const changed = await loadResultsSummary(root, 'E0001-foo')
    expect(changed?.cache).toBe('regenerated')
    expect(fid(changed!.summary)).toMatchObject({ values: { mean: 12, max: 14 } })
    const C = 'logs/c-260901-090000'
    await write(`${C}/README.md`, runReadme('RUNNING'))
    await experiment('E0001-foo', [A, B, C], null)
    const linked = await loadResultsSummary(root, 'E0001-foo')
    expect(linked?.cache).toBe('regenerated')
    expect(Object.keys(linked!.summary.inputs)).toContain(`${C}/README.md`)
  })

  it('serves a stored summary for fingerprints known by the caller until a refresh', async () => {
    await seeds()
    const first = await loadResultsSummary(root, 'E0001-foo')
    const known = first!.summary.inputs
    await write(`${B}/result.csv`, csv(1, ['metrics.fid,,20']))
    const windowed = await loadResultsSummary(root, 'E0001-foo', {
      known: (key) => (key.endsWith('experiment.json') ? undefined : known[key]),
    })
    expect(windowed?.cache).toBe('hit')
    expect(fid(windowed!.summary)).toMatchObject({ values: { max: 12 } })
    const refreshed = await loadResultsSummary(root, 'E0001-foo', { refresh: true })
    expect(fid(refreshed!.summary)).toMatchObject({ values: { max: 20 } })
  })

  it('returns the correct table and a RESULTS_CACHE_FAILED warning when the cache is read-only', async () => {
    await seeds()
    await fs.mkdir(join(root, '.memon/index/results'), { recursive: true })
    await fs.writeFile(join(root, '.memon/index/.gitignore'), '*\n')
    await fs.chmod(join(root, '.memon/index/results'), 0o555)
    const loaded = await loadResultsSummary(root, 'E0001-foo')
    expect(loaded?.written).toBe(false)
    expect(loaded?.warnings).toMatchObject([{ code: 'RESULTS_CACHE_FAILED', severity: 'warning' }])
    expect(projectResultsTable(loaded!.summary).rows[0]!.values['metrics.fid']).toMatchObject({
      stats: { mean: 11 },
    })
  })

  it('regards a summary of another release as stale and reports a missing Experiment as null', async () => {
    await seeds()
    const loaded = await loadResultsSummary(root, 'E0001-foo')
    const inputs = await takeResultsInputFingerprints(root, Object.keys(loaded!.summary.inputs))
    expect(isResultsSummaryFresh(loaded!.summary, inputs)).toBe(true)
    expect(isResultsSummaryFresh(loaded!.summary, inputs, '0.0.1')).toBe(false)
    expect(await loadResultsSummary(root, 'E0099-none')).toBeNull()
  })
})

describe('rebuildResultsSummaries', () => {
  it('reports each Experiment separately; one failure does not affect the others', async () => {
    await seeds()
    await write(`logs/x-260901-090000/README.md`, runReadme('FINISHED'))
    await write(`logs/x-260901-090000/result.csv`, csv(1, ['metrics.fid,,1']))
    await experiment('E0002-bar', ['logs/x-260901-090000'], {
      experiment_schema_version: 2,
      variants: [{ id: 'V0001', name: 'x', runs: ['logs/x-260901-090000'] }],
    })
    await experiment('E0003-old', [], null)
    const results = await rebuildResultsSummaries(root)
    expect(results.map((result) => [result.id, result.status, result.error?.code])).toEqual([
      ['E0001-foo', 'regenerated', undefined],
      ['E0002-bar', 'failed', 'RESULT_SCHEMA_MISMATCH'],
      ['E0003-old', 'failed', 'RESULTS_NOT_FOUND'],
    ])
    const again = await rebuildResultsSummaries(root, { experiments: ['E0001-foo'] })
    expect(again[0]!.status).toBe('unchanged')
    expect((await loadResultsSummary(root, 'E0001-foo'))?.summary.outcome).toBe('ok')
  })
})

describe('golden: a v9 copy of mock/project-a', () => {
  it('summarizes the mock Experiments from their Run records and result files', async () => {
    await fs.cp(MOCK, root, { recursive: true })
    await write(
      'docs/experiments/E0004-edm2-precond/experiment.json',
      `${JSON.stringify({
        experiment_schema_version: 1,
        columns: [{ path: 'metrics.fid', label: 'FID', type: 'number', direction: 'lower' }],
        variants: [
          {
            id: 'V0001',
            name: 'edm2 precond',
            status: 'PLANNED',
            runs: ['logs/edm2-precond-260503-080000', 'logs/edm2-precond-rerun-260503-100000'],
          },
        ],
      })}\n`,
    )
    await write(
      'docs/experiments/E0003-snr-sweep/experiment.json',
      `${JSON.stringify({
        experiment_schema_version: 1,
        groups: { 'params.snr': { label: 'SNR' } },
        columns: [
          { path: 'params.snr.gamma', label: 'γ', type: 'number' },
          { path: 'metrics.fid', label: 'FID', type: 'number', direction: 'lower' },
        ],
        variants: [
          {
            id: 'V0001',
            name: 'sweep',
            values: { 'params.snr.gamma': 5 },
            runs: ['logs/snr-sweep-260430-160000'],
          },
        ],
      })}\n`,
    )
    await write(
      'logs/snr-sweep-260430-160000/result.csv',
      csv(1, [
        'params.snr.gamma,,5',
        'metrics.fid,,18.2',
        'metrics.hf_ratio,mean,0.41',
        'metrics.hf_ratio,std,0.03',
      ]),
    )
    const edm2 = (await loadResultsSummary(root, 'E0004-edm2-precond'))!.summary
    expect(edm2.outcome).toBe('ok')
    expect(edm2.variants).toEqual([
      {
        id: 'V0001',
        name: 'edm2 precond',
        status: 'RUNNING',
        declared_status: 'PLANNED',
        evidence: [],
        others: [
          {
            run: 'logs/edm2-precond-260503-080000',
            status: 'FAILED',
            deprecated: false,
            stop_reason: null,
          },
          {
            run: 'logs/edm2-precond-rerun-260503-100000',
            status: 'PENDING',
            deprecated: false,
            stop_reason: null,
          },
        ],
        cells: {},
      },
    ])
    expect(edm2.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['VARIANT_STATUS_STALE'])
    const sweep = (await loadResultsSummary(root, 'E0003-snr-sweep'))!.summary
    expect(sweep.columns.map((column) => [column.path, column.type, column.declared])).toEqual([
      ['params.snr.gamma', 'number', true],
      ['metrics.fid', 'number', true],
      ['metrics.hf_ratio', 'stats', false],
    ])
    expect(sweep.groups).toEqual({ 'params.snr': { label: 'SNR' } })
    expect(sweep.variants[0]).toMatchObject({
      status: 'COMPLETED',
      evidence: ['logs/snr-sweep-260430-160000'],
      cells: {
        'params.snr.gamma': { kind: 'value', value: 5, source: 'run' },
        'metrics.fid': { kind: 'value', value: 18.2, source: 'run' },
        'metrics.hf_ratio': { kind: 'stats', values: { mean: 0.41, std: 0.03 }, source: 'run' },
      },
    })
    const unmigrated = (await loadResultsSummary(root, 'E0001-vpred-convergence'))!.summary
    expect(unmigrated.error?.code).toBe('RESULTS_NOT_FOUND')
    expect(Object.keys(unmigrated.inputs)).toEqual([
      'docs/experiments/E0001-vpred-convergence/experiment.json',
      'logs/foo-260501-100000/README.md',
      'logs/foo-260501-100000/result.csv',
      'logs/sub/bar-260502-150000/README.md',
      'logs/sub/bar-260502-150000/result.csv',
    ])
  })
})
