'use client'

import { ArrowLeftToLine, ArrowRightToLine, Star } from 'lucide-react'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type { ResultsViewPinSide } from '../../lib/experiment-results/views'
import { cn } from '../../lib/utils'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../ui/hover-card'
import { renderTextWithBreaks } from './cells'
import { lockedGroupProps } from './locked-group'
import type { DragHandlers } from './use-drag-reorder'

/**
 * One draggable checkbox chip per column in saved order: visibility, distinct
 * value count (with a value-domain preview for non-metric columns), pin side
 * and the Project-wide star.
 */
export function ColumnOptions({
  experimentId,
  locked,
  columns,
  hiddenColumnIds,
  domains,
  starredLabels,
  pinnedColumnSide,
  drag,
  onVisibleChange,
  onToggleStar,
}: {
  experimentId: string
  locked: boolean
  columns: ResultTableColumn[]
  hiddenColumnIds: ReadonlySet<string>
  domains: ReadonlyMap<string, string[]>
  starredLabels: ReadonlySet<string>
  pinnedColumnSide: ReadonlyMap<string, ResultsViewPinSide>
  drag: DragHandlers
  onVisibleChange: (columnId: string, visible: boolean) => void
  onToggleStar: (label: string) => void
}) {
  const lockedProps = lockedGroupProps(locked)
  return (
    <fieldset {...lockedProps} className={cn('flex flex-wrap gap-1.5', lockedProps.className)}>
      <legend className="sr-only">Visible results columns</legend>
      {columns.map((column, index) => {
        const values = domains.get(column.id) ?? []
        const starred = starredLabels.has(column.label)
        const metric = column.schema?.group === 'metric'
        const pinSide = pinnedColumnSide.get(column.id)
        const dragItem = { kind: 'column', id: column.id } as const
        const summary = (
          <ColumnOptionSummary column={column} pinSide={pinSide} valueCount={values.length} />
        )
        return (
          <fieldset
            key={column.id}
            className={cn(
              'flex h-7 min-w-0 cursor-grab items-center gap-1 rounded-md border bg-card pr-0.5 pl-2 shadow-xs active:cursor-grabbing',
              metric && 'border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20',
              starred &&
                'border-amber-300 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/30',
              drag.isDragged(dragItem) && 'opacity-50',
              drag.isDropTarget(dragItem) &&
                'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
            )}
            {...drag.bind(dragItem)}
            aria-label={`${column.label} column control`}
            title={`Drag ${column.label} to reorder columns`}
            data-column-option={column.id}
            data-column-group={column.schema?.group}
          >
            <Checkbox
              id={`results-column-${experimentId}-${index}`}
              checked={!hiddenColumnIds.has(column.id)}
              onCheckedChange={(checked) => onVisibleChange(column.id, checked === true)}
              aria-label={`Show ${column.label} column`}
            />
            {metric ? (
              summary
            ) : (
              <HoverCard openDelay={250} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1"
                    aria-label={`Inspect distinct values for ${column.label}`}
                  >
                    {summary}
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent align="start" className="w-72 p-3">
                  <div className="mb-2 text-xs font-medium">
                    {column.label} · {values.length} distinct{' '}
                    {values.length === 1 ? 'value' : 'values'}
                  </div>
                  {values.length === 0 ? (
                    <div className="text-xs italic text-muted-foreground">No values</div>
                  ) : (
                    <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
                      {values.map((value) => (
                        <li key={value} className="break-all rounded bg-muted px-2 py-1 font-mono">
                          {renderTextWithBreaks(value)}
                        </li>
                      ))}
                    </ul>
                  )}
                </HoverCardContent>
              </HoverCard>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onToggleStar(column.label)}
              aria-label={`${starred ? 'Unstar' : 'Star'} ${column.label} column`}
              aria-pressed={starred}
              className={cn(starred && 'text-amber-600 hover:text-amber-700 dark:text-amber-300')}
            >
              <Star className={cn(starred && 'fill-current')} aria-hidden />
            </Button>
          </fieldset>
        )
      })}
    </fieldset>
  )
}

function ColumnOptionSummary({
  column,
  pinSide,
  valueCount,
}: {
  column: ResultTableColumn
  pinSide: ResultsViewPinSide | undefined
  valueCount: number
}) {
  return (
    <>
      <span>{column.label}</span>
      {pinSide && (
        <Badge
          variant="secondary"
          className="h-4 gap-0.5 px-1 text-[9px] uppercase"
          aria-label={`Pinned ${pinSide}`}
        >
          {pinSide === 'left' ? (
            <ArrowLeftToLine className="size-2.5" aria-hidden />
          ) : (
            <ArrowRightToLine className="size-2.5" aria-hidden />
          )}
          {pinSide}
        </Badge>
      )}
      <Badge variant="outline" className="h-4 px-1.5 text-[9px] tabular-nums">
        {valueCount}
      </Badge>
    </>
  )
}
