// Frontmatter field coercion shared by the Run and Experiment parsers.

/** The value when it is a string, else `fallback`. */
export function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

/** String elements of an array; anything else yields `[]`. */
export function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}
