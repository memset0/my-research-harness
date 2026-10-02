import { describe, expect, it } from 'vitest'
import type { Status } from '../types.js'
import { missingExperimentDescription, parseExperimentDescription } from './description.js'
import {
  deriveVariantStatus,
  generateResultsSummary,
  resultsSummaryDigest,
  type SummaryMemberInput,
} from './summary.js'
import {
  formatSummaryCell,
  projectResultsTable,
  renderResultsSummaryMarkdown,
} from './summary-render.js'

const csv = (version: number, rows: string[] = []) =>
  `path,stat,value\n$experiment_schema_version,,${version}\n${rows.map((row) => `${row}\n`).join('')}`

const member = (
  path: string,
  status: Status | null,
  result: string | null = null,
  extra: { deprecated?: boolean; stop_reason?: string } = {},
): SummaryMemberInput => ({
  path,
  record:
    status === null
      ? null
      : { status, deprecated: extra.deprecated ?? false, stop_reason: extra.stop_reason ?? null },
  result,
})

function summarize(description: unknown, members: SummaryMemberInput[], legacy = false) {
  return generateResultsSummary({
    experimentId: 'E0001-foo',
    experimentDir: 'docs/experiments/E0001-foo',
    description:
      description === null
        ? missingExperimentDescription('docs/experiments/E0001-foo/experiment.json')
        : parseExperimentDescription(
            typeof description === 'string' ? description : JSON.stringify(description),
            'docs/experiments/E0001-foo/experiment.json',
          ),
    legacyResultsYaml: legacy,
    members,
    inputs: {},
    newestInputMtime: null,
    generatedAt: '2026-10-02T12:00:00+08:00',
    generator: { release: '9.0.0', role: 'cli' },
  })
}

const A = 'logs/a-260901-090000'
const B = 'logs/b-260901-100000'
const C = 'logs/c-260901-110000'

describe('effective Variant status', () => {
  const rec = (status: Status, deprecated = false) => ({ status, deprecated, stop_reason: null })

  it('follows the declared, in-progress, evidence, failed, inconclusive order', () => {
    expect(deriveVariantStatus('DROPPED', [rec('RUNNING')])).toBe('DROPPED')
    expect(deriveVariantStatus('INCONCLUSIVE', [rec('FINISHED')])).toBe('INCONCLUSIVE')
    expect(deriveVariantStatus(null, [rec('INTERRUPTED')])).toBe('RUNNING')
    expect(deriveVariantStatus(null, [rec('FAILED'), rec('PENDING')])).toBe('RUNNING')
    expect(deriveVariantStatus(null, [rec('FAILED'), rec('FINISHED')])).toBe('COMPLETED')
    expect(deriveVariantStatus(null, [rec('FAILED'), rec('FINISHED', true)])).toBe('FAILED')
    expect(deriveVariantStatus(null, [rec('UNKNOWN'), rec('FINISHED', true)])).toBe('INCONCLUSIVE')
    expect(deriveVariantStatus('BLOCKED', [rec('RUNNING')])).toBe('RUNNING')
    expect(deriveVariantStatus('BLOCKED', [])).toBe('BLOCKED')
    expect(deriveVariantStatus('COMPLETED', [])).toBe('PLANNED')
    expect(deriveVariantStatus(null, [], 'COMPLETED')).toBe('COMPLETED')
    expect(deriveVariantStatus(null, [null])).toBe('INCONCLUSIVE')
  })
})

