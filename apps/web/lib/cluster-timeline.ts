// Geometry and labels for the cluster dashboard's timeline column.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MIN_SPAN = DAY
/** Shortest span while tickets run, so short tickets stay readable. */
const MIN_TICKET_SPAN = 30 * 60_000
const MAX_SPAN = 60 * DAY

export interface Horizon {
  start: number
  end: number
}

/**
 * From now to the latest expiry (1–60 days). While tickets run, the span covers
 * their ends instead (node expiries past it clamp to the edge), so bars stay
 * readable. Past starts add a lead-in before now of at most a quarter of the
 * span, so elapsed time shows.
 */
export function horizonFor(
  nowMs: number,
  untilMs: number[],
  tickets: Array<{ startMs: number; endMs: number }> = [],
): Horizon {
  const ends = tickets.length > 0 ? tickets.map((ticket) => ticket.endMs) : untilMs
  const latest = Math.max(nowMs, ...ends)
  const floor = tickets.length > 0 ? MIN_TICKET_SPAN : MIN_SPAN
  const span = Math.min(MAX_SPAN, Math.max(floor, latest - nowMs))
  const earliest = Math.min(nowMs, ...tickets.map((ticket) => ticket.startMs))
  return { start: nowMs - Math.min(nowMs - earliest, span / 4), end: nowMs + span }
}

export interface Bar {
  left: number
  width: number
  /** Width of the elapsed part, measured from `left`. */
  elapsed: number
}

/** A ticket bar from `startMs` to `endMs`, with the part before `nowMs` as elapsed. */
export function barGeometry(horizon: Horizon, startMs: number, endMs: number, nowMs: number): Bar {
  const left = positionPct(horizon, startMs)
  const right = positionPct(horizon, endMs)
  const now = positionPct(horizon, Math.min(Math.max(nowMs, startMs), endMs))
  return { left, width: right - left, elapsed: now - left }
}

/** Position of `ms` on the horizon in percent, clamped to [0, 100]. */
export function positionPct(horizon: Horizon, ms: number): number {
  const ratio = (ms - horizon.start) / (horizon.end - horizon.start)
  return Math.min(100, Math.max(0, ratio * 100))
}

/** At most 6 evenly spaced ticks after `fromMs` (default: the start), in days, hours or 5 minutes. */
export function dayTicks(horizon: Horizon, fromMs = horizon.start): number[] {
  const range = horizon.end - fromMs
  const unit = range >= 2 * DAY ? DAY : range >= 2 * HOUR ? HOUR : 5 * 60_000
  const count = Math.floor((horizon.end - fromMs) / unit)
  const step = Math.max(1, Math.ceil(count / 6))
  const ticks: number[] = []
  for (let n = step; n <= count; n += step) ticks.push(fromMs + n * unit)
  return ticks
}

export function formatSpan(ms: number): string {
  if (ms <= 0) return 'now'
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  const minutes = Math.floor((ms % HOUR) / 60_000)
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${Math.max(1, minutes)}m`
}
