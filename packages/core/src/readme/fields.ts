// Frontmatter field coercion shared by the Run and Experiment parsers.

import { isId } from '../ids.js'
import type { ParseIssue } from '../types.js'

/** The value when it is a string, else `fallback`. */
export function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

/** String elements of an array; anything else yields `[]`. */
export function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

/**
 * Validate the `hypotheses` frontmatter array element-by-element. Elements
 * that are not canonical `H<NNNN>` form — including non-strings — are dropped
 * from the parsed array and a per-element warning is appended.
 */
export function validatedHypothesisRefs(v: unknown, warnings: ParseIssue[]): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const el of v) {
    if (typeof el !== 'string') {
      warnings.push({
        field: 'hypotheses',
        message: `INVALID_HYPOTHESIS_REF: non-string element in hypotheses array (dropped)`,
        severity: 'warning',
      })
      continue
    }
    if (!isId(el, 'H')) {
      warnings.push({
        field: 'hypotheses',
        message: `INVALID_HYPOTHESIS_REF: "${el}" must be canonical 4-digit form (e.g. H0003); dropped`,
        severity: 'warning',
      })
      continue
    }
    out.push(el)
  }
  return out
}
