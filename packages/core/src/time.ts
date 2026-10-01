// Local-time formatting helpers.
//
// All disk artifacts (README.md front matter, docs/journal.md events, experiment
// directory names) use the writer's local timezone with an explicit offset.
// We never write UTC-converted timestamps because that loses the writer's
// real-world clock context.

import { runSlugFromDirName } from './ids.js'

/**
 * Format a Date as `yymmdd-hhmmss` in local time, suitable for use as the
 * tail of an experiment directory name (matching RUN_DIR_REGEX).
 */
export function formatRunStamp(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yy}${mm}${dd}-${hh}${mi}${ss}`
}

/**
 * Format a Date as full ISO8601 with the local timezone offset:
 *   `2026-05-03T08:28:00+08:00`
 *
 * This is the canonical timestamp format for everything memon writes:
 * front matter `created_at`/`finished_at`, JOURNAL event timestamps, etc.
 */
export function formatIsoLocal(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const oh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0')
  const om = String(Math.abs(offsetMin) % 60).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${oh}:${om}`
}

/**
 * Extract the slug portion of a run dir name.
 *
 * A run dir matches `<slug>-<YYMMDD>-<HHMMSS>`. The slug is everything
 * before the last `-<6digits>-<6digits>`. Returns null if the input
 * doesn't look like a run dir.
 */
export function parseSlugFromRunDir(dirName: string): string | null {
  return runSlugFromDirName(dirName)
}

/**
 * Parse the `<YYMMDD>-<HHMMSS>` tail of a run dir into an ISO8601 timestamp
 * with the machine's current local timezone offset. Returns null when the
 * input doesn't end with the expected timestamp shape.
 *
 * Used as the fallback for `created_at` when a run README is missing the
 * field (per `run-readme` capability).
 */
export function parseTimestampFromRunDir(dirName: string): string | null {
  const m = dirName.match(/-(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/)
  if (!m) return null
  const yy = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  const hh = Number(m[4])
  const mi = Number(m[5])
  const ss = Number(m[6])
  // 2-digit year heuristic: 00-69 => 2000s+, 70-99 => 1900s. memon was
  // created post-2024 so this is safe within the tool's lifetime.
  const yyyy = yy < 70 ? 2000 + yy : 1900 + yy
  const d = new Date(yyyy, mo - 1, da, hh, mi, ss)
  if (Number.isNaN(d.getTime())) return null
  return formatIsoLocal(d)
}
