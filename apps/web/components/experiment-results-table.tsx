'use client'

import type {
  ResultScalar,
  ResultColumn as ResultSchemaColumn,
  ResultsDocument,
  ResultVariant,
  VariantStatus,
} from '@memon/core'
import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  ArrowUpDown,
  Ban,
  ChartSpline,
  CircleCheck,
  Columns3,
  Eye,
  EyeOff,
  Filter,
  PinOff,
  Plus,
  RotateCcw,
  Rows3,
  Star,
  X,
} from 'lucide-react'
import Link from 'next/link'
import {
  type CSSProperties,
  type DragEvent,
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MemberRunSummary } from '../lib/api'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { cn } from '../lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Separator } from './ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Toggle } from './ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

type SortDirection = 'asc' | 'desc'
type PinSide = 'left' | 'right'
type RowFilterOperator = 'eq' | 'neq' | 'gt' | 'lt'
type RowOverride = 'include' | 'exclude'
type DragKind = 'column' | 'row-filter' | 'sort-rule'
type DropEdge = 'before' | 'after'
type ResultValue = ResultScalar | string[] | undefined
type ColumnKind =
  | 'variant'
  | 'status'
  | 'schema'
  | 'entry'
  | 'recipe'
  | 'commit'
  | 'runs'
  | 'attempts'

interface ResultTableColumn {
  id: string
  label: string
  kind: ColumnKind
  schema?: ResultSchemaColumn
  getValue: (variant: ResultVariant) => ResultValue
}

interface ResultsTablePreferences {
  hiddenColumnIds: string[]
  columnOrderIds: string[]
  maxLines: number
  defaultSortRules: SortRule[]
  pinnedColumnIds: Record<PinSide, string[]>
  rowFilters: RowFilter[]
  rowOverrides: Record<string, RowOverride>
}

interface RowFilter {
  id: string
  columnId: string
  operator: RowFilterOperator
  value: string
}

interface SortRule {
  id: string
  columnId: string
  direction: SortDirection
}

interface PinLayout {
  sticky: boolean
  leftOffsets: Record<string, number>
  rightOffsets: Record<string, number>
}

interface DragItem {
  kind: DragKind
  id: string
}

const DEFAULT_PREFERENCES: ResultsTablePreferences = {
  hiddenColumnIds: [],
  columnOrderIds: [],
  maxLines: 1,
  defaultSortRules: [],
  pinnedColumnIds: { left: [], right: [] },
  rowFilters: [],
  rowOverrides: {},
}

const EMPTY_PIN_LAYOUT: PinLayout = { sticky: false, leftOffsets: {}, rightOffsets: {} }

const STATUS_CLASS: Record<VariantStatus, string> = {
  PLANNED:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700/50 dark:bg-slate-900/50 dark:text-slate-300',
  RUNNING:
    'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/50 dark:bg-sky-950/50 dark:text-sky-200',
  COMPLETED:
    'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/40 dark:text-emerald-200',
  FAILED:
    'border-red-300 bg-red-50 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200',
  INCONCLUSIVE:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200',
  DROPPED:
    'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700/50 dark:bg-stone-900/50 dark:text-stone-300',
}

