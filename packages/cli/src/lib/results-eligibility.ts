// Derive qualification from cited Run deprecation metadata at read time.
// Preserve source measurements; never mirror eligibility into results.yaml
// or synthesize a replacement value.

import {
  listDeprecatedRunIds,
  projectResultsRunEligibility,
  type ResultsDocument,
  type ResultsVariantEligibility,
} from '@memon/core'

export interface ResultsEligibility {
  /** Deprecated Run ids cited by these Variants, sorted. */
  deprecatedRuns: string[]
  /** Per-Variant eligibility rows, in document order. */
  variants: ResultsVariantEligibility[]
  /** Lookup by Variant id, for row-level annotation. */
  byVariant: Record<string, ResultsVariantEligibility | undefined>
}

export async function loadResultsEligibility(
  projectRoot: string,
  results: ResultsDocument | null,
): Promise<ResultsEligibility> {
  const deprecatedRuns = await listDeprecatedRunIds(projectRoot, {
    ids: results?.variants.flatMap((variant) => [...variant.runs, ...variant.attempts]) ?? [],
  })
  const variants = projectResultsRunEligibility(results, deprecatedRuns)
  const byVariant: Record<string, ResultsVariantEligibility> = {}
  for (const row of variants) byVariant[row.variantId] = row
  return {
    deprecatedRuns,
    variants,
    byVariant,
  }
}
