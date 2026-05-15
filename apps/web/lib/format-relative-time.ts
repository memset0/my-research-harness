// Format an ISO-8601 timestamp as a short, human-friendly relative time
// (e.g. "just now", "12m ago", "3h ago", "yesterday", "5d ago",
// "3w ago", "2mo ago", "1y ago"). The dialog shows this in commit rows
// with the full timestamp tucked into the `title` attribute for hover.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const delta = now - t
  if (delta < 0) return 'in the future'
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 2 * DAY) return 'yesterday'
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`
  if (delta < MONTH) return `${Math.floor(delta / WEEK)}w ago`
  if (delta < YEAR) return `${Math.floor(delta / MONTH)}mo ago`
  return `${Math.floor(delta / YEAR)}y ago`
}
