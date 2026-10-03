'use client'

// Results table container: renders the generated Results summary with the
// active shared View — the vertical column tree, the two-row header, pinned
// zone, stats displays, filters and sorts — and wires edits to the
// subcomponents in `./results-table/`. Pure logic lives in
// `lib/experiment-results/`.

import { Eye } from 'lucide-react'
import { useMemo, useReducer, useRef } from 'react'
import type { ProjectTarget } from '../lib/api'
import type { ResultsSummaryPayload } from '../lib/dto/experiments'
import { buildColumns, distinctValues } from '../lib/experiment-results/columns'
import * as edits from '../lib/experiment-results/definition-edits'
import { filterVariants } from '../lib/experiment-results/filters'
import { effectiveSortRules, sortVariants } from '../lib/experiment-results/sorting'
import { computeSotaRanks } from '../lib/experiment-results/sota'
import {
  INITIAL_TRANSIENT_STATE,
  transientReducer,
} from '../lib/experiment-results/transient-state'
import {
  buildColumnTree,
  type ColumnTree,
  columnBreadcrumb,
  isBandGroup,
  isLeafVisible,
  layoutGrid,
  nodeCheckState,
  TREE_ROOT,
} from '../lib/experiment-results/tree'
import type { DragItem, DropEdge, ResultTableColumn } from '../lib/experiment-results/types'
import {
  DEFAULT_RESULTS_VIEW_DEFINITION,
  type ExperimentResultsViewDefinition,
  normalizeResultsViewDefinition,
  type ResultsViewDocument,
  type ResultsViewRowFilter,
  type ResultsViewSortRule,
} from '../lib/experiment-results/views'
import { useExperimentResultsViews } from '../lib/use-experiment-results-views'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { ColumnToolbar } from './results-table/column-toolbar'
import { ColumnTreeControls } from './results-table/column-tree'
import { FilterBar } from './results-table/filter-bar'
import { ResultsGrid } from './results-table/results-grid'
import { useDragReorder } from './results-table/use-drag-reorder'
import { ViewSwitcher } from './results-table/view-switcher'
import { Button } from './ui/button'
import { Separator } from './ui/separator'

type Definition = ExperimentResultsViewDefinition

/** What a stored View is normalized against, from the summary's columns and tree. */
function viewDocument(
  columns: readonly ResultTableColumn[],
  tree: ColumnTree,
  variantIds: readonly string[],
): ResultsViewDocument {
  const parentIds = new Set<string>([TREE_ROOT])
  const collapsibleGroupIds = new Set<string>()
  for (const node of tree.nodes.values()) {
    if (node.kind === 'column') continue
    parentIds.add(node.id)
    if (isBandGroup(tree, node)) collapsibleGroupIds.add(node.id)
  }
  return {
    columnIds: columns.map((column) => column.id),
    nodeIds: new Set(tree.nodes.keys()),
    parentIds,
    collapsibleGroupIds,
    variantIds,
    statOptions: new Map(
      columns
        .filter((column) => column.statOptions.length > 0)
        .map((column) => [column.id, column.statOptions] as const),
    ),
  }
}

