// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dayTicks, formatSpan, horizonFor, positionPct } from './cluster-timeline'

const DAY = 86_400_000

describe('cluster timeline geometry', () => {
  it('spans from now to the latest expiry, clamped to 1..60 days', () => {
    expect(horizonFor(0, [10 * DAY])).toEqual({ start: 0, end: 10 * DAY })
    expect(horizonFor(0, [3_600_000])).toEqual({ start: 0, end: DAY })
    expect(horizonFor(0, [400 * DAY]).end).toBe(60 * DAY)
    expect(horizonFor(0, []).end).toBe(DAY)
  })

  it('positions and clamps points on the horizon', () => {
    const horizon = { start: 0, end: 10 * DAY }
    expect(positionPct(horizon, 5 * DAY)).toBe(50)
    expect(positionPct(horizon, -DAY)).toBe(0)
    expect(positionPct(horizon, 20 * DAY)).toBe(100)
  })

  it('places at most six whole-day ticks', () => {
    expect(dayTicks({ start: 0, end: 3 * DAY })).toEqual([DAY, 2 * DAY, 3 * DAY])
    expect(dayTicks({ start: 0, end: 30 * DAY }).length).toBeLessThanOrEqual(6)
  })

  it('formats remaining spans compactly', () => {
    expect(formatSpan(8 * DAY + 3 * 3_600_000)).toBe('8d 3h')
    expect(formatSpan(5 * 3_600_000 + 7 * 60_000)).toBe('5h 7m')
    expect(formatSpan(20_000)).toBe('1m')
    expect(formatSpan(0)).toBe('now')
  })
})
