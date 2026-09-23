// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { DatatableFilter } from './index'
import { buildScatterModel, filterRows, matchesCell } from './series'

describe('datatable@1 filter matching', () => {
  it.each([
    [10000, '10000', true],
    ['bf16', 'bf16', true],
    ['bf16', 'fp32', false],
    [null, null, true],
    ['b', ['a', 'b'], true],
    ['c', ['a', 'b'], false],
    ['a', { eq: 'a' }, true],
    ['a', { ne: 'a' }, false],
    ['a', { in: ['a'], not_in: ['b'] }, true],
    ['b', { not_in: ['b'] }, false],
    [14.9, { lt: 15 }, true],
    [15, { lt: 15 }, false],
    [15, { lte: 15 }, true],
    ['16', { gt: 15 }, true],
    [15, { gte: 15, lt: 20 }, true],
    [20, { gte: 15, lt: 20 }, false],
    ['n/a', { lt: 15 }, false],
    [null, { gte: 0 }, false],
  ] as const)('cell %j vs %j → %s', (cell, matcher, expected) => {
    expect(matchesCell(cell, matcher as never)).toBe(expected)
  })

  const columns = ['run', 'fid']
  const rows = [['bf16', 14], ['bf16', 16], ['fp32', 13], ['fp32', 'n/a']]
  const low: DatatableFilter = { label: 'low', where: { fid: { lt: 15 } } }
  const bf16: DatatableFilter = { label: 'bf16', where: { run: 'bf16' } }

  it('returns every row when no filter is active', () => {
    expect(filterRows(columns, rows, [])).toEqual(rows)
  })

  it('combines where entries and active filters with AND', () => {
    expect(filterRows(columns, rows, [low])).toEqual([['bf16', 14], ['fp32', 13]])
    expect(filterRows(columns, rows, [low, bf16])).toEqual([['bf16', 14]])
    expect(filterRows(columns, rows, [{ label: 'both', where: { run: 'fp32', fid: { lt: 15 } } }])).toEqual([['fp32', 13]])
  })
})

describe('datatable@1 scatter model', () => {
  it('keeps rows sharing an x and counts non-numeric x or y', () => {
    const model = buildScatterModel(
      ['lr', 'fid', 'run'],
      [[0.001, '14.10', 'a'], [0.001, 15, 'b'], [0.002, 13.2, 'a'], ['n/a', 12, 'b'], [0.003, null, 'a']],
      { type: 'scatter', x: 'lr', y: 'fid', series: 'run' },
    )
    expect(model.series).toEqual(['a', 'b'])
    expect(model.skipped).toBe(2)
    expect(model.points).toEqual([
      { series: 'a', x: 0.001, y: 14.1, xLabel: '0.001', yLabel: '14.10' },
      { series: 'b', x: 0.001, y: 15, xLabel: '0.001', yLabel: '15' },
      { series: 'a', x: 0.002, y: 13.2, xLabel: '0.002', yLabel: '13.2' },
    ])
  })

  it('honours the tab and select choice', () => {
    const model = buildScatterModel(
      ['exp', 'x', 'y'],
      [['E1', 1, 2], ['E2', 3, 4]],
      { type: 'scatter', x: 'x', y: 'y', tabs: 'exp' },
      { tab: 'E2' },
    )
    expect(model.series).toEqual(['y'])
    expect(model.points.map((point) => point.x)).toEqual([3])
  })
})
