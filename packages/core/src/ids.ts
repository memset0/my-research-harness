// Strict canonical IDs for hypotheses (H), digests (D), reports (R), and
// experiments (E).
//
// The canonical form is `<P><NNNN>` where <P> is the prefix letter and
// <NNNN> is a 4-digit zero-padded integer in [0001, 9999]. Examples:
//   H0001  — first hypothesis
//   D0042  — digest #42
//   R0123  — report #123
//   E0007  — experiment doc #7 at docs/experiments/E0007-<slug>.md
//
// Anything else (unpadded `H1`, overlong `H10000`, wrong prefix `Z0001`)
// is rejected by parseId. Use padId(prefix, n) to format.

export const ID_WIDTH = 4
export const ID_MIN = 1
export const ID_MAX = 9999

export const ID_PREFIXES = ['H', 'D', 'R', 'E'] as const
export type IdPrefix = (typeof ID_PREFIXES)[number]

/** Strict regex for the canonical form. Group 1 = prefix, group 2 = digits. */
export const ID_REGEX = /^([HDRE])(\d{4})$/

export interface ParsedId {
  prefix: IdPrefix
  /** Integer value (1..9999). Always positive. */
  n: number
}

/** Format an integer as the canonical padded ID. Throws on out-of-range. */
export function padId(prefix: IdPrefix, n: number): string {
  if (!Number.isInteger(n) || n < ID_MIN || n > ID_MAX) {
    throw new RangeError(
      `padId: n must be an integer in [${ID_MIN}, ${ID_MAX}]; got ${n}`,
    )
  }
  return `${prefix}${String(n).padStart(ID_WIDTH, '0')}`
}

/**
 * Parse a strict canonical ID. Returns the parsed components on success or
 * `null` on any deviation: unpadded (`H1`), overlong (`H10000`), wrong
 * prefix (`Z0001`), value 0 (`H0000`), trailing whitespace, etc.
 */
export function parseId(s: string): ParsedId | null {
  if (typeof s !== 'string') return null
  const m = ID_REGEX.exec(s)
  if (!m) return null
  const prefix = m[1] as IdPrefix
  const n = parseInt(m[2]!, 10)
  if (n < ID_MIN || n > ID_MAX) return null
  return { prefix, n }
}

/** True iff the input is a canonical ID with the given prefix. */
export function isId(s: unknown, prefix?: IdPrefix): s is string {
  const parsed = parseId(typeof s === 'string' ? s : '')
  if (!parsed) return false
  if (prefix !== undefined && parsed.prefix !== prefix) return false
  return true
}
