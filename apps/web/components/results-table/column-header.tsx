'use client'

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChartSpline,
  Columns3,
  EyeOff,
  Minus,
  Pin,
  PinOff,
  Plus,
  Star,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { sortActionLabel } from '../../lib/experiment-results/format'
import { pinnedOpaqueBackground } from '../../lib/experiment-results/layout'
import { effectiveSotaMode } from '../../lib/experiment-results/sota'
import type { GridItem } from '../../lib/experiment-results/tree'
import type { ResultTableColumn } from '../../lib/experiment-results/types'
import type {
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
import { StatsDisplayMenu } from './stats-display-menu'
import type { DragHandlers } from './use-drag-reorder'

/** Per-column actions offered by the header and its context menu. */
export interface ColumnHeaderActions {
  onCycleSort: (columnId: string) => void
  onHide: (columnId: string) => void
  onSetPinned: (columnId: string, pinned: boolean) => void
  onToggleStar: (label: string) => void
  onSetSotaMode: (columnId: string, mode: ResultsViewSotaMode) => void
  onSetDecimalPlaces: (columnId: string, places: number) => void
  onSetStatsDisplay: (columnId: string, selection: string | null) => void
  onSetStatsSort: (columnId: string, stat: string | null) => void
}

const SOTA_OPTIONS = [
  { mode: 'off', label: 'Off', Icon: Minus },
  { mode: 'higher-is-better', label: 'Higher is better', Icon: ArrowUp },
  { mode: 'lower-is-better', label: 'Lower is better', Icon: ArrowDown },
] as const

/**
 * A sortable column header of the table's second header row (pinned headers
 * span both rows and show their group breadcrumb). Clicking cycles the
 * temporary sort; dragging reorders within the column's group (or the pinned
 * zone); right-clicking opens hide / pin / star and, for metrics, SOTA and
 * decimals. A stats column carries its display dropdown.
 */
export function ColumnHeader({
  item,
  starred,
  pinSticky,
  pinStyle,
  direction,
  canMutate,
  sotaModes,
  decimalPlaces,
  statsDisplay,
  statsSort,
  drag,
  actions,
}: {
  item: Extract<GridItem, { kind: 'column' }>
  starred: boolean
  pinSticky: boolean
  pinStyle: CSSProperties | undefined
  /** Active temporary sort direction on this column, if any. */
  direction: ResultsViewSortDirection | null
  canMutate: boolean
  sotaModes: Readonly<Record<string, ResultsViewSotaMode>>
  decimalPlaces: number
  statsDisplay: string | null
  statsSort: string | null
  drag: DragHandlers
  actions: ColumnHeaderActions
}) {
  const column: ResultTableColumn = item.column
  const metric = column.metric
  const isVariant = column.kind === 'variant'
  const dragItem = item.pinned
    ? ({ kind: 'pinned', id: column.id, scope: item.scope } as const)
    : ({ kind: 'column', id: column.id, scope: item.scope } as const)
  const label = item.headerLabel
  const unit = column.result?.unit
  const description = column.result?.description
  const sotaMode = effectiveSotaMode(column, sotaModes)
  const declaredDirection = column.result?.direction ?? null
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <TableHead
          rowSpan={item.pinned ? 2 : undefined}
          aria-sort={
            direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'
          }
          className={cn(
            'border-r px-1 last:border-r-0',
            !isVariant && 'cursor-grab active:cursor-grabbing',
            pinSticky && 'sticky z-20',
            metric && 'bg-sky-50/90 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100',
            starred && 'bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100',
            pinSticky && pinnedOpaqueBackground(metric, starred, 'header'),
            drag.isDragged(dragItem) && 'opacity-50',
            drag.isDropTarget(dragItem) && 'outline-2 -outline-offset-2 outline-primary/60',
          )}
          style={pinStyle}
          {...(isVariant ? {} : drag.bind(dragItem))}
          title={
            description === undefined && !isVariant
              ? `Drag ${column.label} to reorder within its group`
              : undefined
          }
          data-column-id={column.id}
          data-column-group={metric ? 'metric' : column.kind === 'result' ? 'parameter' : undefined}
          data-pinned={item.pinned ? 'left' : undefined}
          data-pin-sticky={pinSticky || undefined}
        >
          <span className="flex min-w-0 items-center">
            <AnnotationTooltip
              description={description}
              label={`${column.label} column description`}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => actions.onCycleSort(column.id)}
                className="min-w-0 justify-start px-1.5"
                aria-label={`${label}: ${sortActionLabel(direction)}`}
                data-has-description={description !== undefined || undefined}
              >
                {metric && (
                  <ChartSpline
                    className="size-3 shrink-0 text-sky-600 dark:text-sky-300"
                    aria-hidden
                  />
                )}
                {item.pinned && !isVariant && (
                  <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate" data-column-label>
                  {label}
                </span>
                {unit && (
                  <span className="shrink-0 font-normal text-muted-foreground" data-column-unit>
                    ({unit})
                  </span>
                )}
                {metric && <span className="sr-only">Metric column</span>}
                <SortIcon direction={direction} />
              </Button>
            </AnnotationTooltip>
            {column.statOptions.length > 0 && (
              <StatsDisplayMenu
                label={column.label}
                statOptions={column.statOptions}
                display={statsDisplay}
                defaultDisplay={column.result?.display ?? null}
                sortStat={statsSort}
                disabled={!canMutate}
                onSelectDisplay={(selection) => actions.onSetStatsDisplay(column.id, selection)}
                onSelectSort={(stat) => actions.onSetStatsSort(column.id, stat)}
              />
            )}
          </span>
        </TableHead>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="truncate">{label}</ContextMenuLabel>
        {!isVariant && (
          <>
            <ContextMenuItem disabled={!canMutate} onSelect={() => actions.onHide(column.id)}>
              <EyeOff />
              Hide column
            </ContextMenuItem>
            <ContextMenuSeparator />
            {item.pinned ? (
              <ContextMenuItem
                disabled={!canMutate}
                onSelect={() => actions.onSetPinned(column.id, false)}
              >
                <PinOff />
                Unpin column
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                disabled={!canMutate}
                onSelect={() => actions.onSetPinned(column.id, true)}
              >
                <Pin />
                Pin column
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
          </>
        )}
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
              <ContextMenuSubContent className="w-48">
                {declaredDirection
                  ? [
                      <ContextMenuItem
                        key="off"
                        onSelect={() => actions.onSetSotaMode(column.id, 'off')}
                        disabled={!canMutate || sotaMode === 'off'}
                      >
                        <Minus className="mr-2 size-4" />
                        Off
                      </ContextMenuItem>,
                      <ContextMenuItem
                        key="on"
                        onSelect={() =>
                          actions.onSetSotaMode(
                            column.id,
                            declaredDirection === 'higher' ? 'higher-is-better' : 'lower-is-better',
                          )
                        }
                        disabled={!canMutate || sotaMode !== 'off'}
                      >
                        {declaredDirection === 'higher' ? (
                          <ArrowUp className="mr-2 size-4" />
                        ) : (
                          <ArrowDown className="mr-2 size-4" />
                        )}
                        {declaredDirection === 'higher' ? 'Higher is better' : 'Lower is better'}{' '}
                        (declared)
                      </ContextMenuItem>,
                    ]
                  : SOTA_OPTIONS.map(({ mode, label: optionLabel, Icon }) => (
                      <ContextMenuItem
                        key={mode}
                        onSelect={() => actions.onSetSotaMode(column.id, mode)}
                        disabled={!canMutate || sotaMode === mode}
                      >
                        <Icon className="mr-2 size-4" />
                        {optionLabel}
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