export function ExperimentResultsTable({
  document,
  project,
  experimentId,
  memberRuns,
}: {
  document: ResultsDocument
  project: string
  experimentId: string
  memberRuns: MemberRunSummary[]
}) {
  const columns = useMemo(() => buildColumns(document), [document])
  const preferencesKey = `memon:results-table:${project}:${experimentId}:preferences`
  const starsKey = `memon:results-table:${project}:starred-column-labels`
  const [storedPreferences, setStoredPreferences] = useUserPreferenceState(
    preferencesKey,
    DEFAULT_PREFERENCES,
  )
  const [storedStarredLabels, setStoredStarredLabels] = useUserPreferenceState<string[]>(
    starsKey,
    [],
  )
  const [showAllColumns, setShowAllColumns] = useState(false)
  const [showAllRows, setShowAllRows] = useState(false)
  const [temporarySort, setTemporarySort] = useState<Omit<SortRule, 'id'> | null>(null)
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<DragItem | null>(null)
  const rowFilterSequence = useRef(0)
  const sortRuleSequence = useRef(0)

  const preferences = normalizeResultsTablePreferences(
    storedPreferences,
    columns,
    document.variants,
  )
  const columnsById = new Map(columns.map((column) => [column.id, column] as const))
  const columnOrderIds = preferences.columnOrderIds
  const orderedColumns = columnOrderIds
    .map((id) => columnsById.get(id))
    .filter((column): column is ResultTableColumn => column !== undefined)
  const hasCustomColumnOrder = columnOrderIds.some(
    (columnId, index) => columnId !== columns[index]?.id,
  )
  const hiddenColumnIds = preferences.hiddenColumnIds
  const hiddenColumnSet = new Set(hiddenColumnIds)
  const maxLines = preferences.maxLines
  const defaultSortRules = preferences.defaultSortRules
  const pinnedColumnIds = preferences.pinnedColumnIds
  const rowFilters = preferences.rowFilters
  const rowOverrides = preferences.rowOverrides
  const pinnedColumnSide = new Map<string, PinSide>([
    ...pinnedColumnIds.left.map((id) => [id, 'left'] as const),
    ...pinnedColumnIds.right.map((id) => [id, 'right'] as const),
  ])
  const starredLabels = Array.isArray(storedStarredLabels)
    ? storedStarredLabels.filter((label): label is string => typeof label === 'string')
    : []
  const starredLabelSet = new Set(starredLabels)
  const effectiveHiddenColumnSet = showAllColumns ? new Set<string>() : hiddenColumnSet
  const visibleColumns = orderedColumns.filter((column) => !effectiveHiddenColumnSet.has(column.id))
  const orderedVisibleColumns = [
    ...pinnedColumnIds.left
      .map((id) => columnsById.get(id))
      .filter((column): column is ResultTableColumn => column !== undefined)
      .filter((column) => !effectiveHiddenColumnSet.has(column.id)),
    ...visibleColumns.filter((column) => !pinnedColumnSide.has(column.id)),
    ...pinnedColumnIds.right
      .map((id) => columnsById.get(id))
      .filter((column): column is ResultTableColumn => column !== undefined)
      .filter((column) => !effectiveHiddenColumnSet.has(column.id)),
  ]
  const tableRef = useRef<HTMLTableElement>(null)
  const [pinLayout, setPinLayout] = useState<PinLayout>(EMPTY_PIN_LAYOUT)
  const pinLayoutKey = orderedVisibleColumns
    .map((column) => `${pinnedColumnSide.get(column.id) ?? 'center'}:${column.id}`)
    .join('|')
  const memberRunsById = useMemo(
    () => new Map(memberRuns.map((run) => [run.id, run] as const)),
    [memberRuns],
  )

  const domains = useMemo(
    () =>
      new Map(
        columns.map((column) => [column.id, distinctValues(document.variants, column)] as const),
      ),
    [columns, document.variants],
  )
  const filteredVariants = useMemo(
    () => filterVariants(document.variants, columns, rowFilters, rowOverrides, showAllRows),
    [columns, document.variants, rowFilters, rowOverrides, showAllRows],
  )
  const sortedVariants = useMemo(
    () =>
      sortVariants(
        filteredVariants,
        columns,
        temporarySort
          ? [
              temporarySort,
              ...defaultSortRules.filter((rule) => rule.columnId !== temporarySort.columnId),
            ]
          : defaultSortRules,
      ),
    [columns, defaultSortRules, filteredVariants, temporarySort],
  )
  const hasVisibleRows = filteredVariants.length > 0

  const updatePreferences = (
    update:
      | Partial<ResultsTablePreferences>
      | ((current: ResultsTablePreferences) => ResultsTablePreferences),
  ) => {
    setStoredPreferences((stored) => {
      const current = normalizeResultsTablePreferences(stored, columns, document.variants)
      return typeof update === 'function' ? update(current) : { ...current, ...update }
    })
  }

  const reorderColumns = (sourceId: string, targetId: string, edge: DropEdge) => {
    updatePreferences((current) => {
      const nextOrder = reorderIds(current.columnOrderIds, sourceId, targetId, edge)
      if (nextOrder === current.columnOrderIds) return current
      const pinnedLeft = new Set(current.pinnedColumnIds.left)
      const pinnedRight = new Set(current.pinnedColumnIds.right)
      return {
        ...current,
        columnOrderIds: nextOrder,
        pinnedColumnIds: {
          left: nextOrder.filter((id) => pinnedLeft.has(id)),
          right: nextOrder.filter((id) => pinnedRight.has(id)),
        },
      }
    })
  }

  const reorderRowFilters = (sourceId: string, targetId: string, edge: DropEdge) => {
    updatePreferences((current) => {
      const next = reorderItems(current.rowFilters, sourceId, targetId, edge)
      return next === current.rowFilters ? current : { ...current, rowFilters: next }
    })
  }

  const reorderDefaultSortRules = (sourceId: string, targetId: string, edge: DropEdge) => {
    setTemporarySort(null)
    updatePreferences((current) => {
      const next = reorderItems(current.defaultSortRules, sourceId, targetId, edge)
      return next === current.defaultSortRules ? current : { ...current, defaultSortRules: next }
    })
  }

  const startDrag = (event: DragEvent<HTMLElement>, item: DragItem) => {
    setDraggedItem(item)
    setDropTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`)
  }

  const dragOver = (event: DragEvent<HTMLElement>, item: DragItem) => {
    if (!draggedItem || draggedItem.kind !== item.kind || draggedItem.id === item.id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget((current) =>
      current?.kind === item.kind && current.id === item.id ? current : item,
    )
  }

  const drop = (event: DragEvent<HTMLElement>, item: DragItem) => {
    event.preventDefault()
    if (draggedItem?.kind === item.kind && draggedItem.id !== item.id) {
      const edge = dropEdge(event)
      if (item.kind === 'column') reorderColumns(draggedItem.id, item.id, edge)
      else if (item.kind === 'row-filter') reorderRowFilters(draggedItem.id, item.id, edge)
      else reorderDefaultSortRules(draggedItem.id, item.id, edge)
    }
    setDraggedItem(null)
    setDropTarget(null)
  }

  const endDrag = () => {
    setDraggedItem(null)
    setDropTarget(null)
  }

  const isDragged = (kind: DragKind, id: string) =>
    draggedItem?.kind === kind && draggedItem.id === id

  const isDropTarget = (kind: DragKind, id: string) =>
    dropTarget?.kind === kind && dropTarget.id === id

  const setColumnVisible = (columnId: string, visible: boolean) => {
    updatePreferences((current) => {
      const next = new Set(current.hiddenColumnIds)
      if (visible) next.delete(columnId)
      else next.add(columnId)
      return { ...current, hiddenColumnIds: Array.from(next) }
    })
  }

  const toggleStar = (label: string) => {
    setStoredStarredLabels((current) => {
      const next = new Set(
        Array.isArray(current)
          ? current.filter((candidate): candidate is string => typeof candidate === 'string')
          : [],
      )
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return Array.from(next)
    })
  }

  const setColumnPin = (columnId: string, side: PinSide | null) => {
    updatePreferences((current) => {
      const next = {
        left: current.pinnedColumnIds.left.filter((id) => id !== columnId),
        right: current.pinnedColumnIds.right.filter((id) => id !== columnId),
      }
      if (side) next[side].push(columnId)
      return { ...current, pinnedColumnIds: next }
    })
  }

  const saveRowFilter = (filter: Omit<RowFilter, 'id'>, filterId?: string) => {
    if (filterId) {
      updatePreferences((current) => {
        return {
          ...current,
          rowFilters: current.rowFilters.map((candidate) =>
            candidate.id === filterId ? { id: filterId, ...filter } : candidate,
          ),
        }
      })
      return
    }
    updatePreferences((current) => {
      return {
        ...current,
        rowFilters: [
          ...current.rowFilters,
          { id: `filter-${Date.now()}-${rowFilterSequence.current++}`, ...filter },
        ],
      }
    })
  }

  const removeRowFilter = (filterId: string) => {
    updatePreferences((current) => ({
      ...current,
      rowFilters: current.rowFilters.filter((filter) => filter.id !== filterId),
    }))
  }

  const setRowOverride = (variantId: string, override: RowOverride | null) => {
    updatePreferences((current) => {
      const next = { ...current.rowOverrides }
      if (override) next[variantId] = override
      else delete next[variantId]
      return { ...current, rowOverrides: next }
    })
  }

  const saveDefaultSortRule = (rule: Omit<SortRule, 'id'>, sortRuleId?: string) => {
    setTemporarySort(null)
    if (sortRuleId) {
      updatePreferences((current) => {
        return {
          ...current,
          defaultSortRules: current.defaultSortRules
            .map((candidate) =>
              candidate.id === sortRuleId ? { id: sortRuleId, ...rule } : candidate,
            )
            .filter(
              (candidate, index, rules) =>
                rules.findIndex((item) => item.columnId === candidate.columnId) === index,
            ),
        }
      })
      return
    }
    updatePreferences((current) => {
      return {
        ...current,
        defaultSortRules: [
          ...current.defaultSortRules,
          { id: `sort-${Date.now()}-${sortRuleSequence.current++}`, ...rule },
        ],
      }
    })
  }

  const removeDefaultSortRule = (sortRuleId: string) => {
    setTemporarySort(null)
    updatePreferences((current) => ({
      ...current,
      defaultSortRules: current.defaultSortRules.filter((rule) => rule.id !== sortRuleId),
    }))
  }

  const moveDefaultSortRule = (sortRuleId: string, offset: -1 | 1) => {
    setTemporarySort(null)
    updatePreferences((current) => {
      const index = current.defaultSortRules.findIndex((rule) => rule.id === sortRuleId)
      const targetIndex = index + offset
      if (index < 0 || targetIndex < 0 || targetIndex >= current.defaultSortRules.length) {
        return current
      }
      const next = [...current.defaultSortRules]
      const moved = next.splice(index, 1)[0]
      if (!moved) return current
      next.splice(targetIndex, 0, moved)
      return { ...current, defaultSortRules: next }
    })
  }

  const cycleSort = (columnId: string) => {
    if (!temporarySort || temporarySort.columnId !== columnId) {
      setTemporarySort({ columnId, direction: 'asc' })
      return
    }
    if (temporarySort.direction === 'asc') {
      setTemporarySort({ columnId, direction: 'desc' })
      return
    }
    setTemporarySort(null)
  }

  const resetView = () => {
    setStoredPreferences(DEFAULT_PREFERENCES)
    setShowAllColumns(false)
    setShowAllRows(false)
    setTemporarySort(null)
  }

  useLayoutEffect(() => {
    // The identity changes when pin side, pin order, or visible columns change.
    void pinLayoutKey
    void hasVisibleRows
    const table = tableRef.current
    const container = table?.parentElement
    if (!table || !container) return

    const measure = () => {
      const headers = Array.from(table.querySelectorAll<HTMLElement>('thead [data-column-id]'))
      const leftHeaders = headers.filter((header) => header.dataset.pinned === 'left')
      const rightHeaders = headers.filter((header) => header.dataset.pinned === 'right')
      const pinnedWidth = [...leftHeaders, ...rightHeaders].reduce(
        (total, header) => total + header.getBoundingClientRect().width,
        0,
      )
      const sticky = pinnedWidth > 0 && pinnedWidth < container.clientWidth
      const leftOffsets: Record<string, number> = {}
      const rightOffsets: Record<string, number> = {}

      let left = 0
      for (const header of leftHeaders) {
        const columnId = header.dataset.columnId
        if (columnId) leftOffsets[columnId] = left
        left += header.getBoundingClientRect().width
      }

      let right = 0
      for (const header of [...rightHeaders].reverse()) {
        const columnId = header.dataset.columnId
        if (columnId) rightOffsets[columnId] = right
        right += header.getBoundingClientRect().width
      }

      const next = { sticky, leftOffsets, rightOffsets }
      setPinLayout((current) => (samePinLayout(current, next) ? current : next))
    }

    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(container)
    for (const header of table.querySelectorAll<HTMLElement>('thead [data-column-id]')) {
      observer?.observe(header)
    }
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [pinLayoutKey, hasVisibleRows])

  return (
    <div className="min-w-0 space-y-3" data-slot="results-table">
      <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-slot="results-controls">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Columns3 className="size-3.5 text-muted-foreground" aria-hidden />
            Columns
          </div>
          <Badge variant="secondary" className="tabular-nums">
            {visibleColumns.length}/{columns.length} shown
          </Badge>
          {showAllColumns && hiddenColumnIds.length > 0 && (
            <Badge variant="outline">{hiddenColumnIds.length} saved hidden · paused</Badge>
          )}
          <Toggle
            variant="outline"
            size="sm"
            pressed={showAllColumns}
            onPressedChange={setShowAllColumns}
            aria-label={
              showAllColumns ? 'Resume saved column filters' : 'Show all columns temporarily'
            }
          >
            <Eye data-icon="inline-start" />
            {showAllColumns ? 'Resume column filters' : 'Show all temporarily'}
          </Toggle>
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor={`results-max-lines-${experimentId}`} className="text-muted-foreground">
              Max lines
            </Label>
            <Input
              id={`results-max-lines-${experimentId}`}
              type="number"
              min={1}
              step={1}
              value={maxLines}
              onChange={(event) =>
                updatePreferences({ maxLines: normalizeMaxLines(Number(event.target.value)) })
              }
              className="w-16 tabular-nums"
              aria-label="Maximum lines per results cell"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetView}
              disabled={
                hiddenColumnIds.length === 0 &&
                !hasCustomColumnOrder &&
                maxLines === 1 &&
                defaultSortRules.length === 0 &&
                temporarySort === null &&
                pinnedColumnIds.left.length === 0 &&
                pinnedColumnIds.right.length === 0 &&
                rowFilters.length === 0 &&
                Object.keys(rowOverrides).length === 0 &&
                !showAllColumns &&
                !showAllRows
              }
            >
              <RotateCcw data-icon="inline-start" />
              Reset view
            </Button>
          </div>
        </div>

        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Visible results columns</legend>
          {orderedColumns.map((column, index) => {
            const values = domains.get(column.id) ?? []
            const starred = starredLabelSet.has(column.label)
            const metric = column.schema?.group === 'metric'
            const pinSide = pinnedColumnSide.get(column.id)
            const checkboxId = `results-column-${experimentId}-${index}`
            return (
              <fieldset
                key={column.id}
                className={cn(
                  'flex h-7 min-w-0 cursor-grab items-center gap-1 rounded-md border bg-card pr-0.5 pl-2 shadow-xs active:cursor-grabbing',
                  metric && 'border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20',
                  starred &&
                    'border-amber-300 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/30',
                  isDragged('column', column.id) && 'opacity-50',
                  isDropTarget('column', column.id) &&
                    'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
                )}
                draggable
                onDragStart={(event) => startDrag(event, { kind: 'column', id: column.id })}
                onDragOver={(event) => dragOver(event, { kind: 'column', id: column.id })}
                onDrop={(event) => drop(event, { kind: 'column', id: column.id })}
                onDragEnd={endDrag}
                aria-label={`${column.label} column control`}
                title={`Drag ${column.label} to reorder columns`}
                data-column-option={column.id}
                data-column-group={column.schema?.group}
              >
                <Checkbox
                  id={checkboxId}
                  checked={!hiddenColumnSet.has(column.id)}
                  onCheckedChange={(checked) => setColumnVisible(column.id, checked === true)}
                  aria-label={`Show ${column.label} column`}
                />
                {metric ? (
                  <div className="flex h-6 items-center gap-1 px-1 text-xs font-medium">
                    <ColumnOptionSummary
                      column={column}
                      pinSide={pinSide}
                      valueCount={values.length}
                    />
                  </div>
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
                        <ColumnOptionSummary
                          column={column}
                          pinSide={pinSide}
                          valueCount={values.length}
                        />
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
                            <li
                              key={value}
                              className="break-all rounded bg-muted px-2 py-1 font-mono"
                            >
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
                  onClick={() => toggleStar(column.label)}
                  aria-label={`${starred ? 'Unstar' : 'Star'} ${column.label} column`}
                  aria-pressed={starred}
                  className={cn(
                    starred && 'text-amber-600 hover:text-amber-700 dark:text-amber-300',
                  )}
                >
                  <Star className={cn(starred && 'fill-current')} aria-hidden />
                </Button>
              </fieldset>
            )
          })}
        </fieldset>
        <Separator />

        <div className="space-y-2.5" data-slot="row-filter-controls">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Rows3 className="size-3.5 text-muted-foreground" aria-hidden />
              Rows
            </div>
            <Badge variant="secondary" className="tabular-nums">
              {filteredVariants.length}/{document.variants.length} shown
            </Badge>
            {rowFilters.length > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {rowFilters.length} {rowFilters.length === 1 ? 'filter' : 'filters'}
              </Badge>
            )}
            {Object.keys(rowOverrides).length > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {Object.keys(rowOverrides).length}{' '}
                {Object.keys(rowOverrides).length === 1 ? 'override' : 'overrides'}
              </Badge>
            )}
            {showAllRows && (rowFilters.length > 0 || Object.keys(rowOverrides).length > 0) && (
              <Badge variant="outline">Saved row filters · paused</Badge>
            )}
            <Toggle
              variant="outline"
              size="sm"
              pressed={showAllRows}
              onPressedChange={setShowAllRows}
              aria-label={showAllRows ? 'Resume saved row filters' : 'Show all rows temporarily'}
            >
              <Eye data-icon="inline-start" />
              {showAllRows ? 'Resume row filters' : 'Show all temporarily'}
            </Toggle>
          </div>

          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">Row filters</legend>
            {rowFilters.map((filter, index) => (
              <fieldset
                key={filter.id}
                draggable
                onDragStart={(event) => startDrag(event, { kind: 'row-filter', id: filter.id })}
                onDragOver={(event) => dragOver(event, { kind: 'row-filter', id: filter.id })}
                onDrop={(event) => drop(event, { kind: 'row-filter', id: filter.id })}
                onDragEnd={endDrag}
                aria-label={`Row filter priority ${index + 1}`}
                className={cn(
                  'm-0 min-w-0 cursor-grab rounded-full border-0 p-0 active:cursor-grabbing',
                  isDragged('row-filter', filter.id) && 'opacity-50',
                  isDropTarget('row-filter', filter.id) &&
                    'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
                )}
                title={`Drag filter priority ${index + 1} to reorder`}
                data-row-filter-order={filter.id}
              >
                <RowFilterBadgeEditor
                  filter={filter}
                  priority={index + 1}
                  columns={orderedColumns}
                  domains={domains}
                  experimentId={experimentId}
                  paused={showAllRows}
                  onSave={(next) => saveRowFilter(next, filter.id)}
                  onDelete={() => removeRowFilter(filter.id)}
                />
              </fieldset>
            ))}
            <RowFilterBadgeEditor
              columns={orderedColumns}
              domains={domains}
              experimentId={experimentId}
              paused={showAllRows}
              onSave={saveRowFilter}
            />
          </fieldset>

          <div className="flex flex-wrap items-center gap-1.5" data-slot="default-sort-controls">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
              <ArrowUpDown className="size-3" aria-hidden />
              Default sort
            </span>
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="sr-only">Default sort priority</legend>
              {defaultSortRules.map((rule, index) => (
                <fieldset
                  key={rule.id}
                  draggable
                  onDragStart={(event) => startDrag(event, { kind: 'sort-rule', id: rule.id })}
                  onDragOver={(event) => dragOver(event, { kind: 'sort-rule', id: rule.id })}
                  onDrop={(event) => drop(event, { kind: 'sort-rule', id: rule.id })}
                  onDragEnd={endDrag}
                  aria-label={`Default sort priority ${index + 1}`}
                  className={cn(
                    'm-0 min-w-0 cursor-grab rounded-full border-0 p-0 active:cursor-grabbing',
                    isDragged('sort-rule', rule.id) && 'opacity-50',
                    isDropTarget('sort-rule', rule.id) &&
                      'ring-2 ring-primary/60 ring-offset-1 ring-offset-background',
                  )}
                  title={`Drag sort priority ${index + 1} to reorder`}
                  data-sort-rule-order={rule.id}
                >
                  <SortBadgeEditor
                    rule={rule}
                    priority={index + 1}
                    columns={orderedColumns}
                    usedColumnIds={new Set(defaultSortRules.map((candidate) => candidate.columnId))}
                    experimentId={experimentId}
                    canMoveEarlier={index > 0}
                    canMoveLater={index < defaultSortRules.length - 1}
                    onSave={(next) => saveDefaultSortRule(next, rule.id)}
                    onDelete={() => removeDefaultSortRule(rule.id)}
                    onMoveEarlier={() => moveDefaultSortRule(rule.id, -1)}
                    onMoveLater={() => moveDefaultSortRule(rule.id, 1)}
                  />
                </fieldset>
              ))}
              <SortBadgeEditor
                columns={orderedColumns}
                usedColumnIds={new Set(defaultSortRules.map((rule) => rule.columnId))}
                experimentId={experimentId}
                priority={defaultSortRules.length + 1}
                onSave={saveDefaultSortRule}
              />
            </fieldset>
            <Badge variant="secondary" className="font-mono">
              {defaultSortRules.length > 0 && 'then '}Variant ↑
            </Badge>
            {temporarySort && (
              <Badge className="h-6 gap-1 pl-2" data-temporary-sort>
                Temporary ·{' '}
                {columnsById.get(temporarySort.columnId)?.label ?? temporarySort.columnId}{' '}
                {sortDirectionSymbol(temporarySort.direction)}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 size-4 rounded-full text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                  onClick={() => setTemporarySort(null)}
                  aria-label="Clear temporary sort"
                >
                  <X aria-hidden />
                </Button>
              </Badge>
            )}
          </div>
        </div>
      </div>

      {document.variants.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs italic text-muted-foreground">
          No variants yet.
        </div>
      ) : visibleColumns.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
          Select at least one column to show the results table.
        </div>
      ) : !hasVisibleRows ? (
        <div className="space-y-2 rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
          <p>No rows match the saved filters.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAllRows(true)}>
            <Eye data-icon="inline-start" />
            Show all rows temporarily
          </Button>
        </div>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-md border">
          <Table ref={tableRef} className="w-max min-w-full table-auto" data-results-table-grid>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                {orderedVisibleColumns.map((column) => {
                  const starred = starredLabelSet.has(column.label)
                  const metric = column.schema?.group === 'metric'
                  const direction =
                    temporarySort?.columnId === column.id ? temporarySort.direction : null
                  const pinSide = pinnedColumnSide.get(column.id)
                  const pinSticky = Boolean(pinSide && pinLayout.sticky)
                  return (
                    <ContextMenu key={column.id}>
                      <ContextMenuTrigger asChild>
                        <TableHead
                          aria-sort={
                            direction === 'asc'
                              ? 'ascending'
                              : direction === 'desc'
                                ? 'descending'
                                : 'none'
                          }
                          className={cn(
                            'cursor-grab border-r px-1 active:cursor-grabbing last:border-r-0',
                            pinSticky && 'sticky z-20',
                            metric &&
                              'bg-sky-50/90 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100',
                            starred &&
                              'bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100',
                            pinSticky && pinnedOpaqueBackground(metric, starred, 'header'),
                            isDragged('column', column.id) && 'opacity-50',
                            isDropTarget('column', column.id) &&
                              'outline-2 -outline-offset-2 outline-primary/60',
                          )}
                          style={pinnedColumnStyle(column.id, pinSide, pinLayout)}
                          draggable
                          onDragStart={(event) =>
                            startDrag(event, { kind: 'column', id: column.id })
                          }
                          onDragOver={(event) => dragOver(event, { kind: 'column', id: column.id })}
                          onDrop={(event) => drop(event, { kind: 'column', id: column.id })}
                          onDragEnd={endDrag}
                          title={`Drag ${column.label} to reorder columns`}
                          data-column-id={column.id}
                          data-column-group={column.schema?.group}
                          data-pinned={pinSide}
                          data-pin-sticky={pinSticky || undefined}
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => cycleSort(column.id)}
                            className="min-w-0 justify-start px-1.5"
                            aria-label={`${column.label}: ${sortActionLabel(direction)}`}
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
                        </TableHead>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-52">
                        <ContextMenuLabel className="truncate">{column.label}</ContextMenuLabel>
                        <ContextMenuItem onSelect={() => setColumnVisible(column.id, false)}>
                          <EyeOff />
                          Hide column
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          disabled={pinSide === 'left'}
                          onSelect={() => setColumnPin(column.id, 'left')}
                        >
                          <ArrowLeftToLine />
                          {pinSide === 'left'
                            ? 'Pinned left'
                            : pinSide === 'right'
                              ? 'Move pin left'
                              : 'Pin left'}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={pinSide === 'right'}
                          onSelect={() => setColumnPin(column.id, 'right')}
                        >
                          <ArrowRightToLine />
                          {pinSide === 'right'
                            ? 'Pinned right'
                            : pinSide === 'left'
                              ? 'Move pin right'
                              : 'Pin right'}
                        </ContextMenuItem>
                        {pinSide && (
                          <ContextMenuItem onSelect={() => setColumnPin(column.id, null)}>
                            <PinOff />
                            Unpin column
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => toggleStar(column.label)}>
                          <Star className={cn(starred && 'fill-current text-amber-500')} />
                          {starred ? 'Unstar column' : 'Star column'}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedVariants.map((variant) => {
                const rowOverride = rowOverrides[variant.id]
                return (
                  <ContextMenu key={variant.id}>
                    <ContextMenuTrigger asChild>
                      <TableRow
                        className={cn(
                          rowOverride === 'include' && 'bg-emerald-50/50 dark:bg-emerald-950/15',
                          rowOverride === 'exclude' && 'bg-red-50/50 dark:bg-red-950/15',
                        )}
                        data-variant-id={variant.id}
                        data-row-override={rowOverride}
                      >
                        {orderedVisibleColumns.map((column) => {
                          const starred = starredLabelSet.has(column.label)
                          const metric = column.schema?.group === 'metric'
                          const pinSide = pinnedColumnSide.get(column.id)
                          const pinSticky = Boolean(pinSide && pinLayout.sticky)
                          return (
                            <TableCell
                              key={column.id}
                              className={cn(
                                'min-w-24 max-w-[32rem] border-r px-2.5 py-2 last:border-r-0',
                                column.kind === 'variant' && 'min-w-52',
                                pinSticky && 'sticky z-10',
                                metric && 'bg-sky-50/40 dark:bg-sky-950/15',
                                starred && 'bg-amber-50/50 dark:bg-amber-950/20',
                                pinSticky && pinnedOpaqueBackground(metric, starred, 'cell'),
                              )}
                              style={pinnedColumnStyle(column.id, pinSide, pinLayout)}
                              data-column-id={column.id}
                              data-column-group={column.schema?.group}
                              data-pinned={pinSide}
                              data-pin-sticky={pinSticky || undefined}
                            >
                              <CellClamp
                                maxLines={maxLines}
                                title={plainCellValue(column, variant)}
                              >
                                <ResultCell
                                  column={column}
                                  variant={variant}
                                  project={project}
                                  experimentId={experimentId}
                                  memberRunsById={memberRunsById}
                                />
                              </CellClamp>
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      <ContextMenuLabel className="truncate">
                        {variant.id} · {variant.name}
                      </ContextMenuLabel>
                      <ContextMenuItem
                        disabled={rowOverride === 'include'}
                        onSelect={() => setRowOverride(variant.id, 'include')}
                      >
                        <CircleCheck />
                        {rowOverride === 'include' ? 'Forced shown' : 'Force show row'}
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={rowOverride === 'exclude'}
                        onSelect={() => setRowOverride(variant.id, 'exclude')}
                      >
                        <Ban />
                        {rowOverride === 'exclude' ? 'Forced hidden' : 'Force hide row'}
                      </ContextMenuItem>
                      {rowOverride && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem onSelect={() => setRowOverride(variant.id, null)}>
                            <X />
                            Clear row override
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function RowFilterBadgeEditor({
  filter,
  priority,
  columns,
  domains,
  experimentId,
  paused,
  onSave,
  onDelete,
}: {
  filter?: RowFilter
  priority?: number
  columns: ResultTableColumn[]
  domains: ReadonlyMap<string, string[]>
  experimentId: string
  paused: boolean
  onSave: (filter: Omit<RowFilter, 'id'>) => void
  onDelete?: () => void
}) {
  const defaultColumnId = filter?.columnId ?? columns[0]?.id ?? ''
  const [open, setOpen] = useState(false)
  const [columnId, setColumnId] = useState(defaultColumnId)
  const [operator, setOperator] = useState<RowFilterOperator>(filter?.operator ?? 'eq')
  const [value, setValue] = useState(filter?.value ?? '')
  const column = columns.find((candidate) => candidate.id === columnId) ?? columns[0]
  const columnLabel =
    columns.find((candidate) => candidate.id === filter?.columnId)?.label ??
    filter?.columnId ??
    'Filter'
  const editorId = filter?.id ?? 'new'

  const setEditorOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setColumnId(filter?.columnId ?? columns[0]?.id ?? '')
      setOperator(filter?.operator ?? 'eq')
      setValue(filter?.value ?? '')
    }
    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={setEditorOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-6 rounded-full px-2',
            !filter && 'border-dashed text-muted-foreground',
            paused && 'opacity-60',
          )}
          aria-label={
            filter
              ? `Edit filter ${priority ?? ''} ${columnLabel} ${operatorSymbol(filter.operator)} ${filter.value || 'empty'}`.replace(
                  /\s+/g,
                  ' ',
                )
              : 'Add row filter'
          }
          data-row-filter={filter?.id}
        >
          {filter ? <Filter aria-hidden /> : <Plus aria-hidden />}
          {filter ? (
            <>
              <span className="text-[9px] text-muted-foreground">{priority}</span>
              <span>{columnLabel}</span>
              <span className="font-mono text-muted-foreground">
                {operatorSymbol(filter.operator)} {filter.value || '(empty)'}
              </span>
            </>
          ) : (
            'Filter'
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!column?.id) return
            onSave({ columnId: column.id, operator, value })
            setOpen(false)
          }}
        >
          <div>
            <div className="text-xs font-medium">
              {filter ? `Edit row filter · priority ${priority}` : 'Add row filter'}
            </div>
            <p className="text-[10px] text-muted-foreground">All filter badges combine with AND.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`row-filter-column-${experimentId}-${editorId}`}>Column</Label>
            <Select value={column?.id ?? ''} onValueChange={setColumnId}>
              <SelectTrigger
                id={`row-filter-column-${experimentId}-${editorId}`}
                className="w-full"
                aria-label="Filter column"
              >
                <SelectValue placeholder="Column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-2">
            <div className="space-y-1">
              <Label htmlFor={`row-filter-operator-${experimentId}-${editorId}`}>Match</Label>
              <Select
                value={operator}
                onValueChange={(next) => setOperator(next as RowFilterOperator)}
              >
                <SelectTrigger
                  id={`row-filter-operator-${experimentId}-${editorId}`}
                  className="w-full"
                  aria-label="Filter operator"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">Equals (=)</SelectItem>
                  <SelectItem value="neq">Does not equal (≠)</SelectItem>
                  <SelectItem value="gt">Greater than (&gt;)</SelectItem>
                  <SelectItem value="lt">Less than (&lt;)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`row-filter-value-${experimentId}-${editorId}`}>Value</Label>
              <Input
                id={`row-filter-value-${experimentId}-${editorId}`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                type={column?.schema?.type === 'number' ? 'number' : 'text'}
                step={column?.schema?.type === 'number' ? 'any' : undefined}
                inputMode={column?.schema?.type === 'number' ? 'decimal' : undefined}
                list={`row-filter-values-${experimentId}-${editorId}`}
                placeholder="Empty matches empty"
                aria-label="Filter value"
              />
              <datalist id={`row-filter-values-${experimentId}-${editorId}`}>
                {(domains.get(column?.id ?? '') ?? []).map((domainValue) => (
                  <option key={domainValue} value={domainValue} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            {filter && onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mr-auto"
                onClick={() => {
                  onDelete()
                  setOpen(false)
                }}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!column?.id}>
              {filter ? 'Save changes' : 'Add filter'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function SortBadgeEditor({
  rule,
  priority,
  columns,
  usedColumnIds,
  experimentId,
  canMoveEarlier = false,
  canMoveLater = false,
  onSave,
  onDelete,
  onMoveEarlier,
  onMoveLater,
}: {
  rule?: SortRule
  priority: number
  columns: ResultTableColumn[]
  usedColumnIds: ReadonlySet<string>
  experimentId: string
  canMoveEarlier?: boolean
  canMoveLater?: boolean
  onSave: (rule: Omit<SortRule, 'id'>) => void
  onDelete?: () => void
  onMoveEarlier?: () => void
  onMoveLater?: () => void
}) {
  const firstAvailableColumn = columns.find((column) => !usedColumnIds.has(column.id)) ?? columns[0]
  const [open, setOpen] = useState(false)
  const [columnId, setColumnId] = useState(rule?.columnId ?? firstAvailableColumn?.id ?? '')
  const [direction, setDirection] = useState<SortDirection>(rule?.direction ?? 'asc')
  const column = columns.find((candidate) => candidate.id === columnId) ?? firstAvailableColumn
  const columnLabel =
    columns.find((candidate) => candidate.id === rule?.columnId)?.label ?? rule?.columnId ?? 'Sort'
  const editorId = rule?.id ?? 'new'
  const allColumnsUsed =
    columns.length > 0 && columns.every((candidate) => usedColumnIds.has(candidate.id))

  const setEditorOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setColumnId(rule?.columnId ?? firstAvailableColumn?.id ?? '')
      setDirection(rule?.direction ?? 'asc')
    }
    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={setEditorOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('h-6 rounded-full px-2', !rule && 'border-dashed text-muted-foreground')}
          disabled={!rule && allColumnsUsed}
          aria-label={
            rule
              ? `Edit sort ${priority} ${columnLabel} ${sortDirectionLabel(rule.direction)}`
              : 'Add default sort'
          }
          data-sort-rule={rule?.id}
        >
          {rule ? (
            <>
              <span className="text-[9px] text-muted-foreground">{priority}</span>
              <span>{columnLabel}</span>
              <span className="font-mono text-muted-foreground">
                {sortDirectionSymbol(rule.direction)}
              </span>
            </>
          ) : (
            <>
              <Plus aria-hidden />
              Sort
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!column?.id) return
            onSave({ columnId: column.id, direction })
            setOpen(false)
          }}
        >
          <div>
            <div className="text-xs font-medium">
              {rule ? `Edit default sort · priority ${priority}` : 'Add default sort'}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sort badges run from left to right, then Variant ID.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`default-sort-column-${experimentId}-${editorId}`}>Column</Label>
            <Select value={column?.id ?? ''} onValueChange={setColumnId}>
              <SelectTrigger
                id={`default-sort-column-${experimentId}-${editorId}`}
                className="w-full"
                aria-label="Sort column"
              >
                <SelectValue placeholder="Column" />
              </SelectTrigger>
              <SelectContent>
                {columns.map((candidate) => (
                  <SelectItem
                    key={candidate.id}
                    value={candidate.id}
                    disabled={candidate.id !== rule?.columnId && usedColumnIds.has(candidate.id)}
                  >
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`default-sort-direction-${experimentId}-${editorId}`}>Direction</Label>
            <Select value={direction} onValueChange={(next) => setDirection(next as SortDirection)}>
              <SelectTrigger
                id={`default-sort-direction-${experimentId}-${editorId}`}
                className="w-full"
                aria-label="Sort direction"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">Small to large (ascending)</SelectItem>
                <SelectItem value="desc">Large to small (descending)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {rule && (
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canMoveEarlier}
                onClick={() => {
                  onMoveEarlier?.()
                  setOpen(false)
                }}
                aria-label={`Move ${columnLabel} sort earlier`}
              >
                Earlier
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canMoveLater}
                onClick={() => {
                  onMoveLater?.()
                  setOpen(false)
                }}
                aria-label={`Move ${columnLabel} sort later`}
              >
                Later
              </Button>
            </div>
          )}
          <div className="flex items-center justify-end gap-1.5">
            {rule && onDelete && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mr-auto"
                onClick={() => {
                  onDelete()
                  setOpen(false)
                }}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!column?.id}>
              {rule ? 'Save changes' : 'Add sort'}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function ColumnOptionSummary({
  column,
  pinSide,
  valueCount,
}: {
  column: ResultTableColumn
  pinSide: PinSide | undefined
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

function buildColumns(document: ResultsDocument): ResultTableColumn[] {
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
    },
    ...document.columns.map(
      (schema): ResultTableColumn => ({
        id: `schema:${schema.key}`,
        label: schema.label,
        kind: 'schema',
        schema,
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
      getValue: (variant) => variant.runs,
    },
    {
      id: 'attempts',
      label: 'Attempts',
      kind: 'attempts',
      getValue: (variant) => variant.attempts,
    },
  ]
}

function ResultCell({
  column,
  variant,
  project,
  experimentId,
  memberRunsById,
}: {
  column: ResultTableColumn
  variant: ResultVariant
  project: string
  experimentId: string
  memberRunsById: ReadonlyMap<string, MemberRunSummary>
}) {
  if (column.kind === 'variant') {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] font-medium text-muted-foreground">
          {variant.id}
        </span>
        <span className="font-medium text-foreground">{renderTextWithBreaks(variant.name)}</span>
      </span>
    )
  }
  if (column.kind === 'status') {
    return (
      <Badge variant="outline" className={cn('font-medium', STATUS_CLASS[variant.status])}>
        {variant.status}
      </Badge>
    )
  }
  if (column.kind === 'runs' || column.kind === 'attempts') {
    const runIds = column.kind === 'runs' ? variant.runs : variant.attempts
    if (runIds.length === 0) return <EmptyValue />
    return (
      <div className="space-y-0.5">
        {runIds.map((runId) => {
          const memberRun = memberRunsById.get(runId)
          return memberRun ? (
            <span key={runId} className="block whitespace-nowrap font-mono text-[10px]">
              <Link
                href={`/p/${encodeURIComponent(project)}/e/${encodeURIComponent(experimentId)}?run=${encodeURIComponent(runId)}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {runId}
              </Link>
              {memberRun.wandb && (
                <>
                  <span className="text-muted-foreground"> · </span>
                  <a
                    href={memberRun.wandb}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    W&amp;B
                  </a>
                </>
              )}
            </span>
          ) : (
            <code key={runId} className="block font-mono text-[10px]">
              {runId}
            </code>
          )
        })}
      </div>
    )
  }

  const value = column.getValue(variant)
  if (value === null || value === undefined || value === '') return <EmptyValue />
  const text = String(value)
  const provenanceHref =
    column.kind === 'entry' || column.kind === 'recipe'
      ? gitBlobUrl(variant, text)
      : column.kind === 'commit'
        ? gitCommitUrl(variant)
        : null
  if (provenanceHref) {
    return (
      <a
        href={provenanceHref}
        target="_blank"
        rel="noreferrer noopener"
        className="font-mono text-[10px] text-primary underline-offset-2 hover:underline"
      >
        {renderTextWithBreaks(text)}
      </a>
    )
  }
  const content = renderCellText(text)
  return column.kind === 'schema' ? (
    <span className={cn(column.schema?.type === 'number' && 'tabular-nums')}>{content}</span>
  ) : (
    <code className="font-mono text-[10px]">{content}</code>
  )
}

