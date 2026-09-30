// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../registry'

describe('figure@1 schema', () => {
  it('accepts an image and caption with optional description', () => {
    expect(
      validatePayload('figure', 1, { image: 'assets/x.svg', caption: 'Figure X.' }),
    ).toMatchObject({ ok: true })
  })
  it('requires nonempty image and caption', () => {
    expect(validatePayload('figure', 1, { image: '', caption: 'X' })).toMatchObject({
      ok: false,
      field: 'image',
    })
    expect(validatePayload('figure', 1, { image: 'x', caption: ' ' })).toMatchObject({
      ok: false,
      field: 'caption',
    })
  })
  it('accepts a video with an optional poster', () => {
    expect(
      validatePayload('figure', 1, { video: 'assets/x.mp4', caption: 'Video X.' }),
    ).toMatchObject({ ok: true })
    expect(
      validatePayload('figure', 1, {
        video: 'assets/x.mp4',
        poster: 'assets/x.jpg',
        caption: 'Video X.',
      }),
    ).toMatchObject({ ok: true })
  })
  it('requires exactly one of image or video, and poster only with video', () => {
    expect(validatePayload('figure', 1, { caption: 'X' })).toMatchObject({
      ok: false,
      field: 'image',
    })
    expect(
      validatePayload('figure', 1, { image: 'x.png', video: 'x.mp4', caption: 'X' }),
    ).toMatchObject({ ok: false, field: 'video' })
    expect(
      validatePayload('figure', 1, { image: 'x.png', poster: 'x.jpg', caption: 'X' }),
    ).toMatchObject({ ok: false, field: 'poster' })
  })
})
