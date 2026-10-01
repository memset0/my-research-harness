// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  arrangeColumns,
  buildColumns,
  distinctValues,
  excludedRunIds,
  resultValueDescription,
} from './columns'
import { resultsDocument, variant } from './fixtures.test-helpers'

const DEFAULT_IDS = [
  'variant',
  'status',
  'schema:lr',
  'schema:opt',
  'schema:flag',
  'schema:loss',
  'schema:notes',
  'entry',
  'recipe',
  'commit',
  'runs',
  'attempts',
]

describe('buildColumns', () => {
  it('places built-ins around the declared columns in YAML order', () => {
    expect(buildColumns(resultsDocument([])).map((column) => column.id)).toEqual(DEFAULT_IDS)
  })

  it('handles a document with no declared columns', () => {
    const columns = buildColumns({ schemaVersion: 1, columns: [], variants: [] })
    expect(columns.map((column) => column.id)).toEqual([
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
    ['schema:lr', 0.1],
    ['schema:loss', null],
    ['schema:notes', undefined],
    ['entry', 'train.py'],
    ['commit', undefined],
    ['runs', ['run-b']],
    ['attempts', []],
  ])('reads %s', (columnId, expected) => {
    const row = variant('V1', {
      parameters: { lr: 0.1 },
      metrics: { loss: null },
      runs: ['run-a', 'run-b'],
      attempts: ['run-a'],
      provenance: { entry: 'train.py' },
    })
    const column = buildColumns(resultsDocument([row]), new Set(['run-a'])).find(
      (candidate) => candidate.id === columnId,
    )
    expect(column?.getValue(row)).toEqual(expected)
  })

  it('attaches annotations by column key', () => {
    const document = {
      ...resultsDocument([]),
      columnAnnotations: { lr: { description: 'Step size' } },
    }
    const lr = buildColumns(document).find((column) => column.id === 'schema:lr')
    expect(lr?.annotation?.description).toBe('Step size')
  })
})

describe('excludedRunIds', () => {
  it.each([
    [undefined, undefined, []],
    [['run-a'], undefined, ['run-a']],
    [
      ['run-a'],
      [
        {
          variantId: 'V1',
          runs: ['run-b'],
          deprecatedRuns: ['run-b', 'run-a'],
          eligibleRuns: [],
          hasMetrics: true,
          metricsValidity: 'unavailable' as const,
        },
      ],
      ['run-a', 'run-b'],
    ],
  ])('merges %j with eligibility', (deprecated, eligibility, expected) => {
    expect([...excludedRunIds(deprecated, eligibility)].sort()).toEqual(expected)
  })
})

describe('arrangeColumns', () => {
  const columns = buildColumns(resultsDocument([]))
  const layout = (overrides: Partial<Parameters<typeof arrangeColumns>[1]> = {}) => ({
    columnOrderIds: DEFAULT_IDS,
    hiddenColumnIds: [],
    pinnedColumnIds: { left: [], right: [] },
    ...overrides,
  })
  const ids = (list: Array<{ id: string }>) => list.map((column) => column.id)

  it.each([
    ['default layout', layout(), false, DEFAULT_IDS, false],
    [
      'hidden column',
      layout({ hiddenColumnIds: ['status'] }),
      false,
      DEFAULT_IDS.filter((id) => id !== 'status'),
      false,
    ],
    [
      'hidden column with show-all',
      layout({ hiddenColumnIds: ['status'] }),
      true,
      DEFAULT_IDS,
      false,
    ],
    [
      'pins in pin order around the middle',
      layout({ pinnedColumnIds: { left: ['runs', 'status'], right: ['variant'] } }),
      false,
      [
        'runs',
        'status',
        ...DEFAULT_IDS.filter((id) => !['runs', 'status', 'variant'].includes(id)),
        'variant',
      ],
      false,
    ],
    [
      'unknown ids in the layout are ignored',
      layout({
        columnOrderIds: ['missing', ...DEFAULT_IDS],
        pinnedColumnIds: { left: ['gone'], right: [] },
      }),
      false,
      DEFAULT_IDS,
      true,
    ],
  ])('%s', (_name, input, showAll, expectedOrder, custom) => {
    const arranged = arrangeColumns(columns, input, showAll)
    expect(ids(arranged.orderedVisibleColumns)).toEqual(expectedOrder)
    expect(arranged.hasCustomColumnOrder).toBe(custom)
  })

  it('keeps hidden columns in the ordered list', () => {
    const arranged = arrangeColumns(columns, layout({ hiddenColumnIds: ['status'] }), false)
    expect(ids(arranged.orderedColumns)).toEqual(DEFAULT_IDS)
    expect(arranged.visibleColumns).toHaveLength(DEFAULT_IDS.length - 1)
  })

  it('handles an empty column list', () => {
    const arranged = arrangeColumns([], layout({ columnOrderIds: [] }), false)
    expect(arranged.orderedVisibleColumns).toEqual([])
    expect(arranged.hasCustomColumnOrder).toBe(false)
  })
})

describe('distinctValues', () => {
  const rows = [
    variant('V1', { parameters: { lr: 0.1, opt: 'adam', flag: true }, runs: ['r1', 'r2'] }),
    variant('V1', { parameters: { lr: 0.1, opt: 'Adam', flag: false }, runs: ['r2'] }),
    variant('V2', { parameters: { lr: Number.NaN, opt: 'a<br>b', flag: null }, runs: [] }),
    variant('V3', { parameters: { opt: '' } }),
  ]
  const columns = buildColumns(resultsDocument(rows))
  const column = (id: string) => columns.find((candidate) => candidate.id === id)!

  it.each([
    ['schema:lr', ['0.1', 'NaN']],
    ['schema:opt', ['a\nb', 'adam', 'Adam']],
    ['schema:flag', ['false', 'true']],
    ['runs', ['r1', 'r2']],
    ['schema:loss', []],
  ])('%s (duplicate rows collapse, empties skipped)', (id, expected) => {
    expect(distinctValues(rows, column(id))).toEqual(expected)
  })

  it('returns nothing for an empty table', () => {
    expect(distinctValues([], column('schema:lr'))).toEqual([])
  })
})

describe('resultValueDescription', () => {
  const document = {
    ...resultsDocument([]),
    columnAnnotations: { opt: { valueDescriptions: { adam: 'Adaptive', '0.1': 'n/a' } } },
  }
  const columns = buildColumns(document)
  const opt = columns.find((column) => column.id === 'schema:opt')!
  const lr = columns.find((column) => column.id === 'schema:lr')!

  it.each([
    [opt, variant('V1', { parameters: { opt: 'adam' } }), 'Adaptive'],
    [opt, variant('V1', { parameters: { opt: 'sgd' } }), undefined],
    [opt, variant('V1', { parameters: { opt: null } }), undefined],
    [lr, variant('V1', { parameters: { lr: 0.1 } }), undefined],
  ])('looks up the exact textual value', (column, row, expected) => {
    expect(resultValueDescription(column, row)).toBe(expected)
  })
})