function CellClamp({
  maxLines,
  title,
  children,
}: {
  maxLines: number
  title: string
  children: ReactNode
}) {
  return (
    <div
      className="overflow-hidden whitespace-normal break-words text-xs/5"
      style={{ maxHeight: `calc(${maxLines} * 1.25rem)` }}
      title={title}
      data-max-lines={maxLines}
    >
      {children}
    </div>
  )
}

function SortIcon({ direction }: { direction: SortDirection | null }) {
  if (direction === 'asc') return <ArrowUp data-icon="inline-end" aria-hidden />
  if (direction === 'desc') return <ArrowDown data-icon="inline-end" aria-hidden />
  return <ArrowUpDown data-icon="inline-end" className="opacity-50" aria-hidden />
}

function EmptyValue() {
  return <span className="text-muted-foreground">—</span>
}

function filterVariants(
  variants: ResultVariant[],
  columns: ResultTableColumn[],
  filters: RowFilter[],
  overrides: Record<string, RowOverride>,
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

function matchesRowFilter(value: ResultValue, filter: RowFilter): boolean {
  const values = Array.isArray(value) ? (value.length > 0 ? value : [undefined]) : [value]
  if (filter.operator === 'neq') {
    return values.every((item) => !matchesScalarFilter(item, 'eq', filter.value))
  }
  return values.some((item) => matchesScalarFilter(item, filter.operator, filter.value))
}

function matchesScalarFilter(
  value: ResultScalar | string | undefined,
  operator: RowFilterOperator,
  target: string,
): boolean {
  const comparison = compareFilterValues(value, target)
  if (comparison === null) return false
  if (operator === 'eq') return comparison === 0
  if (operator === 'neq') return comparison !== 0
  if (operator === 'gt') return comparison > 0
  return comparison < 0
}

function compareFilterValues(
  value: ResultScalar | string | undefined,
  target: string,
): number | null {
  if (value === null || value === undefined || value === '') {
    return target === '' ? 0 : null
  }
  if (typeof value === 'number') {
    const numericTarget = Number(target)
    return Number.isFinite(numericTarget) ? value - numericTarget : null
  }
  if (typeof value === 'boolean') {
    const normalizedTarget = target.trim().toLowerCase()
    if (normalizedTarget !== 'true' && normalizedTarget !== 'false') return null
    return Number(value) - Number(normalizedTarget === 'true')
  }
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(
    String(value).replace(/<br\s*\/?>/gi, '\n'),
    target,
  )
}

function sortVariants(
  variants: ResultVariant[],
  columns: ResultTableColumn[],
  rules: ReadonlyArray<Omit<SortRule, 'id'>>,
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
      const variantIdComparison = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: 'base',
      }).compare(left.variant.id, right.variant.id)
      return variantIdComparison || left.index - right.index
    })
    .map(({ variant }) => variant)
}

