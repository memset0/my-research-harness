// Row sorting: default sort chain, optional temporary header sort, then
// natural Variant-ID order and finally source order.

import type { ResultVariant } from '@memon/core'
import { isEmptyValue, naturalCollator, valueText } from './format'
import type { ResultTableColumn, ResultValue } from './types'
import type { ResultsViewSortDirection, ResultsViewSortRule } from './views'

export type SortKey = Omit<ResultsViewSortRule, 'id'>

/** The temporary sort becomes primary; the default chain (minus that column) breaks ties. */
export function effectiveSortRules(
  temporarySort: SortKey | null,
  defaultSortRules: readonly SortKey[],
): SortKey[] {
  if (!temporarySort) return [...defaultSortRules]
  return [
    temporarySort,
    ...defaultSortRules.filter((rule) => rule.columnId !== temporarySort.columnId),
  ]
}

/** Stable sort; rules on unknown columns are skipped. Does not mutate `variants`. */
export function sortVariants(
  variants: ResultVariant[],
  columns: ResultTableColumn[],
  rules: readonly SortKey[],
): ResultVariant[] {
  const columnsById = new Map(columns.map((column) => [column.id, column] as const))
  return variants
    .map((variant, index) => ({ variant, index }))
    .sort((left, right) => {
      for (const rule of rules) {
        const column = columnsById.get(rule.columnId)
        if (!column) continue
        const comparison = compareSortValues(
          column.getValue(left.variant),
          column.getValue(right.variant),
          rule.direction,
        )
        if (comparison !== 0) return comparison
      }
      return naturalCollator.compare(left.variant.id, right.variant.id) || left.index - right.index
    })
    .map(({ variant }) => variant)
}

/** Empty values (and NaN) always sort last, whatever the direction. */
export function compareSortValues(
  left: ResultValue,
  right: ResultValue,
  direction: ResultsViewSortDirection,
): number {
  const leftEmpty = isUnsortable(left)
  const rightEmpty = isUnsortable(right)
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0
    return leftEmpty ? 1 : -1
  }
  const comparison = compareValues(left, right)
  return direction === 'asc' ? comparison : -comparison
}

function isUnsortable(value: ResultValue): boolean {
  return isEmptyValue(value) || (typeof value === 'number' && Number.isNaN(value))
}

function compareValues(left: ResultValue, right: ResultValue): number {
  if (typeof left === 'number' && typeof right === 'number') {
    if (left === right) return 0
    return left < right ? -1 : 1
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return naturalCollator.compare(valueText(left), valueText(right))
}