export function ExperimentResultsTable({
  summary,
  project,
  experimentId,
  runIds,
}: {
  /** An ok Results summary. */
  summary: ResultsSummaryPayload
  project: ProjectTarget
  experimentId: string
  /** Run paths declared by the Experiment's `runs` frontmatter. */
  runIds: string[]
}) {
  // ── Summary-derived structure (independent of the View) ──────────────────
  const baseColumns = useMemo(() => buildColumns(summary), [summary])
  const baseTree = useMemo(
    () => buildColumnTree(baseColumns, summary.groups),
    [baseColumns, summary.groups],
  )
  const variantIds = useMemo(() => summary.variants.map((row) => row.id), [summary.variants])
  const document = useMemo(
    () => viewDocument(baseColumns, baseTree, variantIds),
    [baseColumns, baseTree, variantIds],
  )
  const declaredRunIds = useMemo(() => new Set(runIds), [runIds])

  // ── Persistent View definition and Project-wide stars ────────────────────
  const resultsViews = useExperimentResultsViews(
    project,
    experimentId,
    DEFAULT_RESULTS_VIEW_DEFINITION,
  )
  const { definition, invalidCount } = normalizeResultsViewDefinition(
    resultsViews.definition,
    document,
  )
  const projectKey = typeof project === 'string' ? project : `${project.host}:${project.project}`
  const [storedStarredLabels, setStoredStarredLabels] = useUserPreferenceState<string[]>(
    `memon:results-table:${projectKey}:starred-column-labels`,
    [],
  )
  const starredLabels = new Set(stringList(storedStarredLabels))

  // ── View-dependent columns and tree ──────────────────────────────────────
  const columns = useMemo(
    () =>
      buildColumns(summary, {
        statsDisplay: definition.statsDisplay,
        statsSort: definition.statsSort,
        decimalPlaces: definition.decimalPlaces,
      }),
    [summary, definition.statsDisplay, definition.statsSort, definition.decimalPlaces],
  )
  const treeFor = (d: Definition) =>
    buildColumnTree(columns, summary.groups, {
      treeOrder: d.treeOrder,
      legacyOrder: d.columnOrderIds,
    })
  const tree = useMemo(
    () =>
      buildColumnTree(columns, summary.groups, {
        treeOrder: definition.treeOrder,
        legacyOrder: definition.columnOrderIds,
      }),
    [columns, summary.groups, definition.treeOrder, definition.columnOrderIds],
  )
  const variantColumn = columns[0]!
  const domains = useMemo(
    () =>
      new Map(
        columns.map((column) => [column.id, distinctValues(summary.variants, column)] as const),
      ),
    [columns, summary.variants],
  )

  // ── Mounted-only state ───────────────────────────────────────────────────
  const [transient, dispatch] = useReducer(transientReducer, INITIAL_TRANSIENT_STATE)
  const { showAllColumns, showAllRows, temporarySort } = transient
  const entrySequence = useRef(0)

  /** Apply an edit to the latest stored definition (race-safe accumulation). */
  const edit = (change: (current: Definition) => Definition) => {
    resultsViews.updateDefinition((stored) =>
      change(normalizeResultsViewDefinition(stored, document).definition),
    )
  }
  /** Sort-chain edits also end any temporary header sort. */
  const editSorts = (change: (current: Definition) => Definition) => {
    dispatch({ type: 'clear-temporary-sort' })
    edit(change)
  }
  const nextId = (prefix: 'filter' | 'sort') => edits.newEntryId(prefix, entrySequence.current++)

  const reorder = (dragged: DragItem, target: DragItem, edge: DropEdge) => {
    if (dragged.kind === 'tree-node' || dragged.kind === 'column') {
      edit((d) => edits.reorderTreeNode(d, treeFor(d), dragged.id, target.id, edge))
    } else if (dragged.kind === 'pinned') {
      edit((d) => edits.reorderPinned(d, dragged.id, target.id, edge))
    } else if (dragged.kind === 'row-filter') {
      edit((d) => edits.reorderRowFilters(d, dragged.id, target.id, edge))
    } else editSorts((d) => edits.reorderSortRules(d, dragged.id, target.id, edge))
  }
  const drag = useDragReorder(transient, dispatch, reorder)

  const setNodeVisible = (nodeId: string, visible: boolean) =>
    edit((d) => edits.setNodeVisible(d, treeFor(d), nodeId, visible))
  const setPinned = (columnId: string, pinned: boolean) =>
    edit((d) => edits.setColumnPinned(d, columnId, pinned))
  const toggleStar = (label: string) =>
    setStoredStarredLabels((current) => {
      const next = new Set(stringList(current))
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return Array.from(next)
    })
  const saveRowFilter = (filter: Omit<ResultsViewRowFilter, 'id'>, filterId?: string) =>
    edit((d) => edits.upsertRowFilter(d, { id: filterId ?? nextId('filter'), ...filter }))
  const saveSortRule = (rule: Omit<ResultsViewSortRule, 'id'>, ruleId?: string) =>
    editSorts((d) => edits.upsertSortRule(d, { id: ruleId ?? nextId('sort'), ...rule }))
  const resetView = () => {
    resultsViews.updateDefinition(DEFAULT_RESULTS_VIEW_DEFINITION)
    dispatch({ type: 'reset' })
  }

  // ── Rows and columns to render ───────────────────────────────────────────
  const visible = (leafId: string) =>
    showAllColumns || isLeafVisible(tree, leafId, definition.nodeVisibility)
  const storedVisible = (leafId: string) => isLeafVisible(tree, leafId, definition.nodeVisibility)
  const pinnedIds = edits.pinnedOrder(definition)
  const layout = layoutGrid(tree, variantColumn, {
    visible,
    pinned: pinnedIds,
    collapsed: new Set(definition.collapsedGroups),
  })
  const orderedColumns = [variantColumn, ...tree.leafOrder.map((id) => tree.nodes.get(id)!.column!)]
  const visibleLeafCount = tree.leafOrder.filter(visible).length
  const hiddenLeafCount = tree.leafOrder.filter((id) => !storedVisible(id)).length

  const sotaRanks = useMemo(
    () => computeSotaRanks(summary.variants, columns, definition.sotaModes),
    [summary.variants, columns, definition.sotaModes],
  )
  const filteredVariants = useMemo(
    () =>
      filterVariants(
        summary.variants,
        columns,
        definition.rowFilters,
        definition.rowOverrides,
        showAllRows,
      ),
    [columns, summary.variants, definition.rowFilters, definition.rowOverrides, showAllRows],
  )
  const sortedVariants = useMemo(
    () =>
      sortVariants(
        filteredVariants,
        columns,
        effectiveSortRules(temporarySort, definition.defaultSortRules),
      ),
    [columns, definition.defaultSortRules, filteredVariants, temporarySort],
  )
  const locked = !resultsViews.canMutate || !resultsViews.activeView
  const resetDisabled = edits.isPristineView(definition, {
    showAllColumns,
    showAllRows,
    hasTemporarySort: temporarySort !== null,
  })
  const pinnedEntries = pinnedIds.flatMap((id) => {
    const column = tree.nodes.get(id)?.column
    return column ? [{ id, label: columnBreadcrumb(tree, column) }] : []
  })

  return (
    <div className="min-w-0 space-y-3" data-slot="results-table">
      {invalidCount > 0 && (
        <p
          role="note"
          className="text-xs text-amber-700 dark:text-amber-300"
          data-slot="results-view-invalid"
        >
          {invalidCount} saved View {invalidCount === 1 ? 'setting is' : 'settings are'} invalid and
          ignored.
        </p>
      )}
      <div className="space-y-3 rounded-md border bg-muted/20 p-3" data-slot="results-controls">
        <ViewSwitcher
          experimentId={experimentId}
          views={resultsViews}
          onActiveViewReplaced={() => dispatch({ type: 'reset' })}
        />
        <ColumnToolbar
          experimentId={experimentId}
          locked={locked}
          visibleCount={visibleLeafCount + 1}
          totalCount={tree.leafOrder.length + 1}
          hiddenCount={hiddenLeafCount}
          showAllColumns={showAllColumns}
          onShowAllColumnsChange={(value) => dispatch({ type: 'show-all-columns', value })}
          maxLines={definition.maxLines}
          onMaxLinesChange={(value) => edit((d) => edits.setMaxLines(d, value))}
          resetDisabled={resetDisabled}
          onReset={resetView}
        />
        <ColumnTreeControls
          experimentId={experimentId}
          locked={locked}
          tree={tree}
          checkState={(node) => nodeCheckState(node, storedVisible)}
          domains={domains}
          starredLabels={starredLabels}
          pinned={pinnedEntries}
          drag={drag}
          onSetVisible={setNodeVisible}
          onSetPinned={setPinned}
          onToggleStar={toggleStar}
        />
        <Separator />
        <FilterBar
          experimentId={experimentId}
          locked={locked}
          shownRowCount={filteredVariants.length}
          totalRowCount={summary.variants.length}
          columns={orderedColumns}
          domains={domains}
          rowFilters={definition.rowFilters}
          rowOverrideCount={Object.keys(definition.rowOverrides).length}
          showAllRows={showAllRows}
          onShowAllRowsChange={(value) => dispatch({ type: 'show-all-rows', value })}
          defaultSortRules={definition.defaultSortRules}
          temporarySort={temporarySort}
          temporarySortLabel={
            temporarySort
              ? orderedColumns.find((column) => column.id === temporarySort.columnId)?.label
              : undefined
          }
          drag={drag}
          onSaveFilter={saveRowFilter}
          onRemoveFilter={(id) => edit((d) => edits.removeRowFilter(d, id))}
          onSaveSort={saveSortRule}
          onRemoveSort={(id) => editSorts((d) => edits.removeSortRule(d, id))}
          onMoveSort={(id, offset) => editSorts((d) => edits.moveSortRule(d, id, offset))}
          onClearTemporarySort={() => dispatch({ type: 'clear-temporary-sort' })}
        />
      </div>

      {summary.variants.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs italic text-muted-foreground">
          No variants yet.
        </div>
      ) : filteredVariants.length === 0 ? (
        <div className="space-y-2 rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
          <p>No rows match the saved filters.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'show-all-rows', value: true })}
          >
            <Eye data-icon="inline-start" />
            Show all rows temporarily
          </Button>
        </div>
      ) : (
        <ResultsGrid
          layout={layout}
          variants={sortedVariants}
          context={{
            project,
            experimentId,
            declaredRunIds,
            maxLines: definition.maxLines,
            starredLabels,
            sotaRanks,
            decimalPlaces: definition.decimalPlaces,
          }}
          rowOverrides={definition.rowOverrides}
          temporarySort={temporarySort}
          sotaModes={definition.sotaModes}
          statsDisplay={definition.statsDisplay}
          statsSort={definition.statsSort}
          canMutate={resultsViews.canMutate}
          drag={drag}
          headerActions={{
            onCycleSort: (columnId) => dispatch({ type: 'cycle-sort', columnId }),
            onHide: (columnId) => setNodeVisible(columnId, false),
            onSetPinned: setPinned,
            onToggleStar: toggleStar,
            onSetSotaMode: (columnId, mode) => edit((d) => edits.setSotaMode(d, columnId, mode)),
            onSetDecimalPlaces: (columnId, places) =>
              edit((d) => edits.setDecimalPlaces(d, columnId, places)),
            onSetStatsDisplay: (columnId, selection) =>
              editSorts((d) => edits.setStatsDisplay(d, columnId, selection)),
            onSetStatsSort: (columnId, stat) =>
              editSorts((d) => edits.setStatsSort(d, columnId, stat)),
          }}
          onToggleCollapsed={(groupId) => edit((d) => edits.toggleGroupCollapsed(d, groupId))}
          onSetRowOverride={(variantId, override) =>
            edit((d) => edits.setRowOverride(d, variantId, override))
          }
        />
      )}
    </div>
  )
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((label): label is string => typeof label === 'string')
    : []
}
