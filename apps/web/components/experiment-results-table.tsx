'use client'

import type {
  ResultsDocument,
  ResultsVariantEligibility,
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
  CopyPlus,
  Eye,
  EyeOff,
  Filter,
  Minus,
  Pencil,
  PinOff,
  Plus,
  RotateCcw,
  Rows3,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import {
  type ComponentProps,
  type DragEvent,
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { toast } from 'sonner'
import { type ProjectTarget, projectWebPath } from '../lib/api'
import {
  buildColumns,
  distinctValues,
  resultValueDescription,
} from '../lib/experiment-results/columns'
import { filterVariants } from '../lib/experiment-results/filters'
import {
  gitBlobUrl,
  gitCommitUrl,
  keyedLines,
  operatorSymbol,
  parseWandbUrl,
  plainCellValue,
  sortActionLabel,
  sortDirectionLabel,
  sortDirectionSymbol,
  sotaRankClass,
} from '../lib/experiment-results/format'
import {
  computePinLayout,
  dropEdgeAt,
  EMPTY_PIN_LAYOUT,
  pinnedColumnStyle,
  pinnedOpaqueBackground,
  reorderIds,
  reorderItems,
  samePinLayout,
} from '../lib/experiment-results/layout'
import { effectiveSortRules, sortVariants } from '../lib/experiment-results/sorting'
import { computeSotaRanks } from '../lib/experiment-results/sota'
import type {
  DragItem,
  DragKind,
  DropEdge,
  PinLayout,
  ResultTableColumn,
  SotaRank,
} from '../lib/experiment-results/types'
import {
  DEFAULT_RESULTS_VIEW_DEFINITION,
  normalizeMaxLines,
  normalizeResultsViewDefinition,
} from '../lib/experiment-results/views'
import type {
  ExperimentResultsViewDefinition,
  ResultsViewPinSide,
  ResultsViewRowFilter,
  ResultsViewRowFilterOperator,
  ResultsViewRowOverride,
  ResultsViewSortDirection,
  ResultsViewSortRule,
} from '../lib/experiment-results-views'
import { useExperimentResultsViews } from '../lib/use-experiment-results-views'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { cn } from '../lib/utils'
import { TranslatedLiteral } from './body-translation'
import { Markdown } from './markdown'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
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
} from './ui/context-menu'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Separator } from './ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Toggle } from './ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

type SortDirection = ResultsViewSortDirection
type PinSide = ResultsViewPinSide
type RowFilterOperator = ResultsViewRowFilterOperator
type RowOverride = ResultsViewRowOverride