describe('generateResultsSummary', () => {
  it('keeps an interrupted Run in progress, never FAILED', () => {
    const summary = summarize(
      { experiment_schema_version: 1, variants: [{ id: 'V0001', name: 'a', runs: [A] }] },
      [member(A, 'INTERRUPTED')],
    )
    expect(summary.variants[0]).toMatchObject({
      status: 'RUNNING',
      evidence: [],
      others: [{ run: A, status: 'INTERRUPTED' }],
    })
  })

  it('makes a retried Variant COMPLETED with the finished Run as evidence', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [{ path: 'metrics.fid', label: 'FID', type: 'number' }],
        variants: [{ id: 'V0001', name: 'a', status: 'PLANNED', runs: [A, B] }],
      },
      [
        member(A, 'FAILED', null, { stop_reason: 'oom' }),
        member(B, 'FINISHED', csv(1, ['metrics.fid,,12.3'])),
      ],
    )
    expect(summary.outcome).toBe('ok')
    expect(summary.variants[0]).toMatchObject({
      status: 'COMPLETED',
      declared_status: 'PLANNED',
      evidence: [B],
      others: [{ run: A, status: 'FAILED', deprecated: false, stop_reason: 'oom' }],
      cells: { 'metrics.fid': { kind: 'value', value: 12.3, source: 'run', runs: [B] } },
    })
    expect(summary.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'VARIANT_STATUS_STALE',
    ])
  })

  it('warns when a Run overrides a declared BLOCKED status', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        variants: [{ id: 'V0007', name: 'b', status: 'BLOCKED', runs: [A] }],
      },
      [member(A, 'RUNNING')],
    )
    expect(summary.variants[0]!.status).toBe('RUNNING')
    expect(summary.diagnostics).toMatchObject([
      { code: 'VARIANT_STATUS_STALE', message: expect.stringContaining('V0007') },
    ])
  })

  it('reads a blocked Variant without Runs and keeps a declared derived status out of the effective one', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        variants: [
          {
            id: 'V0001',
            name: 'child',
            status: 'BLOCKED',
            description: 'waits for V0000',
            runs: [],
          },
          { id: 'V0002', name: 'claimed', status: 'COMPLETED', runs: [] },
        ],
      },
      [],
    )
    expect(summary.variants.map((variant) => [variant.status, variant.declared_status])).toEqual([
      ['BLOCKED', 'BLOCKED'],
      ['PLANNED', 'COMPLETED'],
    ])
    expect(summary.diagnostics).toEqual([])
  })

  it('lists a deprecated finished Run among the other Runs without values', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        variants: [{ id: 'V0002', name: 'x', runs: [A] }],
      },
      [member(A, 'FINISHED', csv(1, ['metrics.fid,,1']), { deprecated: true })],
    )
    expect(summary.variants[0]).toMatchObject({
      status: 'INCONCLUSIVE',
      evidence: [],
      others: [{ run: A, status: 'FINISHED', deprecated: true }],
      cells: {},
    })
  })

  it('aggregates three seeds as statistics over Runs, shown as mean ± std (n)', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [{ path: 'metrics.eval.fid', label: 'FID', type: 'number', direction: 'lower' }],
        variants: [{ id: 'V0001', name: 'seeds', runs: [A, B, C] }],
      },
      [
        member(A, 'FINISHED', csv(1, ['metrics.eval.fid,,10', 'params.lr,,0.1'])),
        member(B, 'FINISHED', csv(1, ['metrics.eval.fid,,11', 'params.lr,,0.1'])),
        member(C, 'FINISHED', csv(1, ['metrics.eval.fid,,12', 'params.lr,,0.1'])),
      ],
    )
    const cell = summary.variants[0]!.cells['metrics.eval.fid']!
    expect(cell).toMatchObject({
      kind: 'stats',
      source: 'runs',
      over: 'run',
      runs: [A, B, C],
      values: { mean: 11, std: 1, min: 10, max: 12, n: 3 },
    })
    expect(
      formatSummaryCell(
        cell,
        summary.columns.find((column) => column.path === 'metrics.eval.fid')!,
      ),
    ).toBe('11 ± 1 (3)')
    // Parameters are not statistics: equal values are shown once.
    expect(summary.variants[0]!.cells['params.lr']).toMatchObject({
      kind: 'value',
      value: 0.1,
      source: 'runs',
    })
  })

  it('never turns shared or seed parameters into statistics', () => {
    const summary = summarize(
      { experiment_schema_version: 1, variants: [{ id: 'V0001', name: 'seeds', runs: [A, B, C] }] },
      [A, B, C].map((run, seed) =>
        member(run, 'FINISHED', csv(1, ['params.optim.lr,,0.0001', `params.seed,,${seed}`])),
      ),
    )
    const cells = summary.variants[0]!.cells
    expect(cells['params.optim.lr']).toMatchObject({ kind: 'value', value: 0.0001, source: 'runs' })
    expect(cells['params.seed']).toMatchObject({
      kind: 'mixed',
      per_run: [
        { run: A, value: 0 },
        { run: B, value: 1 },
        { run: C, value: 2 },
      ],
    })
  })

  it('aggregates every recorded statistic as an outer level over Runs', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [
          {
            path: 'metrics.clip',
            label: 'CLIP',
            type: 'stats',
            across: 'sample',
            display: 'mean±std',
          },
        ],
        variants: [{ id: 'V0001', name: 's', runs: [A, B] }],
      },
      [
        member(A, 'FINISHED', csv(1, ['metrics.clip,mean,0.30', 'metrics.clip,std,0.02'])),
        member(B, 'FINISHED', csv(1, ['metrics.clip,mean,0.32', 'metrics.clip,std,0.04'])),
      ],
    )
    const cell = summary.variants[0]!.cells['metrics.clip']!
    expect(cell).toMatchObject({ kind: 'stats', across: 'sample', over: 'run' })
    if (cell.kind !== 'stats') throw new Error('stats expected')
    expect(cell.values['mean.mean']).toBeCloseTo(0.31, 12)
    expect(cell.values['mean.n']).toBe(2)
    expect(cell.values['std.mean']).toBeCloseTo(0.03, 12)
    const column = summary.columns[0]!
    expect(formatSummaryCell(cell, column)).toBe('0.31 ± 0.0141421')
  })

  it('marks a recorded parameter that differs from the plan', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [{ path: 'params.optim.lr', label: 'LR', type: 'number' }],
        variants: [
          { id: 'V0004', name: 'x', values: { 'params.optim.lr': 0.0001 }, runs: [A] },
          { id: 'V0005', name: 'planned', values: { 'params.optim.lr': 0.001 }, runs: [] },
        ],
      },
      [member(A, 'FINISHED', csv(1, ['params.optim.lr,,0.0002']))],
    )
    expect(summary.variants[0]!.cells['params.optim.lr']).toMatchObject({
      kind: 'value',
      value: 0.0002,
      planned: 0.0001,
      differs_from_plan: true,
    })
    expect(summary.variants[1]!.cells['params.optim.lr']).toEqual({
      kind: 'value',
      source: 'planned',
      value: 0.001,
    })
    expect(summary.diagnostics).toMatchObject([
      { code: 'VARIANT_PARAM_MISMATCH', message: expect.stringContaining('V0004') },
    ])
  })

  it('shows a frozen value of a Variant without Run directory, marked frozen', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [{ path: 'metrics.eval.fid', label: 'FID', type: 'number' }],
        variants: [
          {
            id: 'V0009',
            name: 'historical',
            runs: [],
            frozen: {
              status: 'COMPLETED',
              runs: ['logs/gone-260101-000000'],
              source: 'results.yaml@abc',
              values: [
                { path: 'metrics.eval.fid', stat: null, value: 13.1 },
                { path: 'metrics.eval.clip', stat: 'mean', value: 0.3 },
              ],
            },
          },
        ],
      },
      [],
    )
    const variant = summary.variants[0]!
    expect(variant.status).toBe('COMPLETED')
    expect(variant.frozen_runs).toEqual(['logs/gone-260101-000000'])
    expect(variant.cells['metrics.eval.fid']).toMatchObject({
      kind: 'value',
      value: 13.1,
      source: 'frozen',
    })
    expect(variant.cells['metrics.eval.clip']).toMatchObject({
      kind: 'stats',
      values: { mean: 0.3 },
      source: 'frozen',
    })
    expect(formatSummaryCell(variant.cells['metrics.eval.fid'], summary.columns[0]!)).toBe(
      '13.1 (frozen)',
    )
  })

  it('fails as a whole on a stale result file, listing it with the upgrade command', () => {
    const summary = summarize(
      { experiment_schema_version: 2, variants: [{ id: 'V0001', name: 'x', runs: [A, B] }] },
      [
        member(A, 'FINISHED', csv(2, ['metrics.fid,,1'])),
        member(B, 'FINISHED', csv(1, ['metrics.fid,,2'])),
      ],
    )
    expect(summary).toMatchObject({
      outcome: 'failed',
      variants: [],
      columns: [],
      error: {
        code: 'RESULT_SCHEMA_MISMATCH',
        files: [{ path: `${B}/result.csv`, version: 1 }],
        upgrade_command: 'memon experiment schema upgrade E0001-foo --to 2',
        expected_version: 2,
      },
    })
  })

  it('fails on a result file without its version row', () => {
    const summary = summarize(
      { experiment_schema_version: 1, variants: [{ id: 'V0001', name: 'x', runs: [A] }] },
      [member(A, 'FINISHED', 'path,stat,value\nmetrics.fid,,1\n')],
    )
    expect(summary.error).toMatchObject({
      code: 'RESULT_SCHEMA_MISMATCH',
      files: [{ path: `${A}/result.csv`, version: null, reason: expect.any(String) }],
    })
  })

  it('fails on a duplicate row, naming the file and both lines', () => {
    const summary = summarize(
      { experiment_schema_version: 1, variants: [{ id: 'V0001', name: 'x', runs: [A] }] },
      [member(A, 'FINISHED', csv(1, ['metrics.eval.fid,,1', 'metrics.eval.fid,,2']))],
    )
    expect(summary.error).toEqual({
      code: 'RESULT_DUPLICATE_ROW',
      message: expect.any(String),
      files: [
        {
          path: `${A}/result.csv`,
          duplicates: [{ path: 'metrics.eval.fid', stat: null, lines: [3, 4] }],
        },
      ],
    })
    expect(summary.variants).toEqual([])
  })

  it('reports a missing or invalid description file', () => {
    expect(summarize(null, [], true).error).toMatchObject({
      code: 'RESULTS_NOT_FOUND',
      legacy_results_yaml: true,
      message: expect.stringContaining('LEGACY_RESULTS_YAML'),
    })
    expect(summarize('{', []).error).toMatchObject({
      code: 'INVALID_RESULTS',
      diagnostics: [expect.objectContaining({ code: 'INVALID_JSON' })],
    })
    expect(
      summarize(
        { experiment_schema_version: 1, variants: [{ id: 'V0001', name: 'x', status: 'WAITING' }] },
        [],
      ).error,
    ).toMatchObject({ code: 'INVALID_RESULTS' })
  })

  it('shows undeclared paths with inferred types after the declared columns of their group', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [
          { path: 'params.lr', label: 'LR', type: 'number' },
          { path: 'metrics.eval.fid', label: 'FID', type: 'number' },
          { path: 'metrics.serve.latency', label: 'Latency', type: 'number' },
        ],
        variants: [{ id: 'V0001', name: 'x', runs: [A] }],
      },
      [
        member(
          A,
          'FINISHED',
          csv(1, [
            'metrics.eval.lpips,,0.2',
            'metrics.eval.fid,,10',
            'env.CUDA_VERSION,,12.4',
            'metrics.notes,,ok',
            'metrics.eval.dist,p50,3',
          ]),
        ),
      ],
    )
    expect(
      summary.columns.map((column) => [column.path, column.type, column.declared, column.hidden]),
    ).toEqual([
      ['params.lr', 'number', true, false],
      ['metrics.eval.fid', 'number', true, false],
      ['metrics.eval.dist', 'stats', false, false],
      ['metrics.eval.lpips', 'number', false, false],
      ['metrics.serve.latency', 'number', true, false],
      ['metrics.notes', 'string', false, false],
      ['env.CUDA_VERSION', 'number', false, true],
    ])
    expect(summary.columns[3]!.label).toBe('lpips')
  })

  it('lists a Run without results without values and ignores non-member Runs', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        variants: [{ id: 'V0001', name: 'x', runs: [A, 'logs/stranger-260901-090000'] }],
      },
      [member(A, 'FAILED')],
    )
    expect(summary.variants[0]).toMatchObject({ status: 'FAILED', evidence: [], cells: {} })
    expect(summary.variants[0]!.others.map((other) => other.run)).toEqual([A])
    expect(summary.diagnostics).toEqual([])
  })

  it('marks mixed non-numeric values and keeps two-level statistics per Run', () => {
    const summary = summarize(
      {
        experiment_schema_version: 1,
        columns: [
          { path: 'metrics.lat', label: 'Lat', type: 'stats', across: 'request', over: 'gpu' },
        ],
        variants: [{ id: 'V0001', name: 'x', runs: [A, B] }],
      },
      [
        member(A, 'FINISHED', csv(1, ['metrics.lat,max.p99,140', 'params.opt,,adam'])),
        member(B, 'FINISHED', csv(1, ['metrics.lat,max.p99,150', 'params.opt,,sgd'])),
      ],
    )
    const cells = summary.variants[0]!.cells
    expect(cells['metrics.lat']).toMatchObject({
      kind: 'per_run',
      per_run: [{ run: A, value: { 'max.p99': 140 } }, { run: B }],
    })
    expect(cells['params.opt']).toMatchObject({
      kind: 'mixed',
      per_run: [{ value: 'adam' }, { value: 'sgd' }],
    })
  })

  it('is deterministic and carries a verifiable digest', () => {
    const description = {
      experiment_schema_version: 1,
      variants: [{ id: 'V0001', name: 'x', runs: [A] }],
    }
    const first = summarize(description, [member(A, 'FINISHED', csv(1, ['metrics.fid,,1']))])
    const second = summarize(description, [member(A, 'FINISHED', csv(1, ['metrics.fid,,1']))])
    expect(second).toEqual(first)
    expect(resultsSummaryDigest(JSON.parse(JSON.stringify(first)))).toBe(first.digest)
    expect(resultsSummaryDigest({ ...first, experiment_schema_version: 2 })).not.toBe(first.digest)
  })
})

