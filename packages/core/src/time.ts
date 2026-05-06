// Local-time formatting helpers.
//
// All disk artifacts (README.md front matter, docs/journal.md events, experiment
// directory names) use the writer's local timezone with an explicit offset.
// We never write UTC-converted timestamps because that loses the writer's
// real-world clock context.

/**
 * Format a Date as `yymmdd-hhmmss` in local time, suitable for use as the
 * tail of an experiment directory name (matching EXPERIMENT_DIR_REGEX).
 */
export function formatExperimentStamp(d: Date): string {
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
