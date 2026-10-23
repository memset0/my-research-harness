import { describe, expect, it } from 'vitest'
import { parseDuration } from './duration.js'

describe('parseDuration', () => {
  it('parses "never" / undefined as null', () => {
    expect(parseDuration(undefined)).toEqual({ ms: null })
    expect(parseDuration('never')).toEqual({ ms: null })
  })

  it('parses days', () => {
    expect(parseDuration('30d').ms).toBe(30 * 24 * 60 * 60 * 1000)
  })

  it('parses hours', () => {
    expect(parseDuration('4h').ms).toBe(4 * 60 * 60 * 1000)
  })

  it('throws on invalid format', () => {
    expect(() => parseDuration('30')).toThrow(/invalid --expires/)
    expect(() => parseDuration('foo')).toThrow(/invalid --expires/)
    expect(() => parseDuration('30m')).toThrow(/invalid --expires/)
  })
})
