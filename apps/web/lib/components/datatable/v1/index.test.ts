// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../registry'

describe('datatable@1 schema', () => {
  it('defaults to one table view', () => {
    expect(validatePayload('datatable', 1, { columns: ['x'], data: [[1]] })).toEqual({
      ok: true, data: { columns: ['x'], data: [[1]], views: [{ type: 'table' }] },
    })
  })

  it.each([
    ['ragged row', { columns: ['x', 'y'], data: [[1]], views: [{ type: 'table' }] }, 'data[0]'],
    ['unknown view column', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'line', x: 'epoch', y: 'y' }] }, 'views[0].x'],
    ['role collision', { columns: ['x', 'y'], data: [[1, 2]], views: [{ type: 'bar', x: 'x', y: 'y', series: 'x' }] }, 'views[0].series'],
    ['duplicate columns', { columns: ['x', 'x'], data: [[1, 2]] }, 'columns'],
  ])('rejects %s', (_label, value, field) => {
    expect(validatePayload('datatable', 1, value)).toMatchObject({ ok: false, field })
  })
})
