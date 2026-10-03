// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  buildColumns,
  cellText,
  cellValue,
  distinctValues,
  groupLabel,
  resultValueDescription,
} from './columns'
import {
  DEFAULT_COLUMNS,
  column as fixtureColumn,
  resultsDocument,
  statsCell,
  valueCell,
  variant,
} from './fixtures.test-helpers'

const DEFAULT_IDS = [
  'variant',
  'status',
  'params.lr',
  'params.opt',
  'params.flag',
  'metrics.loss',
  'metrics.notes',
  'entry',
  'recipe',
  'commit',
  'runs',
  'attempts',
]

describe('buildColumns', () => {
  it('places built-ins around the summary columns in summary order', () => {
    expect(buildColumns(resultsDocument([])).map((column) => column.id)).toEqual(DEFAULT_IDS)
  })

  it('handles a summary with no columns', () => {
    expect(buildColumns(resultsDocument([], [])).map((column) => column.id)).toEqual([
      'variant',
      'status',
      'entry',
      'recipe',
      'commit',
      'runs',
      'attempts',
    ])
  })

  it.each([
    ['variant', 'V1 Variant V1'],
    ['status', 'COMPLETED'],
    ['params.lr', 0.1],
    ['metrics.loss', null],
    ['metrics.notes', undefined],
    ['entry', 'train.py'],
    ['commit', undefined],
    ['runs', ['logs/b-261001-000000']],
    ['attempts', ['logs/a-261001-000000']],
  ])('reads %s', (columnId, expected) => {
    const row = variant('V1', {
      parameters: { lr: 0.1 },
      metrics: { loss: null },
      evidence: ['logs/b-261001-000000'],
      others: [
        { run: 'logs/a-261001-000000', status: 'FAILED', deprecated: false, stopReason: null },
      ],
      provenance: { entry: 'train.py' },
    })
    const column = buildColumns(resultsDocument([row])).find(
      (candidate) => candidate.id === columnId,
    )
    expect(column?.getValue(row)).toEqual(expected)
  })

  it('records ancestors, metric partition and stats options', () => {
    const columns = buildColumns(
      resultsDocument(
        [],
        [
          fixtureColumn('params.optim.adam.beta1', 'beta1'),
          fixtureColumn('metrics.eval.clip', 'CLIP', 'stats', {
            stats: ['mean', 'std', 'n', 'mean.mean'],
          }),
          fixtureColumn('metrics.serve.latency', 'Latency', 'stats', {
            over: 'gpu',
            stats: ['max.p99', 'mean.p50'],
          }),
        ],
      ),
    )
    const byId = new Map(columns.map((column) => [column.id, column]))
    expect(byId.get('params.optim.adam.beta1')).toMatchObject({
      metric: false,
      ancestors: ['group:params', 'group:params.optim', 'group:params.optim.adam'],
      statOptions: [],
    })
    expect(byId.get('metrics.eval.clip')).toMatchObject({
      metric: true,
      statOptions: ['mean', 'std', 'n'],
    })
    expect(byId.get('metrics.serve.latency')?.statOptions).toEqual(['mean.p50', 'max.p99'])
    expect(byId.get('entry')?.ancestors).toEqual(['group:$provenance'])
  })

  it('labels groups from the summary groups, partitions and last segments', () => {
    const groups = { 'params.optim': { label: 'Optimizer' } }
    expect(groupLabel('params.optim', groups)).toBe('Optimizer')
    expect(groupLabel('params', groups)).toBe('Parameters')
    expect(groupLabel('metrics.eval', groups)).toBe('eval')
  })
})