function compareSortValues(
  left: ResultValue,
  right: ResultValue,
  direction: SortDirection,
): number {
  const leftEmpty = isEmptyValue(left)
  const rightEmpty = isEmptyValue(right)
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0
    return leftEmpty ? 1 : -1
  }
  const comparison = compareValues(left, right)
  return direction === 'asc' ? comparison : -comparison
}

function compareValues(left: ResultValue, right: ResultValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right)
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(
    valueText(left),
    valueText(right),
  )
}

function distinctValues(variants: ResultVariant[], column: ResultTableColumn): string[] {
  const values = new Set<string>()
  for (const variant of variants) {
    const value = column.getValue(variant)
    if (Array.isArray(value)) {
      for (const item of value) values.add(displayText(item))
    } else if (!isEmptyValue(value)) {
      values.add(displayText(value))
    }
  }
  return Array.from(values).sort((left, right) =>
    new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(left, right),
  )
}

function plainCellValue(column: ResultTableColumn, variant: ResultVariant): string {
  return valueText(column.getValue(variant)).replace(/<br\s*\/?>/gi, '\n') || '—'
}

function valueText(value: ResultValue): string {
  if (Array.isArray(value)) return value.join('\n')
  if (value === null || value === undefined || value === '') return ''
  return String(value)
}

