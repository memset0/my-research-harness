// Row filtering: AND-composed filters with per-Variant overrides.

import { naturalCollator } from './format'
import type { ResultTableColumn, ResultValue, ResultVariant } from './types'

type ResultScalar = string | number | boolean | null

import type {
  ResultsViewRowFilter,
  ResultsViewRowFilterOperator,
  ResultsViewRowOverride,
} from './views'

/**
 * Overrides win (`include` always shown, `exclude` always hidden); other rows
 * must satisfy every filter. Filters on unknown columns are ignored. With
 * `showAllRows` nothing is filtered.
 */
export function filterVariants(
  variants: ResultVariant[],
  columns: ResultTableColumn[],
  filters: ResultsViewRowFilter[],
  overrides: Record<string, ResultsViewRowOverride>,
  showAllRows: boolean,
): ResultVariant[] {
  if (showAllRows) return variants
  const columnsById = new Map(columns.map((column) => [column.id, column] as const))
  return variants.filter((variant) => {
    const override = overrides[variant.id]
    if (override === 'include') return true
    if (override === 'exclude') return false
    return filters.every((filter) => {
      const column = columnsById.get(filter.columnId)
      return column ? matchesRowFilter(column.getValue(variant), filter) : true
    })
  })
}

/**
 * Array values match eq/gt/lt when any member matches and neq only when no
 * member equals the target; an empty array behaves like an empty scalar.
 */
export function matchesRowFilter(
  value: ResultValue,
  filter: Pick<ResultsViewRowFilter, 'operator' | 'value'>,
): boolean {
  const values = Array.isArray(value) ? (value.length > 0 ? value : [undefined]) : [value]
  if (filter.operator === 'neq') {
    return values.every((item) => !matchesScalarFilter(item, 'eq', filter.value))
  }
  return values.some((item) => matchesScalarFilter(item, filter.operator, filter.value))
}

export function matchesScalarFilter(
  value: ResultScalar | string | undefined,
  operator: ResultsViewRowFilterOperator,
  target: string,
): boolean {
  const comparison = compareFilterValues(value, target)
  if (comparison === null) return false
  if (operator === 'eq') return comparison === 0
  if (operator === 'neq') return comparison !== 0
  if (operator === 'gt') return comparison > 0
  return comparison < 0
}

/**
 * Sign of `value - target`, or null when incomparable. Empty values equal only
 * an empty target; numbers need a finite numeric target (NaN values compare as
 * incomparable); booleans need `true`/`false`; everything else uses natural
 * collation after turning `<br>` into newlines.
 */
export function compareFilterValues(
  value: ResultScalar | string | undefined,
  target: string,
): number | null {
  if (value === null || value === undefined || value === '') {
    return target === '' ? 0 : null
  }
  if (typeof value === 'number') {
    const numericTarget = Number(target)
    if (!Number.isFinite(numericTarget)) return null
    const difference = value - numericTarget
    return Number.isNaN(difference) ? null : difference
  }
  if (typeof value === 'boolean') {
    const normalizedTarget = target.trim().toLowerCase()
    if (normalizedTarget !== 'true' && normalizedTarget !== 'false') return null
    return Number(value) - Number(normalizedTarget === 'true')
  }
  return naturalCollator.compare(String(value).replace(/<br\s*\/?>/gi, '\n'), target)
}
