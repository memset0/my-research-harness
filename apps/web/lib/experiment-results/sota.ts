// SOTA (best-value) highlighting for metric columns.
//
// A column ranks its finite numeric values — for a stats column, the selected
// sort statistic — and highlights the best three. A column that declares a
// direction ranks by it whenever highlighting is on; otherwise the View's mode
// chooses higher or lower.

import type { ResultTableColumn, ResultVariant, SotaRank, SotaRanking } from './types'
import type { ResultsViewSotaMode } from './views'

/** The mode a column ranks with: off, or the declared direction once enabled. */
export function effectiveSotaMode(
  column: ResultTableColumn,
  modes: Readonly<Record<string, ResultsViewSotaMode>>,
): ResultsViewSotaMode {
  const stored = modes[column.id] ?? 'off'
  if (stored === 'off') return 'off'
  const direction = column.result?.direction
  if (direction === 'higher') return 'higher-is-better'
  if (direction === 'lower') return 'lower-is-better'
  return stored
}

/**
 * For every metric column whose mode is not `off`, rank the top three finite
 * numeric values. Ties keep source order. Columns with no finite values get no
 * ranking.
 */
export function computeSotaRanks(
  variants: readonly ResultVariant[],
  columns: readonly ResultTableColumn[],
  modes: Readonly<Record<string, ResultsViewSotaMode>>,
): Map<string, SotaRanking> {
  const result = new Map<string, SotaRanking>()
  for (const column of columns) {
    if (!column.metric) continue
    const mode = effectiveSotaMode(column, modes)
    if (mode === 'off') continue

    const entries: Array<{ variantId: string; value: number }> = []
    for (const variant of variants) {
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