function displayText(value: ResultValue): string {
  return valueText(value).replace(/<br\s*\/?>/gi, '\n') || '—'
}

function isEmptyValue(value: ResultValue): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function renderTextWithBreaks(value: string): ReactNode {
  const lines = value.split(/(?:<br\s*\/?>|\r?\n)/gi)
  const occurrences = new Map<string, number>()
  const keyedLines = lines.map((line) => {
    const occurrence = (occurrences.get(line) ?? 0) + 1
    occurrences.set(line, occurrence)
    return { key: `${line}\0${occurrence}`, line }
  })
  return keyedLines.map(({ key, line }, position) => (
    <Fragment key={key}>
      {position > 0 && <br />}
      {line}
    </Fragment>
  ))
}

function renderCellText(value: string): ReactNode {
  const lines = value.split(/(?:<br\s*\/?>|\r?\n)/gi)
  const occurrences = new Map<string, number>()
  return lines.map((line, position) => {
    const occurrence = (occurrences.get(line) ?? 0) + 1
    occurrences.set(line, occurrence)
    const key = `${line}\0${occurrence}`
    const wandbUrl = parseWandbUrl(line)
    return (
      <Fragment key={key}>
        {position > 0 && <br />}
        {wandbUrl ? <WandbLink {...wandbUrl} /> : line}
      </Fragment>
    )
  })
}