describe('projections', () => {
  const summary = summarize(
    {
      experiment_schema_version: 1,
      columns: [
        { path: 'params.lr', label: 'LR', type: 'number' },
        {
          path: 'metrics.fid',
          label: 'FID',
          type: 'number',
          unit: 'pts',
          description: 'Lower is better.',
        },
      ],
      variants: [
        { id: 'V0001', name: 'blocked', status: 'BLOCKED', description: 'waits', runs: [] },
        {
          id: 'V0002',
          name: 'done',
          values: { 'params.lr': 0.1 },
          provenance: { entry: 'scripts/train.sh' },
          runs: [A],
        },
      ],
    },
    [member(A, 'FINISHED', csv(1, ['metrics.fid,,12.5']))],
  )

  it('selects blocked Variants case-insensitively and filters columns', () => {
    const table = projectResultsTable(summary, { statuses: ['blocked'] })
    expect(table.rows.map((row) => [row.variantId, row.status])).toEqual([['V0001', 'BLOCKED']])
    expect(table.meta).toEqual({
      totalVariants: 2,
      filteredVariants: 1,
      filters: { statuses: ['blocked'], columnGroup: 'all' },
    })
    const metrics = projectResultsTable(summary, { group: 'metric' })
    expect(metrics.columns.map((column) => column.path)).toEqual(['metrics.fid'])
    expect(metrics.rows[1]).toMatchObject({
      variantId: 'V0002',
      runs: [A],
      attempts: [],
      values: { 'metrics.fid': 12.5 },
      frozen: [],
    })
  })

  it('renders the Markdown table, annotations and the failure callout', () => {
    const markdown = renderResultsSummaryMarkdown(summary)
    expect(markdown).toContain('### Column annotations')
    expect(markdown).toContain(
      '| Variant | Status | LR | FID (pts) | Entry | Recipe | Commit | Runs | Other Runs |',
    )
    expect(markdown).toContain('| **V0001** blocked | `BLOCKED` | — | — |')
    expect(markdown).toContain('| **V0002** done | `COMPLETED` | 0.1 | 12.5 | `scripts/train.sh` |')
    const failed = summarize({ experiment_schema_version: 2, variants: [] }, [
      member(A, 'FINISHED', csv(1)),
    ])
    const callout = renderResultsSummaryMarkdown(failed)
    expect(callout).toContain('**RESULT_SCHEMA_MISMATCH**')
    expect(callout).toContain(`\`${A}/result.csv\` records version 1`)
    expect(callout).toContain('`memon experiment schema upgrade E0001-foo --to 2`')
    expect(() => projectResultsTable(failed)).toThrow(/failed/)
  })
})
