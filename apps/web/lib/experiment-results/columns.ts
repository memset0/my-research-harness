// Column derivation and arrangement for the Results table.

import type { ResultsDocument, ResultsVariantEligibility, ResultVariant } from '@memon/core'
import { displayText, isEmptyValue, naturalCollator } from './format'
import { variantStatusRank } from './status'
import type { ResultTableColumn } from './types'
import type { ResultsViewPinSide } from './views'

/** Run ids excluded from evidence columns (explicit list + per-Variant eligibility). */
export function excludedRunIds(
  deprecatedRuns: readonly string[] | undefined,
  eligibility: readonly ResultsVariantEligibility[] | undefined,
): Set<string> {
  const ids = new Set(deprecatedRuns)
  for (const row of eligibility ?? []) {
    for (const id of row.deprecatedRuns) ids.add(id)
  }
  return ids
}

/**
 * Built-in Variant/Status, then the declared columns in YAML order, then the
 * provenance and evidence columns. Excluded Runs are hidden from Runs/Attempts.
 */
export function buildColumns(
  document: ResultsDocument,
  excludedRuns: ReadonlySet<string> = new Set(),
): ResultTableColumn[] {
  const withoutExcluded = (ids: string[]) =>
    excludedRuns.size === 0 ? ids : ids.filter((id) => !excludedRuns.has(id))
  return [
    {
      id: 'variant',
      label: 'Variant',
      kind: 'variant',
      getValue: (variant) => `${variant.id} ${variant.name}`,
    },
    {
      id: 'status',
      label: 'Status',
      kind: 'status',
      getValue: (variant) => variant.status,
      getSortValue: (variant) => variantStatusRank(variant.status),
    },
    ...document.columns.map(
      (schema): ResultTableColumn => ({
        id: `schema:${schema.key}`,
        label: schema.label,
        kind: 'schema',
        schema,
        annotation: document.columnAnnotations?.[schema.key],
        getValue: (variant) =>
          schema.group === 'parameter'
            ? variant.parameters[schema.key]
            : variant.metrics[schema.key],
      }),
    ),
    {
      id: 'entry',
      label: 'Entry',
      kind: 'entry',
      getValue: (variant) => variant.provenance?.entry,
    },
    {
      id: 'recipe',
      label: 'Recipe',
      kind: 'recipe',
      getValue: (variant) => variant.provenance?.recipe,
    },
    {
      id: 'commit',
      label: 'Commit',
      kind: 'commit',
      getValue: (variant) => variant.provenance?.commit,
    },
    {
      id: 'runs',
      label: 'Runs',
      kind: 'runs',
      getValue: (variant) => withoutExcluded(variant.runs),
    },
    {
      id: 'attempts',
      label: 'Attempts',
      kind: 'attempts',
      getValue: (variant) => withoutExcluded(variant.attempts),
    },
  ]
}

export interface ColumnArrangement {
  columnsById: Map<string, ResultTableColumn>
  /** Every column in the saved order (hidden ones included). */
  orderedColumns: ResultTableColumn[]
  /** Saved order minus hidden columns (unless show-all is on). */
  visibleColumns: ResultTableColumn[]
  /** Rendered header order: pinned-left, unpinned, pinned-right. */
  orderedVisibleColumns: ResultTableColumn[]
  pinnedColumnSide: Map<string, ResultsViewPinSide>
  /** True when the saved order differs from the built-in/YAML order. */
  hasCustomColumnOrder: boolean
}

export function arrangeColumns(
  columns: ResultTableColumn[],
  layout: {
    columnOrderIds: string[]
    hiddenColumnIds: string[]
    pinnedColumnIds: Record<ResultsViewPinSide, string[]>
  },
  showAllColumns: boolean,
): ColumnArrangement {
  const columnsById = new Map(columns.map((column) => [column.id, column] as const))
  const resolve = (ids: string[]) =>
    ids
      .map((id) => columnsById.get(id))
      .filter((column): column is ResultTableColumn => column !== undefined)
  const hidden = showAllColumns ? new Set<string>() : new Set(layout.hiddenColumnIds)
  const pinnedColumnSide = new Map<string, ResultsViewPinSide>([
    ...layout.pinnedColumnIds.left.map((id) => [id, 'left'] as const),
    ...layout.pinnedColumnIds.right.map((id) => [id, 'right'] as const),
  ])
  const orderedColumns = resolve(layout.columnOrderIds)
  const visibleColumns = orderedColumns.filter((column) => !hidden.has(column.id))
  const orderedVisibleColumns = [
    ...resolve(layout.pinnedColumnIds.left).filter((column) => !hidden.has(column.id)),
    ...visibleColumns.filter((column) => !pinnedColumnSide.has(column.id)),
    ...resolve(layout.pinnedColumnIds.right).filter((column) => !hidden.has(column.id)),
  ]
  return {
    columnsById,
    orderedColumns,
    visibleColumns,
    orderedVisibleColumns,
    pinnedColumnSide,
    hasCustomColumnOrder: layout.columnOrderIds.some(
      (columnId, index) => columnId !== columns[index]?.id,
    ),
  }
}

/** Distinct non-empty display values of a column, natural-sorted. Arrays contribute members. */
export function distinctValues(variants: ResultVariant[], column: ResultTableColumn): string[] {
  const values = new Set<string>()
  for (const variant of variants) {
    const value = column.getValue(variant)
    if (Array.isArray(value)) {
      for (const item of value) values.add(displayText(item))
    } else if (!isEmptyValue(value)) {
      values.add(displayText(value))
    }
  }
  return Array.from(values).sort((left, right) => naturalCollator.compare(left, right))
}

/** The exact `value_descriptions` entry for a scalar cell, if any. */
export function resultValueDescription(
  column: ResultTableColumn,
  variant: ResultVariant,
): string | undefined {
  const descriptions = column.annotation?.valueDescriptions
  if (!descriptions) return undefined
  const value = column.getValue(variant)
  if (value === null || value === undefined || Array.isArray(value)) return undefined
  return descriptions[String(value)]
}