function WandbLink({ href, label }: { href: string; label: string }) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            title={href}
            className="inline-flex max-w-56 items-center gap-1 rounded-sm px-0.5 font-mono text-[10px] text-primary underline decoration-primary/40 underline-offset-2 hover:bg-primary/10 hover:decoration-primary"
            aria-label={`Open W&B link ${label}`}
          >
            <ChartSpline className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </a>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-md break-all font-mono">
          {href}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function parseWandbUrl(value: string): { href: string; label: string } | null {
  const href = value.trim()
  if (href !== value || href.length === 0) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const hostname = url.hostname.toLowerCase()
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    (hostname !== 'wandb.ai' && !hostname.endsWith('.wandb.ai'))
  ) {
    return null
  }
  const lastSegment = url.pathname.split('/').filter(Boolean).at(-1)
  if (!lastSegment) return { href, label: hostname }
  try {
    return { href, label: decodeURIComponent(lastSegment) }
  } catch {
    return { href, label: lastSegment }
  }
}

function dropEdge(event: DragEvent<HTMLElement>): DropEdge {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientX > bounds.left + bounds.width / 2 ? 'after' : 'before'
}

function reorderIds(ids: string[], sourceId: string, targetId: string, edge: DropEdge): string[] {
  if (sourceId === targetId) return ids
  const sourceIndex = ids.indexOf(sourceId)
  if (sourceIndex < 0 || !ids.includes(targetId)) return ids
  const next = ids.filter((id) => id !== sourceId)
  const targetIndex = next.indexOf(targetId)
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, sourceId)
  return next.every((id, index) => id === ids[index]) ? ids : next
}