type ResultsTablePreferences = ExperimentResultsViewDefinition
type RowFilter = ResultsViewRowFilter
type SortRule = ResultsViewSortRule

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
  runIds,
  variantEligibility,
  deprecatedRuns,
}: {
  document: ResultsDocument
  project: ProjectTarget
  experimentId: string
  /** Run ids declared by the Experiment's `runs` frontmatter. */
  runIds: string[]
  variantEligibility?: readonly ResultsVariantEligibility[]
  deprecatedRuns?: readonly string[]
}) {
  const excludedRuns = useMemo(() => {
    const ids = new Set(deprecatedRuns)
    for (const row of variantEligibility ?? []) {
      for (const id of row.deprecatedRuns) ids.add(id)
    }
    return ids
  }, [deprecatedRuns, variantEligibility])
  const columns = useMemo(() => buildColumns(document, excludedRuns), [document, excludedRuns])
  const eligibilityByVariant = useMemo(
    () => new Map(variantEligibility?.map((row) => [row.variantId, row])),
    [variantEligibility],
  )
  const affectedEligibility = useMemo(
    () => variantEligibility?.filter((row) => row.metricsValidity !== 'valid') ?? [],
    [variantEligibility],
  )
  const projectKey = typeof project === 'string' ? project : `${project.host}:${project.project}`
  const starsKey = `memon:results-table:${projectKey}:starred-column-labels`
  const resultsViews = useExperimentResultsViews(
    project,
    experimentId,
    DEFAULT_RESULTS_VIEW_DEFINITION,
  )
  const storedPreferences = resultsViews.definition
  const setStoredPreferences = resultsViews.updateDefinition
  const [storedStarredLabels, setStoredStarredLabels] = useUserPreferenceState<string[]>(
    starsKey,
    [],
  )
  const [showAllColumns, setShowAllColumns] = useState(false)
  const [showAllRows, setShowAllRows] = useState(false)
  const [temporarySort, setTemporarySort] = useState<Omit<SortRule, 'id'> | null>(null)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [viewEditorOpen, setViewEditorOpen] = useState(false)
  const [viewEditorMode, setViewEditorMode] = useState<'create' | 'rename'>('create')
  const [viewName, setViewName] = useState('')
  const [viewMutationPending, setViewMutationPending] = useState(false)
  const [deleteViewDialogOpen, setDeleteViewDialogOpen] = useState(false)
  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<DragItem | null>(null)
  const rowFilterSequence = useRef(0)
  const sortRuleSequence = useRef(0)
  const resetCancelRef = useRef<HTMLButtonElement>(null)

  const { definition: preferences, invalidCount: invalidSettingCount } =
    normalizeResultsTablePreferences(storedPreferences, columns, document.variants)
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
  const sotaModes = preferences.sotaModes
  const decimalPlaces = preferences.decimalPlaces
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
  const declaredRunIds = useMemo(() => new Set(runIds), [runIds])

  const domains = useMemo(
    () =>
      new Map(
        columns.map((column) => [column.id, distinctValues(document.variants, column)] as const),
      ),
    [columns, document.variants],
  )
  const sotaRanks = useMemo(
    () => computeSotaRanks(document.variants, columns, sotaModes, eligibilityByVariant),
    [document.variants, columns, sotaModes, eligibilityByVariant],
  )
  const filteredVariants = useMemo(
    () => filterVariants(document.variants, columns, rowFilters, rowOverrides, showAllRows),
    [columns, document.variants, rowFilters, rowOverrides, showAllRows],
  )
  const sortedVariants = useMemo(
    () =>
      sortVariants(filteredVariants, columns, effectiveSortRules(temporarySort, defaultSortRules)),
    [columns, defaultSortRules, filteredVariants, temporarySort],
  )
  const hasVisibleRows = filteredVariants.length > 0
  const resetDisabled =
    hiddenColumnIds.length === 0 &&
    !hasCustomColumnOrder &&
    maxLines === 1 &&
    defaultSortRules.length === 0 &&
    temporarySort === null &&
    pinnedColumnIds.left.length === 0 &&
    pinnedColumnIds.right.length === 0 &&
    rowFilters.length === 0 &&
    Object.keys(rowOverrides).length === 0 &&
    Object.keys(sotaModes).length === 0 &&
    Object.keys(decimalPlaces).length === 0 &&
    !showAllColumns &&
    !showAllRows

  const updatePreferences = (
    update:
      | Partial<ResultsTablePreferences>
      | ((current: ResultsTablePreferences) => ResultsTablePreferences),
  ) => {
    setStoredPreferences((stored) => {
      const current = normalizeResultsTablePreferences(
        stored,
        columns,
        document.variants,
      ).definition
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

  const cycleSotaMode = (columnId: string) => {
    updatePreferences((current) => {
      const currentMode = current.sotaModes[columnId] ?? 'off'
      const nextMode =
        currentMode === 'off'
          ? 'higher-is-better'
          : currentMode === 'higher-is-better'
            ? 'lower-is-better'
            : 'off'
      return { ...current, sotaModes: { ...current.sotaModes, [columnId]: nextMode } }
    })
  }

  const setDecimalPlaces = (columnId: string, places: number) => {
    updatePreferences((current) => {
      const clamped = Math.max(0, Math.min(10, Number.isFinite(places) ? Math.floor(places) : 0))
      const next = { ...current.decimalPlaces, [columnId]: clamped }
      return { ...current, decimalPlaces: next }
    })
  }

  const resetView = () => {
    setStoredPreferences(DEFAULT_RESULTS_VIEW_DEFINITION)
    setShowAllColumns(false)
    setShowAllRows(false)
    setTemporarySort(null)
  }

  const selectResultsView = (viewId: string) => {
    resultsViews.selectView(viewId)
    setShowAllColumns(false)
    setShowAllRows(false)
    setTemporarySort(null)
  }

  const openCreateView = () => {
    setViewEditorMode('create')
    setViewName(resultsViews.activeView ? `${resultsViews.activeView.name} copy` : 'New view')
    setViewEditorOpen(true)
  }

  const openRenameView = () => {
    if (!resultsViews.activeView) return
    setViewEditorMode('rename')
    setViewName(resultsViews.activeView.name)
    setViewEditorOpen(true)
  }

  const submitViewEditor = async () => {
    const normalizedName = viewName.trim()
    if (!normalizedName) return
    setViewMutationPending(true)
    try {
      if (viewEditorMode === 'create') {
        await resultsViews.createView(normalizedName)
        setShowAllColumns(false)
        setShowAllRows(false)
        setTemporarySort(null)
      } else if (resultsViews.activeView) {
        await resultsViews.renameView(resultsViews.activeView.id, normalizedName)
      }
      setViewEditorOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save View')
    } finally {
      setViewMutationPending(false)
    }
  }

  const deleteActiveView = async () => {
    if (!resultsViews.activeView) return
    setViewMutationPending(true)
    try {
      await resultsViews.deleteView(resultsViews.activeView.id)
      setShowAllColumns(false)
      setShowAllRows(false)
      setTemporarySort(null)
      setDeleteViewDialogOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete View')
    } finally {
      setViewMutationPending(false)
    }
  }

  useLayoutEffect(() => {
    // The identity changes when pin side, pin order, or visible columns change.
    void pinLayoutKey
    void hasVisibleRows
    const table = tableRef.current
    const container = table?.parentElement
    if (!table || !container) return

    const measure = () => {
      const next = computePinLayout(
        Array.from(table.querySelectorAll<HTMLElement>('thead [data-column-id]')).flatMap(
          (header) => {
            const side = header.dataset.pinned
            const columnId = header.dataset.columnId
            if ((side !== 'left' && side !== 'right') || !columnId) return []
            return [{ columnId, side, width: header.getBoundingClientRect().width }] as const
          },
        ),
        container.clientWidth,
      )
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
      {affectedEligibility.length > 0 && (
        <p role="note" className="text-xs text-muted-foreground">
          Deprecated Runs affect stored metrics (
          {affectedEligibility.map((row) => `${row.variantId}: ${row.metricsValidity}`).join(', ')}
          ). Original values are preserved, not recomputed; affected rows are excluded from
          best-value highlighting.
        </p>
      )}
      {invalidSettingCount > 0 && (
        <p
          role="note"
          className="text-xs text-amber-700 dark:text-amber-300"
          data-slot="results-view-invalid"
        >
          {invalidSettingCount} saved View{' '}
          {invalidSettingCount === 1 ? 'setting is' : 'settings are'} invalid and ignored.
        </p>
      )}
      <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-slot="results-controls">
        <div className="flex flex-wrap items-center gap-2" data-slot="results-view-controls">
          <Label htmlFor={`results-view-${experimentId}`} className="text-xs font-medium">
            View
          </Label>
          <Select
            value={resultsViews.activeView?.id ?? ''}
            onValueChange={selectResultsView}
            disabled={resultsViews.loading || resultsViews.views.length === 0}
          >
            <SelectTrigger
              id={`results-view-${experimentId}`}
              className="h-8 w-56 max-w-full"
              aria-label="Results view"
            >
              <SelectValue
                placeholder={resultsViews.loading ? 'Loading views…' : 'No saved views'}
              />
            </SelectTrigger>
            <SelectContent>
              {resultsViews.views.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="tabular-nums">
            {resultsViews.views.length} {resultsViews.views.length === 1 ? 'view' : 'views'}
          </Badge>
          {resultsViews.canMutate ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={openCreateView}
                disabled={viewMutationPending}
              >
                {resultsViews.activeView ? (
                  <CopyPlus data-icon="inline-start" />
                ) : (
                  <Plus data-icon="inline-start" />
                )}
                {resultsViews.activeView ? 'Duplicate' : 'New view'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={openRenameView}
                disabled={!resultsViews.activeView || viewMutationPending}
                aria-label="Rename Results view"
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setDeleteViewDialogOpen(true)}
                disabled={!resultsViews.activeView || viewMutationPending}
                aria-label="Delete Results view"
              >
                <Trash2 aria-hidden />
              </Button>
            </>
          ) : (
            <Badge variant="outline">Read-only</Badge>
          )}
          {resultsViews.error && (
            <span className="text-xs text-destructive" role="status">
              {resultsViews.error}
            </span>
          )}
        </div>

        <Dialog open={viewEditorOpen} onOpenChange={setViewEditorOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {viewEditorMode === 'create'
                  ? resultsViews.activeView
                    ? 'Duplicate Results view'
                    : 'New Results view'
                  : 'Rename Results view'}
              </DialogTitle>
              <DialogDescription>
                {viewEditorMode === 'create'
                  ? resultsViews.activeView
                    ? 'The new View starts with the active filters, checked columns, and layout.'
                    : 'The new View starts with the default Results table layout.'
                  : 'The new name is shared with everyone who can open this Experiment.'}
              </DialogDescription>
            </DialogHeader>
            <Label htmlFor={`results-view-name-${experimentId}`}>View name</Label>
            <Input
              id={`results-view-name-${experimentId}`}
              value={viewName}
              maxLength={96}
              onChange={(event) => setViewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && viewName.trim() && !viewMutationPending) {
                  event.preventDefault()
                  void submitViewEditor()
                }
              }}
              autoFocus
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={viewMutationPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                onClick={() => void submitViewEditor()}
                disabled={!viewName.trim() || viewMutationPending}
              >
                {viewMutationPending
                  ? 'Saving…'
                  : viewEditorMode === 'create'
                    ? resultsViews.activeView
                      ? 'Duplicate'
                      : 'Create'
                    : 'Rename'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteViewDialogOpen} onOpenChange={setDeleteViewDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Results view?</DialogTitle>
              <DialogDescription>
                {resultsViews.activeView
                  ? `“${resultsViews.activeView.name}” will be removed for everyone who can open this Experiment.`
                  : 'This shared View will be removed.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={viewMutationPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void deleteActiveView()}
                disabled={!resultsViews.activeView || viewMutationPending}
              >
                <Trash2 data-icon="inline-start" />
                {viewMutationPending ? 'Deleting…' : 'Delete view'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            (!resultsViews.canMutate || !resultsViews.activeView) &&
              'pointer-events-none opacity-70',
          )}
          aria-disabled={!resultsViews.canMutate || !resultsViews.activeView}
        >
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
            <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="ghost" size="sm" disabled={resetDisabled}>
                  <RotateCcw data-icon="inline-start" />
                  Reset view
                </Button>
              </DialogTrigger>
              <DialogContent
                onOpenAutoFocus={(event) => {
                  event.preventDefault()
                  resetCancelRef.current?.focus()
                }}
              >
                <DialogHeader>
                  <DialogTitle>Reset Results view?</DialogTitle>
                  <DialogDescription>
                    This clears your saved default sort, row filters, checkbox visibility, column
                    order, pinned columns, row overrides, maximum line count, and temporary view and
                    sort controls. This cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button ref={resetCancelRef} type="button" variant="outline">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    aria-label="Confirm reset Results view"
                    onClick={() => {
                      resetView()
                      setResetDialogOpen(false)
                    }}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Reset view
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <fieldset
          className={cn(
            'flex flex-wrap gap-1.5',
            (!resultsViews.canMutate || !resultsViews.activeView) &&
              'pointer-events-none opacity-70',
          )}
          aria-disabled={!resultsViews.canMutate || !resultsViews.activeView}
        >
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
                  <ColumnOptionSummary
                    column={column}
                    pinSide={pinSide}
                    valueCount={values.length}
                  />
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

        <div
          className={cn(
            'space-y-2.5',
            (!resultsViews.canMutate || !resultsViews.activeView) &&
              'pointer-events-none opacity-70',
          )}
          data-slot="row-filter-controls"
          aria-disabled={!resultsViews.canMutate || !resultsViews.activeView}
        >
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
                              onClick={() => cycleSort(column.id)}
                              className="min-w-0 justify-start px-1.5"
                              aria-label={`${column.label}: ${sortActionLabel(direction)}`}
                              data-has-description={
                                column.annotation?.description !== undefined || undefined
                              }
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
                        <ContextMenuItem
                          disabled={!resultsViews.canMutate}
                          onSelect={() => setColumnVisible(column.id, false)}
                        >
                          <EyeOff />
                          Hide column
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          disabled={!resultsViews.canMutate || pinSide === 'left'}
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
                          disabled={!resultsViews.canMutate || pinSide === 'right'}
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
                          <ContextMenuItem
                            disabled={!resultsViews.canMutate}
                            onSelect={() => setColumnPin(column.id, null)}
                          >
                            <PinOff />
                            Unpin column
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => toggleStar(column.label)}>
                          <Star className={cn(starred && 'fill-current text-amber-500')} />
                          {starred ? 'Unstar column' : 'Star column'}
                        </ContextMenuItem>
                        {metric && (
                          <>
                            <ContextMenuSeparator />
                            <ContextMenuSub>
                              <ContextMenuSubTrigger
                                inset
                                disabled={!resultsViews.canMutate}
                                className="data-disabled:pointer-events-none data-disabled:opacity-50"
                              >
                                <ArrowUp className="mr-2 size-4" />
                                SOTA highlight
                              </ContextMenuSubTrigger>
                              <ContextMenuSubContent className="w-44">
                                <ContextMenuItem
                                  onSelect={() => cycleSotaMode(column.id)}
                                  disabled={
                                    !resultsViews.canMutate || sotaModes[column.id] === 'off'
                                  }
                                >
                                  <Minus className="mr-2 size-4" />
                                  Off
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => cycleSotaMode(column.id)}
                                  disabled={
                                    !resultsViews.canMutate ||
                                    sotaModes[column.id] === 'higher-is-better'
                                  }
                                >
                                  <ArrowUp className="mr-2 size-4" />
                                  Higher is better
                                </ContextMenuItem>
                                <ContextMenuItem
                                  onSelect={() => cycleSotaMode(column.id)}
                                  disabled={
                                    !resultsViews.canMutate ||
                                    sotaModes[column.id] === 'lower-is-better'
                                  }
                                >
                                  <ArrowDown className="mr-2 size-4" />
                                  Lower is better
                                </ContextMenuItem>
                              </ContextMenuSubContent>
                            </ContextMenuSub>
                            <ContextMenuSub>
                              <ContextMenuSubTrigger
                                inset
                                disabled={!resultsViews.canMutate}
                                className="data-disabled:pointer-events-none data-disabled:opacity-50"
                              >
                                <Columns3 className="mr-2 size-4" />
                                Decimal places
                              </ContextMenuSubTrigger>
                              <ContextMenuSubContent className="w-44">
                                <div className="flex items-center justify-between px-2 py-1.5">
                                  <span className="text-xs text-muted-foreground">
                                    {decimalPlaces[column.id] ?? 0} decimal place
                                    {(decimalPlaces[column.id] ?? 0) === 1 ? '' : 's'}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      className="size-5 rounded"
                                      aria-label="Decrease decimal places"
                                      disabled={!resultsViews.canMutate}
                                      onClick={() =>
                                        setDecimalPlaces(
                                          column.id,
                                          Math.max(0, (decimalPlaces[column.id] ?? 0) - 1),
                                        )
                                      }
                                    >
                                      <Minus className="size-3" aria-hidden />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      className="size-5 rounded"
                                      aria-label="Increase decimal places"
                                      disabled={!resultsViews.canMutate}
                                      onClick={() =>
                                        setDecimalPlaces(
                                          column.id,
                                          Math.min(10, (decimalPlaces[column.id] ?? 0) + 1),
                                        )
                                      }
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
                          const valueDescription = resultValueDescription(column, variant)
                          return (
                            <TableCell
                              key={column.id}
                              className={cn(
                                'min-w-24 max-w-[32rem] border-r px-2.5 py-2 align-top last:border-r-0',
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
                              <AnnotationTooltip
                                description={valueDescription}
                                label={`${column.label} value description`}
                              >
                                <CellClamp
                                  maxLines={maxLines}
                                  title={
                                    valueDescription === undefined
                                      ? plainCellValue(column, variant)
                                      : undefined
                                  }
                                  focusable={valueDescription !== undefined}
                                >
                                  <ResultCell
                                    column={column}
                                    variant={variant}
                                    project={project}
                                    experimentId={experimentId}
                                    declaredRunIds={declaredRunIds}
                                    eligibility={eligibilityByVariant.get(variant.id)}
                                    sotaRank={
                                      metric
                                        ? sotaRanks.get(column.id)?.ranks.get(variant.id)
                                        : undefined
                                    }
                                    decimalPlaces={metric ? decimalPlaces[column.id] : undefined}
                                  />
                                </CellClamp>
                              </AnnotationTooltip>
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
                        disabled={!resultsViews.canMutate || rowOverride === 'include'}
                        onSelect={() => setRowOverride(variant.id, 'include')}
                      >
                        <CircleCheck />
                        {rowOverride === 'include' ? 'Forced shown' : 'Force show row'}
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!resultsViews.canMutate || rowOverride === 'exclude'}
                        onSelect={() => setRowOverride(variant.id, 'exclude')}
                      >
                        <Ban />
                        {rowOverride === 'exclude' ? 'Forced hidden' : 'Force hide row'}
                      </ContextMenuItem>
                      {rowOverride && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            disabled={!resultsViews.canMutate}
                            onSelect={() => setRowOverride(variant.id, null)}
                          >
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

function ResultCell({
  column,
  variant,
  project,
  experimentId,
  declaredRunIds,
  sotaRank,
  decimalPlaces,
  eligibility,
}: {
  column: ResultTableColumn
  variant: ResultVariant
  project: ProjectTarget
  experimentId: string
  declaredRunIds: ReadonlySet<string>
  sotaRank?: SotaRank
  decimalPlaces?: number
  eligibility?: ResultsVariantEligibility
}) {
  const invalidMetrics = eligibility && eligibility.metricsValidity !== 'valid'
  if (column.kind === 'variant') {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] font-medium text-muted-foreground">
          {variant.id}
        </span>
        <span className="font-medium text-foreground">
          <TranslatedLiteral original={renderTextWithBreaks(variant.name)}>
            {variant.name}
          </TranslatedLiteral>
        </span>
        {invalidMetrics && <Badge variant="outline">metrics {eligibility.metricsValidity}</Badge>}
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
    const runIds = column.getValue(variant) as string[]
    if (runIds.length === 0) return <EmptyValue />
    return (
      <div className="space-y-0.5">
        {runIds.map((runId) =>
          // A declared member links into the Experiment page's Run panel;
          // an id the Experiment does not declare is shown as plain text
          // rather than a link that would open an empty panel.
          declaredRunIds.has(runId) ? (
            <span key={runId} className="block whitespace-nowrap font-mono text-[10px]">
              <Link
                href={`${projectWebPath(project, `/e/${encodeURIComponent(experimentId)}`)}?run=${encodeURIComponent(runId)}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                {runId}
              </Link>
            </span>
          ) : (
            <code key={runId} className="block font-mono text-[10px]">
              {runId}
            </code>
          ),
        )}
      </div>
    )
  }

  const value = column.getValue(variant)
  if (value === null || value === undefined || value === '') return <EmptyValue />

  // Apply decimal-places formatting to finite numbers when the user has
  // enabled it for this metric column. Non-numeric values are left as-is.
  let displayText = String(value)
  if (decimalPlaces !== undefined && typeof value === 'number' && Number.isFinite(value)) {
    displayText = value.toFixed(decimalPlaces)
  }

  const text = displayText
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
  const hasDecimalFormat =
    decimalPlaces !== undefined && typeof value === 'number' && Number.isFinite(value)
  const sotaClass = sotaRankClass(sotaRank)
  return column.kind === 'schema' ? (
    <span
      className={cn(
        column.schema?.type === 'number' && 'tabular-nums',
        hasDecimalFormat && 'tabular-nums',
        sotaClass,
      )}
    >
      {content}
      {column.schema?.group === 'metric' && invalidMetrics && (
        <span title={`Excluded Runs: ${eligibility.deprecatedRuns.join(', ')}`}>
          {' '}
          [{eligibility.metricsValidity}]
        </span>
      )}
    </span>
  ) : (
    <code className="font-mono text-[10px]">{content}</code>
  )
}

function CellClamp({
  maxLines,
  title,
  focusable = false,
  children,
  className,
  style,
  ...triggerProps
}: {
  maxLines: number
  title?: string
  focusable?: boolean
  children: ReactNode
} & Omit<ComponentProps<'div'>, 'children' | 'title'>) {
  return (
    <div
      {...triggerProps}
      className={cn('overflow-hidden whitespace-normal break-words text-xs/5', className)}
      style={{ ...style, maxHeight: `calc(${maxLines} * 1.25rem)` }}
      title={title}
      tabIndex={focusable ? 0 : undefined}
      data-has-description={focusable || undefined}
      data-max-lines={maxLines}
    >
      {children}
    </div>
  )
}

function AnnotationTooltip({
  description,
  label,
  children,
}: {
  description?: string
  label: string
  children: ReactNode
}) {
  if (description === undefined) return <>{children}</>
  return (
    <HoverCard openDelay={250} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-3"
        aria-label={label}
      >
        <Markdown className="max-w-none text-xs text-popover-foreground [&_p]:my-0">
          {description}
        </Markdown>
      </HoverCardContent>
    </HoverCard>
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

function renderTextWithBreaks(value: string): ReactNode {
  return keyedLines(value).map(({ key, line }, position) => (
    <Fragment key={key}>
      {position > 0 && <br />}
      {line}
    </Fragment>
  ))
}

function renderCellText(value: string): ReactNode {
  return keyedLines(value).map(({ key, line }, position) => {
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

function dropEdge(event: DragEvent<HTMLElement>): DropEdge {
  return dropEdgeAt(event.clientX, event.currentTarget.getBoundingClientRect())
}

function normalizeResultsTablePreferences(
  value: unknown,
  columns: ResultTableColumn[],
  variants: ResultVariant[],
) {
  return normalizeResultsViewDefinition(
    value,
    columns.map((column) => column.id),
    variants.map((variant) => variant.id),
  )
}
