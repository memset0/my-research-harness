// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../registry'

describe('embed@1 schema', () => {
  it('defaults height to auto', () => {
    expect(validatePayload('embed', 1, { data: '<p>x</p>' })).toEqual({
      ok: true,
      data: { data: '<p>x</p>', height: 'auto' },
    })
  })
  it.each([0, -1, 1.5])('rejects height %s', (height) => {
    expect(validatePayload('embed', 1, { data: 'x', height })).toMatchObject({
      ok: false,
      field: 'height',
    })
  })
})
