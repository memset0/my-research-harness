// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../registry'

describe('figure@1 schema', () => {
  it('accepts an image and caption with optional description', () => {
    expect(validatePayload('figure', 1, { image: 'assets/x.svg', caption: 'Figure X.' })).toMatchObject({ ok: true })
  })
  it('requires nonempty image and caption', () => {
    expect(validatePayload('figure', 1, { image: '', caption: 'X' })).toMatchObject({ ok: false, field: 'image' })
    expect(validatePayload('figure', 1, { image: 'x', caption: ' ' })).toMatchObject({ ok: false, field: 'caption' })
  })
})
