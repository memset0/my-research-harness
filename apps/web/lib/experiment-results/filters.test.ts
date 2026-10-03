// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import {
  compareFilterValues,
  filterVariants,
  matchesRowFilter,
  matchesScalarFilter,
} from './filters'
import { cellScalar, resultsDocument, variant } from './fixtures.test-helpers'

describe('compareFilterValues', () => {
  it.each([
    [undefined, '', 0],
    [null, '', 0],
    ['', '', 0],
    [undefined, 'x', null],
    [0.2, '0.1', 1],
    [0.1, '0.2', -1],
    [1, '1', 0],
    [1, 'abc', null],
    [1, '', 1],
    [Number.NaN, '1', null],
    [true, 'TRUE ', 0],
    [false, 'true', -1],
    [true, 'yes', null],
    ['Adam', 'adam', 0],
    ['run-10', 'run-9', 1],
    ['a<br>b', 'a\nb', 0],
  ])('%j vs %j', (value, target, expected) => {
    const comparison = compareFilterValues(value, target)
    if (expected === null) expect(comparison).toBeNull()
    else expect(Math.sign(comparison ?? Number.NaN)).toBe(expected)
  })
})

describe('matchesScalarFilter / matchesRowFilter', () => {
  it.each([
    [0.2, 'gt', '0.1', true],
    [0.2, 'lt', '0.1', false],
    [0.2, 'neq', '0.1', true],
    [null, 'eq', '', true],
    [null, 'gt', '0', false],
    [Number.NaN, 'eq', '1', false],
    [Number.NaN, 'neq', '1', false],
  ] as const)('scalar %j %s %j', (value, operator, target, expected) => {
    expect(matchesScalarFilter(value, operator, target)).toBe(expected)
  })

  it.each([
    [['r1', 'r2'], 'eq', 'r2', true],
    [['r1', 'r2'], 'neq', 'r2', false],
    [['r1', 'r2'], 'neq', 'r3', true],
    [['r1'], 'gt', 'r0', true],
    [[], 'eq', '', true],
    [[], 'neq', '', false],
    [Number.NaN, 'neq', '1', true],
    ['mixed', 'gt', '5', true],
  ] as const)('row %j %s %j', (value, operator, target, expected) => {
    expect(matchesRowFilter(value as never, { operator, value: target })).toBe(expected)
  })
})

describe('filterVariants', () => {
  // A stats cell compares its selected statistic; a mixed cell any of its values.
  it('filters stats columns by their sort statistic and mixed cells by any value', () => {
    const statRows = [
      variant('V1', { metrics: { clip: { mean: 0.3, std: 0.02, n: 3 } } }),
      variant('V2', { metrics: { clip: { mean: 0.5, std: 0.01, n: 3 } } }),
    ]
    const document = resultsDocument(statRows, [
      {
        key: 'metrics.clip',
        label: 'CLIP',
        type: 'stats',
        declared: true,
        partition: 'metrics',
        group: 'metrics',
        hidden: false,
        stats: ['mean', 'std', 'n'],
      },
    ])
    const statColumns = buildColumns(document)
    expect(
      filterVariants(
        statRows,
        statColumns,
        [{ id: 'f', columnId: 'metrics.clip', operator: 'gt', value: '0.4' }],
        {},
        false,
      ).map((row) => row.id),
    ).toEqual(['V2'])
    const bySpread = buildColumns(document, { statsSort: { 'metrics.clip': 'std' } })
    expect(
      filterVariants(
        statRows,
        bySpread,
        [{ id: 'f', columnId: 'metrics.clip', operator: 'gt', value: '0.015' }],
        {},
        false,
      ).map((row) => row.id),
    ).toEqual(['V1'])
  })

  const rows = [
    variant('V1', { metrics: { loss: 0.1 }, status: 'COMPLETED' }),
    variant('V2', { metrics: { loss: 0.2 }, status: 'RUNNING' }),
    variant('V3', { metrics: { loss: null }, status: 'PLANNED' }),
    variant('V3', { metrics: { loss: 0.3 }, status: 'COMPLETED' }),
  ]
  const columns = buildColumns(resultsDocument(rows))
  const ids = (list: typeof rows) =>
    list.map((row) => `${row.id}:${cellScalar(row, 'metrics.loss') ?? null}`)
  const filter = (columnId: string, operator: 'eq' | 'neq' | 'gt' | 'lt', value: string) => ({
    id: `${columnId}-${operator}-${value}`,
    columnId,
    operator,
    value,
  })

  it('returns everything without filters, and for an empty table', () => {
    expect(filterVariants(rows, columns, [], {}, false)).toEqual(rows)
    expect(filterVariants([], columns, [filter('metrics.loss', 'gt', '0')], {}, false)).toEqual([])
  })

  it('ANDs filters and keeps duplicate-id rows independent', () => {
    const result = filterVariants(
      rows,
      columns,
      [filter('metrics.loss', 'gt', '0.15'), filter('status', 'eq', 'COMPLETED')],
      {},
      false,
    )
    expect(ids(result)).toEqual(['V3:0.3'])
  })

  it('compares Status filters by text, not by lifecycle rank', () => {
    const statusRows = [
      variant('V1', { status: 'BLOCKED' }),
      variant('V2', { status: 'PLANNED' }),
      variant('V3', { status: 'COMPLETED' }),
    ]
    const statusColumns = buildColumns(resultsDocument(statusRows))
    expect(
      filterVariants(statusRows, statusColumns, [filter('status', 'eq', 'BLOCKED')], {}, false).map(
        (row) => row.id,
      ),
    ).toEqual(['V1'])
    // Alphabetically BLOCKED < COMPLETED < PLANNED; the sort-only lifecycle rank is not used.
    expect(
      filterVariants(statusRows, statusColumns, [filter('status', 'lt', 'C')], {}, false).map(
        (row) => row.id,
      ),
    ).toEqual(['V1'])
  })

  it('ignores filters on missing columns', () => {
    expect(filterVariants(rows, columns, [filter('metrics.gone', 'eq', 'x')], {}, false)).toEqual(
      rows,
    )
  })

  it('lets overrides win and show-all bypass everything', () => {
    const filters = [filter('metrics.loss', 'lt', '0.15')]
    const overrides = { V2: 'include', V1: 'exclude' } as const
    expect(ids(filterVariants(rows, columns, filters, overrides, false))).toEqual(['V2:0.2'])
    expect(filterVariants(rows, columns, filters, overrides, true)).toBe(rows)
  })
})
