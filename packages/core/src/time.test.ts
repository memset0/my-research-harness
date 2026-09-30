import { describe, expect, it } from 'vitest'
import { formatIsoLocal, formatRunStamp } from './time.js'

describe('formatRunStamp', () => {
  it('produces yymmdd-hhmmss', () => {
    const d = new Date(2026, 4, 3, 8, 28, 0) // May = month 4 (0-indexed)
    expect(formatRunStamp(d)).toBe('260503-082800')
  })

  it('zero-pads single-digit fields', () => {
    const d = new Date(2026, 0, 1, 0, 5, 9)
    expect(formatRunStamp(d)).toBe('260101-000509')
  })
})

describe('formatIsoLocal', () => {
  it('emits ISO8601 with local timezone offset', () => {
    const d = new Date(2026, 4, 3, 8, 28, 0)
    const out = formatIsoLocal(d)
    expect(out).toMatch(/^2026-05-03T08:28:00[+-]\d{2}:\d{2}$/)
  })

  it('uses + for non-negative UTC offsets', () => {
    const d = new Date(2026, 4, 3, 8, 28, 0)
    // Whatever local TZ we're in, the sign should be deterministic for that TZ
    const out = formatIsoLocal(d)
    const offsetSign = -d.getTimezoneOffset() >= 0 ? '+' : '-'
    expect(out.endsWith(`${offsetSign}${out.slice(-5)}`)).toBe(true)
  })
})
