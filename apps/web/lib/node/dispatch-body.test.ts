// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isBinaryContentType } from './dispatch'

describe('RPC response body encoding', () => {
  it('keeps API and browser text formats as UTF-8', () => {
    expect(isBinaryContentType('application/json; charset=utf-8')).toBe(false)
    expect(isBinaryContentType('text/html')).toBe(false)
    expect(isBinaryContentType('image/svg+xml')).toBe(false)
  })

  it('base64-wraps opaque report assets', () => {
    expect(isBinaryContentType('image/png')).toBe(true)
    expect(isBinaryContentType('application/wasm')).toBe(true)
    expect(isBinaryContentType('font/woff2')).toBe(true)
  })
})