function reorderItems<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): T[] {
  const currentIds = items.map((item) => item.id)
  const nextIds = reorderIds(currentIds, sourceId, targetId, edge)
  if (nextIds === currentIds) return items
  const itemsById = new Map(items.map((item) => [item.id, item] as const))
  const next = nextIds
    .map((id) => itemsById.get(id))
    .filter((item): item is T => item !== undefined)
  return next.every((item, index) => item === items[index]) ? items : next
}

function normalizeColumnOrderIds(value: unknown, defaultIds: string[]): string[] {
  const validIds = new Set(defaultIds)
  const seen = new Set<string>()
  const restored = Array.isArray(value)
    ? value.filter((id): id is string => {
        if (typeof id !== 'string' || !validIds.has(id) || seen.has(id)) return false
        seen.add(id)
        return true
      })
    : []
  return [...restored, ...defaultIds.filter((id) => !seen.has(id))]
}

function normalizeResultsTablePreferences(
  value: unknown,
  columns: ResultTableColumn[],
  variants: ResultVariant[],
): ResultsTablePreferences {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<ResultsTablePreferences>)
      : {}
  const defaultColumnIds = columns.map((column) => column.id)
  const validColumnIds = new Set(defaultColumnIds)
  const validVariantIds = new Set(variants.map((variant) => variant.id))
  return {
    hiddenColumnIds: Array.isArray(candidate.hiddenColumnIds)
      ? candidate.hiddenColumnIds.filter(
          (id): id is string => typeof id === 'string' && validColumnIds.has(id),
        )
      : [],
    columnOrderIds: normalizeColumnOrderIds(candidate.columnOrderIds, defaultColumnIds),
    maxLines: normalizeMaxLines(candidate.maxLines),
    defaultSortRules: normalizeSortRules(candidate.defaultSortRules, validColumnIds),
    pinnedColumnIds: normalizePinnedColumnIds(candidate.pinnedColumnIds, validColumnIds),
    rowFilters: normalizeRowFilters(candidate.rowFilters, validColumnIds),
    rowOverrides: normalizeRowOverrides(candidate.rowOverrides, validVariantIds),
  }
}

