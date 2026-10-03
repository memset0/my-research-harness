'use client'

import { useRef } from 'react'
import { pinnedColumnStyle } from '../../lib/experiment-results/layout'
import type { SortKey } from '../../lib/experiment-results/sorting'
import { bandCells, type GridLayout } from '../../lib/experiment-results/tree'
import type { ResultVariant } from '../../lib/experiment-results/types'
import type {
  ResultsViewRowOverride,
  ResultsViewSotaMode,
} from '../../lib/experiment-results/views'
import { Table, TableBody, TableHeader, TableRow } from '../ui/table'
import { ColumnHeader, type ColumnHeaderActions } from './column-header'
import { CollapsedHeader, GroupHeader } from './group-header'
import { type ResultCellContext, ResultRow } from './result-row'
import type { DragHandlers } from './use-drag-reorder'
import { usePinLayout } from './use-pin-layout'

/**
 * The Results table: a two-row header (first-level group bands over the
 * unpinned zone; pinned headers span both rows with their breadcrumb) over
 * the filtered and sorted Variant rows. The Variant column is always the
 * first pinned column.
 */
export function ResultsGrid({
  layout,
  variants,
  context,
  rowOverrides,
  temporarySort,
  sotaModes,
  statsDisplay,
  statsSort,
  canMutate,
  drag,
  headerActions,
  onToggleCollapsed,
  onSetRowOverride,
}: {
  layout: GridLayout
  variants: ResultVariant[]
  context: Omit<ResultCellContext, 'pinLayout'>
  rowOverrides: Readonly<Record<string, ResultsViewRowOverride>>
  temporarySort: SortKey | null
  sotaModes: Readonly<Record<string, ResultsViewSotaMode>>
  statsDisplay: Readonly<Record<string, string>>
  statsSort: Readonly<Record<string, string>>
  canMutate: boolean
  drag: DragHandlers
  headerActions: ColumnHeaderActions
  onToggleCollapsed: (groupId: string) => void
  onSetRowOverride: (variantId: string, override: ResultsViewRowOverride | null) => void
}) {
  const tableRef = useRef<HTMLTableElement>(null)
  const pinLayout = usePinLayout(
    tableRef,
    [...layout.pinned, ...layout.unpinned].map((item) => item.id).join('|'),
  )
  const cellContext: ResultCellContext = { ...context, pinLayout }
  const items = [...layout.pinned, ...layout.unpinned]
  const header = (item: (typeof items)[number]) =>
    item.kind === 'column' ? (
      <ColumnHeader
        key={item.id}
        item={item}
        starred={context.starredLabels.has(item.column.label)}
        pinSticky={item.pinned && pinLayout.sticky}
        pinStyle={pinnedColumnStyle(item.id, item.pinned, pinLayout)}
        direction={temporarySort?.columnId === item.id ? temporarySort.direction : null}
        canMutate={canMutate}
        sotaModes={sotaModes}
        decimalPlaces={context.decimalPlaces[item.id] ?? item.column.result?.decimals ?? 0}
        statsDisplay={statsDisplay[item.id] ?? null}
        statsSort={statsSort[item.id] ?? null}
        drag={drag}
        actions={headerActions}
      />
    ) : (
      <CollapsedHeader
        key={item.id}
        groupId={item.groupId}
        label={item.label}
        visibleCount={item.visibleCount}
      />
    )
  return (
    <div className="min-w-0 overflow-hidden rounded-md border">
      <Table ref={tableRef} className="w-max min-w-full table-auto" data-results-table-grid>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent" data-header-row="groups">
            {layout.pinned.map(header)}
            {bandCells(layout.unpinned).map((cell) => (
              <GroupHeader
                key={cell.key}
                cell={cell}
                canCollapse={canMutate}
                onToggleCollapsed={onToggleCollapsed}
              />
            ))}
          </TableRow>
          <TableRow className="hover:bg-transparent" data-header-row="columns">
            {layout.unpinned.map(header)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {variants.map((variant) => (
            <ResultRow
              key={variant.id}
              variant={variant}
              items={items}
              context={cellContext}
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
