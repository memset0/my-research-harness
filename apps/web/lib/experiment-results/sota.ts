// SOTA (best-value) highlighting for metric columns.

import type { ResultsVariantEligibility, ResultVariant } from '@memon/core'
import type { ResultTableColumn, SotaRank, SotaRanking } from './types'
import type { ResultsViewSotaMode } from './views'

/**
 * For every metric column whose mode is not `off`, rank the top three finite
 * numeric values. Variants whose metrics are not `valid` are excluded. Ties
 * keep source order. Columns with no finite values get no ranking.
 */
export function computeSotaRanks(
  variants: ResultVariant[],
  columns: ResultTableColumn[],
  modes: Readonly<Record<string, ResultsViewSotaMode>>,
  eligibilityByVariant: ReadonlyMap<string, ResultsVariantEligibility> = new Map(),
): Map<string, SotaRanking> {
  const result = new Map<string, SotaRanking>()
  for (const column of columns) {
    if (column.schema?.group !== 'metric') continue
    const mode = modes[column.id] ?? 'off'
    if (mode === 'off') continue

    const entries: Array<{ variantId: string; value: number }> = []
    for (const variant of variants) {
      const eligibility = eligibilityByVariant.get(variant.id)
      if (eligibility && eligibility.metricsValidity !== 'valid') continue
      const raw = column.getValue(variant)
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        entries.push({ variantId: variant.id, value: raw })
      }
    }
    if (entries.length === 0) continue

    const sorted = entries
      .slice()
      .sort((a, b) => (mode === 'higher-is-better' ? b.value - a.value : a.value - b.value))
    const ranks = new Map<string, SotaRank>()
    sorted.slice(0, 3).forEach((entry, index) => {
      ranks.set(entry.variantId, (index + 1) as SotaRank)
    })
    result.set(column.id, { ranks, active: true })
  }
  return result
}