function normalizeMaxLines(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

function normalizeSortRules(value: unknown, validColumnIds: ReadonlySet<string>): SortRule[] {
  if (!Array.isArray(value)) return []
  const seenColumnIds = new Set<string>()
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as { id?: unknown; columnId?: unknown; direction?: unknown }
    if (
      typeof candidate.columnId !== 'string' ||
      !validColumnIds.has(candidate.columnId) ||
      seenColumnIds.has(candidate.columnId) ||
      (candidate.direction !== 'asc' && candidate.direction !== 'desc')
    ) {
      return []
    }
    seenColumnIds.add(candidate.columnId)
    return [
      {
        id: typeof candidate.id === 'string' ? candidate.id : `restored-sort-${index}`,
        columnId: candidate.columnId,
        direction: candidate.direction,
      },
    ]
  })
}

function normalizePinnedColumnIds(
  value: unknown,
  validColumnIds: ReadonlySet<string>,
): ResultsTablePreferences['pinnedColumnIds'] {
  if (!value || typeof value !== 'object') return { left: [], right: [] }
  const candidate = value as { left?: unknown; right?: unknown }
  const seen = new Set<string>()
  const normalizeSide = (ids: unknown) => {
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is string => {
      if (typeof id !== 'string' || !validColumnIds.has(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
  }
  return { left: normalizeSide(candidate.left), right: normalizeSide(candidate.right) }
}

function normalizeRowFilters(value: unknown, validColumnIds: ReadonlySet<string>): RowFilter[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as {
      id?: unknown
      columnId?: unknown
      operator?: unknown
      value?: unknown
    }
    if (
      typeof candidate.columnId !== 'string' ||
      !validColumnIds.has(candidate.columnId) ||
      !isRowFilterOperator(candidate.operator) ||
      typeof candidate.value !== 'string'
    ) {
      return []
    }
    return [
      {
        id: typeof candidate.id === 'string' ? candidate.id : `restored-filter-${index}`,
        columnId: candidate.columnId,
        operator: candidate.operator,
        value: candidate.value,
      },
    ]
  })
}

function normalizeRowOverrides(
  value: unknown,
  validVariantIds: ReadonlySet<string>,
): Record<string, RowOverride> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, RowOverride] =>
        validVariantIds.has(entry[0]) && (entry[1] === 'include' || entry[1] === 'exclude'),
    ),
  )
}

function isRowFilterOperator(value: unknown): value is RowFilterOperator {
  return value === 'eq' || value === 'neq' || value === 'gt' || value === 'lt'
}

function operatorSymbol(operator: RowFilterOperator): string {
  if (operator === 'eq') return '='
  if (operator === 'neq') return '≠'
  if (operator === 'gt') return '>'
  return '<'
}

function pinnedOpaqueBackground(
  metric: boolean,
  starred: boolean,
  surface: 'header' | 'cell',
): string {
  if (starred) return '!bg-amber-50 dark:!bg-amber-950'
  if (metric) return '!bg-sky-50 dark:!bg-sky-950'
  return surface === 'header' ? '!bg-muted' : '!bg-background'
}

function pinnedColumnStyle(
  columnId: string,
  side: PinSide | undefined,
  layout: PinLayout,
): CSSProperties | undefined {
  if (!side || !layout.sticky) return undefined
  return side === 'left'
    ? { left: layout.leftOffsets[columnId] ?? 0 }
    : { right: layout.rightOffsets[columnId] ?? 0 }
}

function samePinLayout(left: PinLayout, right: PinLayout): boolean {
  if (left.sticky !== right.sticky) return false
  const sameOffsets = (a: Record<string, number>, b: Record<string, number>) => {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
  }
  return (
    sameOffsets(left.leftOffsets, right.leftOffsets) &&
    sameOffsets(left.rightOffsets, right.rightOffsets)
  )
}

function sortActionLabel(direction: SortDirection | null): string {
  if (direction === 'asc') return 'temporarily sorted ascending; activate for descending'
  if (direction === 'desc') return 'temporarily sorted descending; activate for default sort'
  return 'default sort; activate for temporary ascending'
}

function sortDirectionSymbol(direction: SortDirection): string {
  return direction === 'asc' ? '↑' : '↓'
}

function sortDirectionLabel(direction: SortDirection): string {
  return direction === 'asc' ? 'ascending' : 'descending'
}

function gitBlobUrl(variant: ResultVariant, path: string): string | null {
  const repository = variant.provenance?.repo
  const commit = variant.provenance?.commit
  if (!repository || !commit || !isSafeRelativePath(path)) return null
  const base = normalizedRepositoryUrl(repository)
  if (!base) return null
  const encodedPath = path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/')
  return `${base}/blob/${encodeURIComponent(commit)}/${encodedPath}`
}

function gitCommitUrl(variant: ResultVariant): string | null {
  const repository = variant.provenance?.repo
  const commit = variant.provenance?.commit
  if (!repository || !commit) return null
  const base = normalizedRepositoryUrl(repository)
  return base ? `${base}/commit/${encodeURIComponent(commit)}` : null
}

function normalizedRepositoryUrl(repository: string): string | null {
  let url: URL
  try {
    url = new URL(repository)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\.git$/i, '')
  return url.toString().replace(/\/$/, '')
}

function isSafeRelativePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) &&
    !normalized.split('/').includes('..')
  )
}
