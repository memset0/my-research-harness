// Results eligibility — a READ-TIME projection over results.yaml.
//
// Deprecating a Run does not rewrite anything that was already measured:
// results.yaml keeps its stored numbers, and this module answers the only
// honest question a reader can ask of them — "is the evidence behind this
// Variant's metrics still eligible?".
//
// Deliberate non-goals:
//   - no second persisted research ledger; nothing here is written to disk
//   - no substitute/recomputed metrics; a Variant whose evidence went away
//     reports `unavailable`, it does not get replacement numbers
//   - no lint diagnostics; a well-formed results.yaml that cites a
//     deprecated but existing Run is structurally valid
//   - no Run bodies, logs, or artifacts are read — the caller supplies the
//     deprecated-id set (see `listDeprecatedRunIds`), so an Experiment-level
//     reader never descends into Run documents
//
// `attempts` are intentionally ignored: they are already-unselected runs, so
// their deprecation says nothing about the Variant's materialized metrics.

import type { ResultsDocument, ResultVariant } from '../types.js'

export type ResultsMetricsValidity = 'valid' | 'partial' | 'unavailable'

export interface ResultsVariantEligibility {
  variantId: string
  /** Runs the Variant accepts as evidence, in declaration order. */
  runs: string[]
  /** Subset of `runs` that is deprecated. */
  deprecatedRuns: string[]
  /** Subset of `runs` that is still research-eligible. */
  eligibleRuns: string[]
  /** True when the Variant has at least one materialized metric value. */
  hasMetrics: boolean
  /**
   * - `valid`       — no deprecated evidence (or no metrics to invalidate)
   * - `partial`     — some evidence deprecated: the stored numbers no longer
   *                   describe the eligible runs alone, so they are not
   *                   comparable until repopulated
   * - `unavailable` — every run behind the stored metrics is deprecated:
   *                   the numbers stay in results.yaml but carry no eligible
   *                   evidence at all
   */
  metricsValidity: ResultsMetricsValidity
}

/**
 * Per-Variant eligibility rows for a parsed results document. Returns `[]`
 * for a missing document. Variants without metrics are still reported (so
 * callers can show which evidence was withdrawn) but stay `valid`, since
 * there is nothing materialized to invalidate.
 */
export function projectResultsRunEligibility(
  results: ResultsDocument | null,
  deprecatedRuns: Iterable<string>,
): ResultsVariantEligibility[] {
  const deprecated = deprecatedRuns instanceof Set ? deprecatedRuns : new Set(deprecatedRuns)
  if (results === null) return []
  return results.variants.map((variant) => {
    const withdrawn: string[] = []
    const eligible: string[] = []
    for (const run of variant.runs) {
      if (deprecated.has(run)) withdrawn.push(run)
      else eligible.push(run)
    }
    const hasMetrics = variantHasMetrics(variant)
    let metricsValidity: ResultsMetricsValidity = 'valid'
    if (hasMetrics && withdrawn.length > 0) {
      metricsValidity = eligible.length === 0 ? 'unavailable' : 'partial'
    }
    return {
      variantId: variant.id,
      runs: [...variant.runs],
      deprecatedRuns: withdrawn,
      eligibleRuns: eligible,
      hasMetrics,
      metricsValidity,
    }
  })
}

/** Does the Variant carry any materialized (non-null) metric value? */
export function variantHasMetrics(variant: ResultVariant): boolean {
  for (const value of Object.values(variant.metrics)) {
    if (value !== null) return true
  }
  return false
}
