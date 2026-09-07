import { describe, expect, it } from 'vitest'
import { ID_MAX, ID_MIN, ID_PREFIXES, ID_REGEX, isId, padId, parseId } from './ids.js'

describe('padId', () => {
  it('formats with 4-digit zero-padding', () => {
    expect(padId('H', 1)).toBe('H0001')
    expect(padId('H', 42)).toBe('H0042')
    expect(padId('H', 9999)).toBe('H9999')
    expect(padId('D', 7)).toBe('D0007')
    expect(padId('R', 123)).toBe('R0123')
    expect(padId('W', 7)).toBe('W0007')
  })

  it('throws on out-of-range', () => {
    expect(() => padId('H', 0)).toThrow(RangeError)
    expect(() => padId('H', -1)).toThrow(RangeError)
    expect(() => padId('H', 10000)).toThrow(RangeError)
    expect(() => padId('H', 1.5)).toThrow(RangeError)
    expect(() => padId('H', NaN)).toThrow(RangeError)
  })
})

describe('parseId', () => {
  it('accepts canonical 4-digit form', () => {
    expect(parseId('H0001')).toEqual({ prefix: 'H', n: 1 })
    expect(parseId('H0042')).toEqual({ prefix: 'H', n: 42 })
    expect(parseId('H9999')).toEqual({ prefix: 'H', n: 9999 })
    expect(parseId('D0007')).toEqual({ prefix: 'D', n: 7 })
    expect(parseId('R0123')).toEqual({ prefix: 'R', n: 123 })
    expect(parseId('E0002')).toEqual({ prefix: 'E', n: 2 })
    expect(parseId('W0007')).toEqual({ prefix: 'W', n: 7 })
  })

  it('rejects unpadded form', () => {
    expect(parseId('H1')).toBeNull()
    expect(parseId('H42')).toBeNull()
    expect(parseId('H123')).toBeNull()
    expect(parseId('D7')).toBeNull()
  })

  it('rejects over-padded form', () => {
    expect(parseId('H00001')).toBeNull()
    expect(parseId('H10000')).toBeNull()
  })

  it('rejects H0000 (value 0 not in range)', () => {
    expect(parseId('H0000')).toBeNull()
  })

  it('rejects wrong prefix', () => {
    expect(parseId('Z0001')).toBeNull()
    expect(parseId('h0001')).toBeNull() // lowercase
    expect(parseId('0001')).toBeNull() // no prefix
  })

  it('rejects trailing/leading whitespace', () => {
    expect(parseId(' H0001')).toBeNull()
    expect(parseId('H0001 ')).toBeNull()
    expect(parseId('H0001.')).toBeNull()
  })

  it('rejects non-strings', () => {
    expect(parseId(null as unknown as string)).toBeNull()
    expect(parseId(undefined as unknown as string)).toBeNull()
    expect(parseId(1 as unknown as string)).toBeNull()
  })
})

describe('round-trip', () => {
  it('padId → parseId returns the same n + prefix', () => {
    for (const prefix of ID_PREFIXES) {
      for (const n of [1, 2, 42, 99, 100, 999, 1000, 9999]) {
        const s = padId(prefix, n)
        expect(parseId(s)).toEqual({ prefix, n })
      }
    }
  })

  it('boundary values', () => {
    expect(padId('H', ID_MIN)).toBe('H0001')
    expect(padId('H', ID_MAX)).toBe('H9999')
  })
})

describe('ID_REGEX', () => {
  it('matches canonical only', () => {
    expect(ID_REGEX.test('H0001')).toBe(true)
    expect(ID_REGEX.test('H1')).toBe(false)
    expect(ID_REGEX.test('Z0001')).toBe(false)
  })
})

describe('isId', () => {
  it('without prefix narrows to any canonical id', () => {
    expect(isId('H0001')).toBe(true)
    expect(isId('D0042')).toBe(true)
    expect(isId('R0123')).toBe(true)
    expect(isId('H1')).toBe(false)
    expect(isId(null)).toBe(false)
  })

  it('with prefix narrows further', () => {
    expect(isId('H0001', 'H')).toBe(true)
    expect(isId('H0001', 'D')).toBe(false)
    expect(isId('W0007', 'W')).toBe(true)
    expect(isId('W0007', 'R')).toBe(false)
  })
})
