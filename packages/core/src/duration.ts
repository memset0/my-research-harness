// Share-link expiry durations (`<int>d`, `<int>h` or `never`).

export interface ParsedDuration {
  ms: number | null
}

/**
 * Parse a duration string. Returns `{ ms: number }` for `<int>d` / `<int>h`,
 * `{ ms: null }` for `"never"` (or undefined). Throws on invalid.
 */
export function parseDuration(input: string | undefined): ParsedDuration {
  if (input === undefined || input === 'never') return { ms: null }
  const m = /^(\d+)([dh])$/.exec(input.trim())
  if (!m) {
    throw new Error(`invalid --expires value: expected <int>d, <int>h, or "never"`)
  }
  const n = Number.parseInt(m[1]!, 10)
  const unit = m[2]!
  const factorMs = unit === 'd' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
  return { ms: n * factorMs }
}