describe('cell text and comparable value', () => {
  const clip = fixtureColumn('metrics.eval.clip', 'CLIP', 'stats', {
    stats: ['mean', 'std', 'n'],
    decimals: 3,
  })

  it('reads an aggregated stats cell as mean ± std (n) by default', () => {
    const cell = statsCell({ mean: 11, std: 1, n: 3, min: 10, max: 12 })
    const plain = fixtureColumn('metrics.fid', 'FID', 'number')
    expect(cellText(cell, plain)).toBe('11 ± 1 (3)')
    expect(cellValue(cell, plain)).toBe(11)
  })

  it('switches the display and sort statistic of one column', () => {
    const cell = statsCell(
      { mean: 0.312, std: 0.021, n: 500, p50: 0.3, p99: 0.4 },
      { source: 'run', over: null, across: 'sample', runs: ['logs/a-261001-000000'] },
    )
    expect(cellText(cell, clip, { statsDisplay: { 'metrics.eval.clip': 'mean±std' } })).toBe(
      '0.312 ± 0.021',
    )
    expect(cellText(cell, clip, { statsDisplay: { 'metrics.eval.clip': 'p50/p99' } })).toBe(
      '0.300/0.400',
    )
    expect(cellValue(cell, clip, { statsDisplay: { 'metrics.eval.clip': 'p50/p99' } })).toBe(0.3)
    expect(cellValue(cell, clip, { statsSort: { 'metrics.eval.clip': 'p99' } })).toBe(0.4)
    // A statistic the cell lacks renders as an empty value.
    expect(cellText(cell, clip, { statsDisplay: { 'metrics.eval.clip': 'sem' } })).toBe('')
  })

  it('formats numbers with the View decimals and lists mixed values', () => {
    const lr = fixtureColumn('params.lr', 'LR', 'number')
    expect(cellText(valueCell(0.123456), lr, { decimalPlaces: { 'params.lr': 2 } })).toBe('0.12')
    const mixed = {
      kind: 'mixed' as const,
      source: 'runs' as const,
      perRun: [
        { run: 'logs/a-261001-000000', value: 0 },
        { run: 'logs/b-261001-000000', value: 1 },
      ],
    }
    expect(cellText(mixed, lr)).toBe('0 / 1')
    expect(cellValue(mixed, lr)).toEqual(['0', '1'])
  })
})

describe('distinctValues', () => {
  const rows = [
    variant('V1', {
      parameters: { lr: 0.1, opt: 'adam', flag: true },
      evidence: ['logs/r1-261001-000000', 'logs/r2-261001-000000'],
    }),
    variant('V1', {
      parameters: { lr: 0.1, opt: 'Adam', flag: false },
      evidence: ['logs/r2-261001-000000'],
    }),
    variant('V2', { parameters: { lr: Number.NaN, opt: 'a<br>b', flag: null } }),
    variant('V3', { parameters: { opt: '' } }),
  ]
  const columns = buildColumns(resultsDocument(rows))
  const column = (id: string) => columns.find((candidate) => candidate.id === id)!

  it.each([
    ['params.lr', ['0.1', 'NaN']],
    ['params.opt', ['a\nb', 'adam', 'Adam']],
    ['params.flag', ['false', 'true']],
    ['runs', ['logs/r1-261001-000000', 'logs/r2-261001-000000']],
    ['metrics.loss', []],
  ])('%s (duplicate rows collapse, empties skipped)', (id, expected) => {
    expect(distinctValues(rows, column(id))).toEqual(expected)
  })

  it('returns nothing for an empty table', () => {
    expect(distinctValues([], column('params.lr'))).toEqual([])
  })
})

describe('resultValueDescription', () => {
  const columns = buildColumns(
    resultsDocument(
      [],
      DEFAULT_COLUMNS.map((entry) =>
        entry.key === 'params.opt'
          ? { ...entry, valueDescriptions: { adam: 'Adaptive', '0.1': 'n/a' } }
          : entry,
      ),
    ),
  )
  const opt = columns.find((column) => column.id === 'params.opt')!
  const lr = columns.find((column) => column.id === 'params.lr')!

  it.each([
    [opt, variant('V1', { parameters: { opt: 'adam' } }), 'Adaptive'],
    [opt, variant('V1', { parameters: { opt: 'sgd' } }), undefined],
    [opt, variant('V1', { parameters: { opt: null } }), undefined],
    [lr, variant('V1', { parameters: { lr: 0.1 } }), undefined],
  ])('looks up the exact textual value', (column, row, expected) => {
    expect(resultValueDescription(column, row)).toBe(expected)
  })
})
