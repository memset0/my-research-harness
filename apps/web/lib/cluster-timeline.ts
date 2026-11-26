// Geometry and labels for the cluster dashboard's timeline column.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MIN_SPAN = DAY
const MAX_SPAN = 60 * DAY

export interface Horizon {
  start: number
  end: number
}

export function horizonFor(nowMs: number, untilMs: number[]): Horizon {
  const latest = Math.max(nowMs, ...untilMs)
  const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN, latest - nowMs))
  return { start: nowMs, end: nowMs + span }
}

/** Position of `ms` on the horizon in percent, clamped to [0, 100]. */
export function positionPct(horizon: Horizon, ms: number): number {
  const ratio = (ms - horizon.start) / (horizon.end - horizon.start)
  return Math.min(100, Math.max(0, ratio * 100))
}

/** Evenly spaced whole-day ticks (at most 6), excluding the start. */
export function dayTicks(horizon: Horizon): number[] {
  const days = Math.floor((horizon.end - horizon.start) / DAY)
  const step = Math.max(1, Math.ceil(days / 6))
  const ticks: number[] = []
  for (let day = step; day <= days; day += step) ticks.push(horizon.start + day * DAY)
  return ticks
}

export function formatSpan(ms: number): string {
  if (ms <= 0) return 'now'
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  const minutes = Math.floor((ms % HOUR) / 60_000)
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`
}
