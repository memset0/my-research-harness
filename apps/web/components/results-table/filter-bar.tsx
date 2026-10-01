'use client'

import { ArrowUpDown, Eye, Rows3, X } from 'lucide-react'
import { sortDirectionSymbol } from '../../lib/experiment-results/format'
import type { SortKey } from '../../lib/experiment-results/sorting'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type { ResultsViewRowFilter, ResultsViewSortRule } from '../../lib/experiment-results/views'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Toggle } from '../ui/toggle'
import { lockedGroupProps } from './locked-group'
import { RowFilterBadgeEditor } from './row-filter-badge-editor'
import { SortBadgeEditor } from './sort-badge-editor'
import type { DragHandlers } from './use-drag-reorder'

const DRAGGABLE_BADGE = 'm-0 min-w-0 cursor-grab rounded-full border-0 p-0 active:cursor-grabbing'
const DROP_RING = 'ring-2 ring-primary/60 ring-offset-1 ring-offset-background'

/**
 * Row controls: shown-row summary, temporary show-all, the ordered AND row
 * filter badges, the ordered default-sort badges, and the active temporary
 * header sort.
 */
export function FilterBar({
  experimentId,
  locked,
  shownRowCount,
  totalRowCount,
  columns,
  domains,
  rowFilters,
  rowOverrideCount,
  showAllRows,
  onShowAllRowsChange,
  defaultSortRules,
  temporarySort,
  temporarySortLabel,
  drag,
  onSaveFilter,
  onRemoveFilter,
  onSaveSort,
  onRemoveSort,
  onMoveSort,
  onClearTemporarySort,
}: {
  experimentId: string
  locked: boolean
  shownRowCount: number
  totalRowCount: number
  /** Every column in saved order (hidden ones can be filtered too). */
  columns: ResultTableColumn[]
  domains: ReadonlyMap<string, string[]>
  rowFilters: ResultsViewRowFilter[]
  rowOverrideCount: number
  showAllRows: boolean
  onShowAllRowsChange: (value: boolean) => void
  defaultSortRules: ResultsViewSortRule[]
  temporarySort: SortKey | null
  temporarySortLabel: string | undefined
  drag: DragHandlers
  /** `filterId` is absent when adding a new filter. */
  onSaveFilter: (filter: Omit<ResultsViewRowFilter, 'id'>, filterId?: string) => void
  onRemoveFilter: (filterId: string) => void
  /** `ruleId` is absent when adding a new sort rule. */
  onSaveSort: (rule: Omit<ResultsViewSortRule, 'id'>, ruleId?: string) => void
  onRemoveSort: (ruleId: string) => void
  onMoveSort: (ruleId: string, offset: -1 | 1) => void
  onClearTemporarySort: () => void
}) {
  const lockedProps = lockedGroupProps(locked)
  const usedSortColumns = new Set(defaultSortRules.map((rule) => rule.columnId))
  return (
    <div
      {...lockedProps}
      className={cn('space-y-2.5', lockedProps.className)}
      data-slot="row-filter-controls"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Rows3 className="size-3.5 text-muted-foreground" aria-hidden />
          Rows
        </div>
        <Badge variant="secondary" className="tabular-nums">
          {shownRowCount}/{totalRowCount} shown
        </Badge>
        {rowFilters.length > 0 && (
          <Badge variant="outline" className="tabular-nums">
            {rowFilters.length} {rowFilters.length === 1 ? 'filter' : 'filters'}
          </Badge>
        )}
        {rowOverrideCount > 0 && (
          <Badge variant="outline" className="tabular-nums">
            {rowOverrideCount} {rowOverrideCount === 1 ? 'override' : 'overrides'}
          </Badge>
        )}
        {showAllRows && (rowFilters.length > 0 || rowOverrideCount > 0) && (
          <Badge variant="outline">Saved row filters · paused</Badge>
        )}
        <Toggle
          variant="outline"
          size="sm"
          pressed={showAllRows}
          onPressedChange={onShowAllRowsChange}
          aria-label={showAllRows ? 'Resume saved row filters' : 'Show all rows temporarily'}
        >
          <Eye data-icon="inline-start" />
          {showAllRows ? 'Resume row filters' : 'Show all temporarily'}
        </Toggle>
      </div>

      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">Row filters</legend>
        {rowFilters.map((filter, index) => {
          const dragItem = { kind: 'row-filter', id: filter.id } as const
          return (
            <fieldset
              key={filter.id}
              {...drag.bind(dragItem)}
              aria-label={`Row filter priority ${index + 1}`}
              className={cn(
                DRAGGABLE_BADGE,
                drag.isDragged(dragItem) && 'opacity-50',
                drag.isDropTarget(dragItem) && DROP_RING,
              )}
              title={`Drag filter priority ${index + 1} to reorder`}
              data-row-filter-order={filter.id}
            >
              <RowFilterBadgeEditor
                filter={filter}
                priority={index + 1}
                columns={columns}
                domains={domains}
                experimentId={experimentId}
                paused={showAllRows}
                onSave={(next) => onSaveFilter(next, filter.id)}
                onDelete={() => onRemoveFilter(filter.id)}
              />
            </fieldset>
          )
        })}
        <RowFilterBadgeEditor
          columns={columns}
          domains={domains}
          experimentId={experimentId}
          paused={showAllRows}
          onSave={(next) => onSaveFilter(next)}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-1.5" data-slot="default-sort-controls">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
          <ArrowUpDown className="size-3" aria-hidden />
          Default sort
        </span>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Default sort priority</legend>
          {defaultSortRules.map((rule, index) => {
            const dragItem = { kind: 'sort-rule', id: rule.id } as const
            return (
              <fieldset
                key={rule.id}
                {...drag.bind(dragItem)}
                aria-label={`Default sort priority ${index + 1}`}
                className={cn(
                  DRAGGABLE_BADGE,
                  drag.isDragged(dragItem) && 'opacity-50',
                  drag.isDropTarget(dragItem) && DROP_RING,
                )}
                title={`Drag sort priority ${index + 1} to reorder`}
                data-sort-rule-order={rule.id}
              >
                <SortBadgeEditor
                  rule={rule}
                  priority={index + 1}
                  columns={columns}
                  usedColumnIds={usedSortColumns}
                  experimentId={experimentId}
                  canMoveEarlier={index > 0}
                  canMoveLater={index < defaultSortRules.length - 1}
                  onSave={(next) => onSaveSort(next, rule.id)}
                  onDelete={() => onRemoveSort(rule.id)}
                  onMoveEarlier={() => onMoveSort(rule.id, -1)}
                  onMoveLater={() => onMoveSort(rule.id, 1)}
                />
              </fieldset>
            )
          })}
          <SortBadgeEditor
            columns={columns}
            usedColumnIds={usedSortColumns}
            experimentId={experimentId}
            priority={defaultSortRules.length + 1}
            onSave={(next) => onSaveSort(next)}
          />
        </fieldset>
        <Badge variant="secondary" className="font-mono">
          {defaultSortRules.length > 0 && 'then '}Variant ↑
        </Badge>
        {temporarySort && (
          <Badge className="h-6 gap-1 pl-2" data-temporary-sort>
            Temporary · {temporarySortLabel ?? temporarySort.columnId}{' '}
            {sortDirectionSymbol(temporarySort.direction)}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="-mr-1 size-4 rounded-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              onClick={onClearTemporarySort}
              aria-label="Clear temporary sort"
            >
              <X aria-hidden />
            </Button>
          </Badge>
        )}
      </div>
    </div>
  )
}
