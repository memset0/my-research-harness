// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { barGeometry, dayTicks, formatSpan, horizonFor, positionPct } from './cluster-timeline'

const DAY = 86_400_000

describe('cluster timeline geometry', () => {
  it('spans from now to the latest expiry, clamped to 1..60 days', () => {
    expect(horizonFor(0, [10 * DAY])).toEqual({ start: 0, end: 10 * DAY })
    expect(horizonFor(0, [3_600_000])).toEqual({ start: 0, end: DAY })
    expect(horizonFor(0, [400 * DAY]).end).toBe(60 * DAY)
    expect(horizonFor(0, []).end).toBe(DAY)
  })

  it('focuses on running tickets and adds a lead-in for their past starts', () => {
    expect(horizonFor(10 * DAY, [40 * DAY], [{ startMs: 9 * DAY, endMs: 14 * DAY }])).toEqual({
      start: 9 * DAY,
      end: 14 * DAY,
    })
    expect(horizonFor(10 * DAY, [40 * DAY], [{ startMs: 0, endMs: 14 * DAY }]).start).toBe(9 * DAY)
    expect(
      horizonFor(10 * DAY, [40 * DAY], [{ startMs: 10 * DAY, endMs: 10 * DAY + 3_600_000 }]),
    ).toEqual({
      start: 10 * DAY,
      end: 11 * DAY,
    })
  })

  it('splits a ticket bar into elapsed and remaining parts', () => {
    const horizon = { start: 0, end: 10 * DAY }
    expect(barGeometry(horizon, DAY, 5 * DAY, 3 * DAY)).toEqual({
      left: 10,
      width: 40,
      elapsed: 20,
    })
    expect(barGeometry(horizon, DAY, 5 * DAY, 0).elapsed).toBe(0)
    expect(barGeometry(horizon, DAY, 5 * DAY, 9 * DAY).elapsed).toBe(40)
    expect(barGeometry(horizon, -DAY, 30 * DAY, DAY)).toEqual({ left: 0, width: 100, elapsed: 10 })
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
    expect(dayTicks({ start: 0, end: 3 * DAY }, DAY / 2)).toEqual([1.5 * DAY, 2.5 * DAY])
    expect(dayTicks({ start: 0, end: DAY }).map((tick) => tick / 3_600_000)).toEqual([
      4, 8, 12, 16, 20, 24,
    ])
  })

  it('formats remaining spans compactly', () => {
    expect(formatSpan(8 * DAY + 3 * 3_600_000)).toBe('8d 3h')
    expect(formatSpan(5 * 3_600_000 + 7 * 60_000)).toBe('5h 7m')
    expect(formatSpan(20_000)).toBe('1m')
    expect(formatSpan(4 * 3_600_000)).toBe('4h')
    expect(formatSpan(0)).toBe('now')
  })
})
