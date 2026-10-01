'use client'

import type { ResultsVariantEligibility, ResultVariant } from '@memon/core'
import { useRef } from 'react'
import { pinnedColumnStyle } from '../../lib/experiment-results/layout'
import type { SortKey } from '../../lib/experiment-results/sorting'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type {
  ResultsViewRowOverride,
  ResultsViewSotaMode,
} from '../../lib/experiment-results/views'
import { Table, TableBody, TableHeader, TableRow } from '../ui/table'
import { ColumnHeader, type ColumnHeaderActions } from './column-header'
import { type ResultCellContext, ResultRow } from './result-row'
import type { DragHandlers } from './use-drag-reorder'
import { usePinLayout } from './use-pin-layout'

/**
 * The Results table itself: draggable, sortable headers (pinned-left,
 * unpinned, pinned-right) over the filtered and sorted Variant rows.
 */
export function ResultsGrid({
  columns,
  variants,
  context,
  eligibilityByVariant,
  rowOverrides,
  temporarySort,
  sotaModes,
  canMutate,
  drag,
  headerActions,
  onSetRowOverride,
}: {
  /** Visible columns in rendered order. */
  columns: ResultTableColumn[]
  variants: ResultVariant[]
  context: Omit<ResultCellContext, 'pinLayout'>
  eligibilityByVariant: ReadonlyMap<string, ResultsVariantEligibility>
  rowOverrides: Readonly<Record<string, ResultsViewRowOverride>>
  temporarySort: SortKey | null
  sotaModes: Readonly<Record<string, ResultsViewSotaMode>>
  canMutate: boolean
  drag: DragHandlers
  headerActions: ColumnHeaderActions
  onSetRowOverride: (variantId: string, override: ResultsViewRowOverride | null) => void
}) {
  const tableRef = useRef<HTMLTableElement>(null)
  const pinLayout = usePinLayout(
    tableRef,
    columns
      .map((column) => `${context.pinnedColumnSide.get(column.id) ?? 'center'}:${column.id}`)
      .join('|'),
  )
  const cellContext: ResultCellContext = { ...context, pinLayout }
  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <Table ref={tableRef} className="w-max min-w-full table-auto" data-results-table-grid>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => {
              const pinSide = context.pinnedColumnSide.get(column.id)
              return (
                <ColumnHeader
                  key={column.id}
                  column={column}
                  starred={context.starredLabels.has(column.label)}
                  pinSide={pinSide}
                  pinSticky={Boolean(pinSide && pinLayout.sticky)}
                  pinStyle={pinnedColumnStyle(column.id, pinSide, pinLayout)}
                  direction={temporarySort?.columnId === column.id ? temporarySort.direction : null}
                  canMutate={canMutate}
                  sotaMode={sotaModes[column.id]}
                  decimalPlaces={context.decimalPlaces[column.id] ?? 0}
                  drag={drag}
                  actions={headerActions}
                />
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((variant) => (
            <ResultRow
              key={variant.id}
              variant={variant}
              columns={columns}
              context={cellContext}
              eligibility={eligibilityByVariant.get(variant.id)}
              rowOverride={rowOverrides[variant.id]}
              canMutate={canMutate}
              onSetRowOverride={onSetRowOverride}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
