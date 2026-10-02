// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { buildColumns } from './columns'
import { resultsDocument, variant } from './fixtures.test-helpers'
import { compareSortValues, effectiveSortRules, sortVariants } from './sorting'

describe('effectiveSortRules', () => {
  const defaults = [
    { columnId: 'a', direction: 'asc' as const },
    { columnId: 'b', direction: 'desc' as const },
  ]
  it.each([
    [null, defaults],
    [
      { columnId: 'b', direction: 'asc' as const },
      [{ columnId: 'b', direction: 'asc' }, defaults[0]],
    ],
    [
      { columnId: 'c', direction: 'desc' as const },
      [{ columnId: 'c', direction: 'desc' }, ...defaults],
    ],
  ])('temporary %j', (temporary, expected) => {
    expect(effectiveSortRules(temporary, defaults)).toEqual(expected)
  })
})

describe('compareSortValues', () => {
  it.each([
    [1, 2, 'asc', -1],
    [1, 2, 'desc', 1],
    [2, 2, 'asc', 0],
    [null, 1, 'asc', 1],
    [null, 1, 'desc', 1],
    [1, undefined, 'desc', -1],
    [[], ['a'], 'asc', 1],
    [null, '', 'asc', 0],
    [Number.NaN, 1, 'asc', 1],
    [Number.NaN, 1, 'desc', 1],
    [Number.NaN, Number.NaN, 'asc', 0],
    [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 'asc', -1],
    [false, true, 'asc', -1],
    ['run-9', 'run-10', 'asc', -1],
    [10, 'abc', 'asc', -1],
    [['a', 'b'], ['a', 'c'], 'asc', -1],
  ] as const)('%j vs %j (%s)', (left, right, direction, expected) => {
    expect(Math.sign(compareSortValues(left as never, right as never, direction))).toBe(expected)
  })
})

describe('sortVariants', () => {
  const rows = [
    variant('V10', { parameters: { lr: 0.1 }, metrics: { loss: 0.3 } }),
    variant('V2', { parameters: { lr: 0.2 }, metrics: { loss: null } }),
    variant('V1', { parameters: { lr: 0.1 }, metrics: { loss: 0.2 } }),
    variant('V1', { parameters: { lr: 0.3 }, metrics: { loss: Number.NaN } }),
  ]
  const columns = buildColumns(resultsDocument(rows))
  const order = (list: typeof rows) => list.map((row) => `${row.id}/${row.parameters.lr}`)

  it('defaults to natural Variant id then source order for duplicates', () => {
    expect(order(sortVariants(rows, columns, []))).toEqual([
      'V1/0.1',
      'V1/0.3',
      'V2/0.2',
      'V10/0.1',
    ])
  })

  it('chains rules and keeps empty and NaN last', () => {
    expect(
      order(
        sortVariants(rows, columns, [
          { columnId: 'schema:lr', direction: 'asc' },
          { columnId: 'schema:loss', direction: 'desc' },
        ]),
      ),
    ).toEqual(['V10/0.1', 'V1/0.1', 'V2/0.2', 'V1/0.3'])
    expect(
      order(sortVariants(rows, columns, [{ columnId: 'schema:loss', direction: 'desc' }])),
    ).toEqual(['V10/0.1', 'V1/0.1', 'V1/0.3', 'V2/0.2'])
  })

  it('skips rules on missing columns and handles an empty table', () => {
    expect(order(sortVariants(rows, columns, [{ columnId: 'nope', direction: 'desc' }]))).toEqual(
      order(sortVariants(rows, columns, [])),
    )
    expect(sortVariants([], columns, [{ columnId: 'schema:lr', direction: 'asc' }])).toEqual([])
  })

  it('does not mutate its input', () => {
    const copy = [...rows]
    sortVariants(rows, columns, [{ columnId: 'schema:lr', direction: 'desc' }])
    expect(rows).toEqual(copy)
  })
})

describe('Status column sorting', () => {
  const rows = [
    variant('V1', { status: 'DROPPED' }),
    variant('V2', { status: 'RUNNING' }),
    variant('V3', { status: 'BLOCKED' }),
    variant('V4', { status: 'PLANNED' }),
    variant('V5', { status: 'COMPLETED' }),
  ]
  const columns = buildColumns(resultsDocument(rows))
  const statuses = (list: typeof rows) => list.map((row) => row.status)

  it('sorts ascending by lifecycle order with BLOCKED right after PLANNED', () => {
    expect(
      statuses(sortVariants(rows, columns, [{ columnId: 'status', direction: 'asc' }])),
    ).toEqual(['PLANNED', 'BLOCKED', 'RUNNING', 'COMPLETED', 'DROPPED'])
  })

  it('reverses the lifecycle order when descending, not the alphabet', () => {
    expect(
      statuses(sortVariants(rows, columns, [{ columnId: 'status', direction: 'desc' }])),
    ).toEqual(['DROPPED', 'COMPLETED', 'RUNNING', 'BLOCKED', 'PLANNED'])
  })

  it('places FAILED and INCONCLUSIVE between COMPLETED and DROPPED and breaks ties by Variant id', () => {
    const more = [
      variant('V9', { status: 'INCONCLUSIVE' }),
      variant('V8', { status: 'FAILED' }),
      variant('V7', { status: 'BLOCKED' }),
      variant('V6', { status: 'BLOCKED' }),
      ...rows,
    ]
    expect(
      sortVariants(more, buildColumns(resultsDocument(more)), [
        { columnId: 'status', direction: 'asc' },
      ]).map((row) => `${row.status}:${row.id}`),
    ).toEqual([
      'PLANNED:V4',
      'BLOCKED:V3',
      'BLOCKED:V6',
      'BLOCKED:V7',
      'RUNNING:V2',
      'COMPLETED:V5',
      'FAILED:V8',
      'INCONCLUSIVE:V9',
      'DROPPED:V1',
    ])
  })
})
