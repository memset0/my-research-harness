'use client'

import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  ArrowUpDown,
  ChartSpline,
  Columns3,
  EyeOff,
  Minus,
  PinOff,
  Plus,
  Star,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { sortActionLabel } from '../../lib/experiment-results/format'
import { pinnedOpaqueBackground } from '../../lib/experiment-results/layout'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type {
  ResultsViewPinSide,
  ResultsViewSortDirection,
  ResultsViewSotaMode,
} from '../../lib/experiment-results/views'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu'
import { TableHead } from '../ui/table'
import { AnnotationTooltip } from './annotation-tooltip'
import type { DragHandlers } from './use-drag-reorder'

/** Per-column actions offered by the header and its context menu. */
export interface ColumnHeaderActions {
  onCycleSort: (columnId: string) => void
  onHide: (columnId: string) => void
  onPin: (columnId: string, side: ResultsViewPinSide | null) => void
  onToggleStar: (label: string) => void
  onSetSotaMode: (columnId: string, mode: ResultsViewSotaMode) => void
  onSetDecimalPlaces: (columnId: string, places: number) => void
}

const SOTA_OPTIONS = [
  { mode: 'off', label: 'Off', Icon: Minus },
  { mode: 'higher-is-better', label: 'Higher is better', Icon: ArrowUp },
  { mode: 'lower-is-better', label: 'Lower is better', Icon: ArrowDown },
] as const

/**
 * A sortable, draggable table header. Clicking cycles the temporary sort;
 * right-clicking opens hide / pin / star and, for metrics, SOTA and decimal
 * formatting.
 */
export function ColumnHeader({
  column,
  starred,
  pinSide,
  pinSticky,
  pinStyle,
  direction,
  canMutate,
  sotaMode,
  decimalPlaces,
  drag,
  actions,
}: {
  column: ResultTableColumn
  starred: boolean
  pinSide: ResultsViewPinSide | undefined
  pinSticky: boolean
  pinStyle: CSSProperties | undefined
  /** Active temporary sort direction on this column, if any. */
  direction: ResultsViewSortDirection | null
  canMutate: boolean
  /** Saved SOTA mode; absent means off. */
  sotaMode: ResultsViewSotaMode | undefined
  decimalPlaces: number
  drag: DragHandlers
  actions: ColumnHeaderActions
}) {
  const metric = column.schema?.group === 'metric'
  const dragItem = { kind: 'column', id: column.id } as const
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableHead
          aria-sort={
            direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
          }
          className={cn(
            'cursor-grab border-r px-1 active:cursor-grabbing last:border-r-0',
            pinSticky && 'sticky z-20',
            metric && 'bg-sky-50/90 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100',
            starred && 'bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100',
            pinSticky && pinnedOpaqueBackground(metric, starred, 'header'),
            drag.isDragged(dragItem) && 'opacity-50',
            drag.isDropTarget(dragItem) && 'outline-2 -outline-offset-2 outline-primary/60',
          )}
          style={pinStyle}
          {...drag.bind(dragItem)}
          title={
            column.annotation?.description === undefined
              ? `Drag ${column.label} to reorder columns`
              : undefined
          }
          data-column-id={column.id}
          data-column-group={column.schema?.group}
          data-pinned={pinSide}
          data-pin-sticky={pinSticky || undefined}
        >
          <AnnotationTooltip
            description={column.annotation?.description}
            label={`${column.label} column description`}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => actions.onCycleSort(column.id)}
              className="min-w-0 justify-start px-1.5"
              aria-label={`${column.label}: ${sortActionLabel(direction)}`}
              data-has-description={column.annotation?.description !== undefined || undefined}
            >
              {metric && (
                <ChartSpline
                  className="size-3 shrink-0 text-sky-600 dark:text-sky-300"
                  aria-hidden
                />
              )}
              <span className="truncate" data-column-label>
                {column.label}
              </span>
              {metric && <span className="sr-only">Metric column</span>}
              <SortIcon direction={direction} />
            </Button>
          </AnnotationTooltip>
        </TableHead>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="truncate">{column.label}</ContextMenuLabel>
        <ContextMenuItem disabled={!canMutate} onSelect={() => actions.onHide(column.id)}>
          <EyeOff />
          Hide column
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!canMutate || pinSide === 'left'}
          onSelect={() => actions.onPin(column.id, 'left')}
        >
          <ArrowLeftToLine />
          {pinSide === 'left' ? 'Pinned left' : pinSide === 'right' ? 'Move pin left' : 'Pin left'}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canMutate || pinSide === 'right'}
          onSelect={() => actions.onPin(column.id, 'right')}
        >
          <ArrowRightToLine />
          {pinSide === 'right'
            ? 'Pinned right'
            : pinSide === 'left'
              ? 'Move pin right'
              : 'Pin right'}
        </ContextMenuItem>
        {pinSide && (
          <ContextMenuItem disabled={!canMutate} onSelect={() => actions.onPin(column.id, null)}>
            <PinOff />
            Unpin column
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.onToggleStar(column.label)}>
          <Star className={cn(starred && 'fill-current text-amber-500')} />
          {starred ? 'Unstar column' : 'Star column'}
        </ContextMenuItem>
        {metric && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger
                inset
                disabled={!canMutate}
                className="data-disabled:pointer-events-none data-disabled:opacity-50"
              >
                <ArrowUp className="mr-2 size-4" />
                SOTA highlight
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                {SOTA_OPTIONS.map(({ mode, label, Icon }) => (
                  <ContextMenuItem
                    key={mode}
                    onSelect={() => actions.onSetSotaMode(column.id, mode)}
                    disabled={!canMutate || sotaMode === mode}
                  >
                    <Icon className="mr-2 size-4" />
                    {label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger
                inset
                disabled={!canMutate}
                className="data-disabled:pointer-events-none data-disabled:opacity-50"
              >
                <Columns3 className="mr-2 size-4" />
                Decimal places
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-44">
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-xs text-muted-foreground">
                    {decimalPlaces} decimal place{decimalPlaces === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-5 rounded"
                      aria-label="Decrease decimal places"
                      disabled={!canMutate}
                      onClick={() => actions.onSetDecimalPlaces(column.id, decimalPlaces - 1)}
                    >
                      <Minus className="size-3" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-5 rounded"
                      aria-label="Increase decimal places"
                      disabled={!canMutate}
                      onClick={() => actions.onSetDecimalPlaces(column.id, decimalPlaces + 1)}
                    >
                      <Plus className="size-3" aria-hidden />
                    </Button>
                  </div>
                </div>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SortIcon({ direction }: { direction: ResultsViewSortDirection | null }) {
  if (direction === 'asc') return <ArrowUp data-icon="inline-end" aria-hidden />
  if (direction === 'desc') return <ArrowDown data-icon="inline-end" aria-hidden />
  return <ArrowUpDown data-icon="inline-end" className="opacity-50" aria-hidden />
}
