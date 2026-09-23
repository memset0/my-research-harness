// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../registry'
import { buildPlotModel } from './series'

describe('datatable@1 schema', () => {
  it('defaults to one table view', () => {
    expect(validatePayload('datatable', 1, { columns: ['x'], data: [[1]] })).toEqual({
      ok: true, data: { columns: ['x'], data: [[1]], views: [{ type: 'table' }] },
    })
  })

  it.each([
    ['ragged row', { columns: ['x', 'y'], data: [[1]], views: [{ type: 'table' }] }, 'data[0]'],
    ['unknown view column', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'line', x: 'epoch', y: 'y' }] }, 'views[0].x'],
    ['non-boolean axis anchor', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'line', x: 'x', y: 'y', y_from_zero: 'yes' }] }, 'views[0].y_from_zero'],
    ['role collision', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'bar', x: 'x', y: 'y', series: 'x' }] }, 'views[0].series'],
    ['duplicate columns', { columns: ['x', 'x'], data: [[1, 2]] }, 'columns'],
    ['unknown filter column', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'table', filters: [{ label: 'a', where: { epoch: 1 } }] }] }, 'views[0].filters[0].where.epoch'],
    ['duplicate filter label', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'table', filters: [{ label: 'a', where: { x: 1 } }, { label: 'a', where: { y: 2 } }] }] }, 'views[0].filters[1].label'],
    ['two defaults in one mode', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'table', filter_mode: 'one', filters: [{ label: 'a', where: { x: 1 }, default: true }, { label: 'b', where: { y: 2 }, default: true }] }] }, 'views[0].filters'],
    ['empty where', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'table', filters: [{ label: 'a', where: {} }] }] }, 'views[0].filters[0].where'],
    ['empty operator object', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'table', filters: [{ label: 'a', where: { x: {} } }] }] }, 'views[0].filters[0].where.x'],
    ['unknown filter mode', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'table', filter_mode: 'all' }] }, 'views[0].filter_mode'],
    ['scatter role collision', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'scatter', x: 'x', y: 'x' }] }, 'views[0].y'],
  ])('rejects %s', (_label, value, field) => {
    expect(validatePayload('datatable', 1, value)).toMatchObject({ ok: false, field })
  })
  it('rejects filters on a plot view', () => {
    const view = { type: 'line', x: 'x', y: 'y', filters: [{ label: 'a', where: { x: 1 } }] }
    expect(validatePayload('datatable', 1, { columns: ['x', 'y'], data: [[1, 2]], views: [view] })).toMatchObject({ ok: false })
  })

  it('parses pre-existing table, line, and bar views unchanged', () => {
    const payload = {
      columns: ['run', 'step', 'fid'],
      data: [['a', 1, 2]],
      views: [{ type: 'table' }, { type: 'line', x: 'step', y: 'fid', series: 'run' }, { type: 'bar', x: 'run', y: 'fid' }],
    }
    expect(validatePayload('datatable', 1, payload)).toEqual({ ok: true, data: payload })
  })

  it('accepts a scatter view and a filtered table view', () => {
    const table = {
      type: 'table',
      filter_mode: 'one',
      filters: [
        { label: 'low', where: { fid: { lt: 15, gte: 0 } }, default: true },
        { label: 'two runs', where: { run: ['a', 'b'], step: 1 } },
      ],
    }
    const scatter = { type: 'scatter', x: 'step', y: 'fid', series: 'run', y_from_zero: true }
    const payload = { columns: ['run', 'step', 'fid'], data: [['a', 1, 2]], views: [table, scatter] }
    expect(validatePayload('datatable', 1, payload)).toEqual({ ok: true, data: payload })
  })

  it('accepts the axis anchor flags', () => {
    const view = { type: 'bar', x: 'x', y: 'y', x_from_zero: true, y_from_zero: false }
    expect(validatePayload('datatable', 1, { columns: ['x', 'y'], data: [[1, 2]], views: [view] })).toMatchObject({ ok: true, data: { views: [view] } })
  })
})

describe('datatable@1 plot model', () => {
  it('keeps the declared y text and numeric x beside the parsed values', () => {
    const model = buildPlotModel(['step', 'v'], [['10000', '0.0612345678'], [2000, 0.5]], { type: 'line', x: 'step', y: 'v' })
    expect(model.numericX).toBe(true)
    expect(model.points).toEqual([
      { x: '2000', xNumber: 2000, values: { v: 0.5 }, labels: { v: '0.5' } },
      { x: '10000', xNumber: 10000, values: { v: 0.0612345678 }, labels: { v: '0.0612345678' } },
    ])
  })

  it('marks a categorical x', () => {
    const model = buildPlotModel(['host', 'v'], [['a', 1], ['b', 2]], { type: 'bar', x: 'host', y: 'v' })
    expect(model.numericX).toBe(false)
    expect(model.points.map((point) => point.xNumber)).toEqual([null, null])
  })
})
