'use client'

// Results table container: reads the Results document and the active shared
// View, derives columns/rows, and wires edits to the subcomponents in
// `./results-table/`. Pure logic lives in `lib/experiment-results/`.

import type { ResultsDocument, ResultsVariantEligibility } from '@memon/core'
import { Eye } from 'lucide-react'
import { useMemo, useReducer, useRef } from 'react'
import type { ProjectTarget } from '../lib/api'
import {
  arrangeColumns,
  buildColumns,
  distinctValues,
  excludedRunIds,
} from '../lib/experiment-results/columns'
import * as edits from '../lib/experiment-results/definition-edits'
import { filterVariants } from '../lib/experiment-results/filters'
import { effectiveSortRules, sortVariants } from '../lib/experiment-results/sorting'
import { computeSotaRanks } from '../lib/experiment-results/sota'
import {
  INITIAL_TRANSIENT_STATE,
  transientReducer,
} from '../lib/experiment-results/transient-state'
import type { DragKind, DropEdge } from '../lib/experiment-results/types'
import {
  DEFAULT_RESULTS_VIEW_DEFINITION,
  type ExperimentResultsViewDefinition,
  normalizeResultsViewDefinition,
  type ResultsViewRowFilter,
  type ResultsViewSortRule,
} from '../lib/experiment-results/views'
import { useExperimentResultsViews } from '../lib/use-experiment-results-views'
import { useUserPreferenceState } from '../lib/use-user-preference-state'
import { ColumnOptions } from './results-table/column-options'
import { ColumnToolbar } from './results-table/column-toolbar'
import { FilterBar } from './results-table/filter-bar'
import { ResultsGrid } from './results-table/results-grid'
import { useDragReorder } from './results-table/use-drag-reorder'
import { ViewSwitcher } from './results-table/view-switcher'
import { Button } from './ui/button'
import { Separator } from './ui/separator'

type Definition = ExperimentResultsViewDefinition

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
  // ── Document-derived data ────────────────────────────────────────────────
  const columns = useMemo(
    () => buildColumns(document, excludedRunIds(deprecatedRuns, variantEligibility)),
    [document, deprecatedRuns, variantEligibility],
  )
  const columnIds = useMemo(() => columns.map((column) => column.id), [columns])
  const variantIds = useMemo(() => document.variants.map((row) => row.id), [document.variants])
  const eligibilityByVariant = useMemo(
    () => new Map(variantEligibility?.map((row) => [row.variantId, row])),
    [variantEligibility],
  )
  const affectedEligibility = useMemo(
    () => variantEligibility?.filter((row) => row.metricsValidity !== 'valid') ?? [],
    [variantEligibility],
  )
  const declaredRunIds = useMemo(() => new Set(runIds), [runIds])
  const domains = useMemo(
    () =>
      new Map(
        columns.map((column) => [column.id, distinctValues(document.variants, column)] as const),
      ),
    [columns, document.variants],
  )

  // ── Persistent View definition and Project-wide stars ────────────────────
  const resultsViews = useExperimentResultsViews(
    project,
    experimentId,
    DEFAULT_RESULTS_VIEW_DEFINITION,
  )
  const { definition, invalidCount } = normalizeResultsViewDefinition(
    resultsViews.definition,
    columnIds,
    variantIds,
  )
  const projectKey = typeof project === 'string' ? project : `${project.host}:${project.project}`
  const [storedStarredLabels, setStoredStarredLabels] = useUserPreferenceState<string[]>(
    `memon:results-table:${projectKey}:starred-column-labels`,
    [],
  )
  const starredLabels = new Set(stringList(storedStarredLabels))

  // ── Mounted-only state ───────────────────────────────────────────────────
  const [transient, dispatch] = useReducer(transientReducer, INITIAL_TRANSIENT_STATE)
  const { showAllColumns, showAllRows, temporarySort } = transient
  const entrySequence = useRef(0)

  /** Apply an edit to the latest stored definition (race-safe accumulation). */
  const edit = (change: (current: Definition) => Definition) => {
    resultsViews.updateDefinition((stored) =>
      change(normalizeResultsViewDefinition(stored, columnIds, variantIds).definition),
    )
  }
  /** Sort-chain edits also end any temporary header sort. */
  const editSorts = (change: (current: Definition) => Definition) => {
    dispatch({ type: 'clear-temporary-sort' })
    edit(change)
  }
  const nextId = (prefix: 'filter' | 'sort') => edits.newEntryId(prefix, entrySequence.current++)

  const reorder = (kind: DragKind, sourceId: string, targetId: string, edge: DropEdge) => {
    if (kind === 'column') edit((d) => edits.reorderColumns(d, sourceId, targetId, edge))
    else if (kind === 'row-filter') {
      edit((d) => edits.reorderRowFilters(d, sourceId, targetId, edge))
    } else editSorts((d) => edits.reorderSortRules(d, sourceId, targetId, edge))
  }
  const drag = useDragReorder(transient, dispatch, reorder)

  const setColumnVisible = (columnId: string, visible: boolean) =>
    edit((d) => edits.setColumnVisible(d, columnId, visible))
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
  const arrangement = arrangeColumns(columns, definition, showAllColumns)
  const sotaRanks = useMemo(
    () => computeSotaRanks(document.variants, columns, definition.sotaModes, eligibilityByVariant),
    [document.variants, columns, definition.sotaModes, eligibilityByVariant],
  )
  const filteredVariants = useMemo(
    () =>
      filterVariants(
        document.variants,
        columns,
        definition.rowFilters,
        definition.rowOverrides,
        showAllRows,
      ),
    [columns, document.variants, definition.rowFilters, definition.rowOverrides, showAllRows],
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
  const resetDisabled = edits.isPristineView(definition, columnIds, {
    showAllColumns,
    showAllRows,
    hasTemporarySort: temporarySort !== null,
  })

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
          visibleCount={arrangement.visibleColumns.length}
          totalCount={columns.length}
          hiddenCount={definition.hiddenColumnIds.length}
          showAllColumns={showAllColumns}
          onShowAllColumnsChange={(value) => dispatch({ type: 'show-all-columns', value })}
          maxLines={definition.maxLines}
          onMaxLinesChange={(value) => edit((d) => edits.setMaxLines(d, value))}
          resetDisabled={resetDisabled}
          onReset={resetView}
        />
        <ColumnOptions
          experimentId={experimentId}
          locked={locked}
          columns={arrangement.orderedColumns}
          hiddenColumnIds={new Set(definition.hiddenColumnIds)}
          domains={domains}
          starredLabels={starredLabels}
          pinnedColumnSide={arrangement.pinnedColumnSide}
          drag={drag}
          onVisibleChange={setColumnVisible}
          onToggleStar={toggleStar}
        />
        <Separator />
        <FilterBar
          experimentId={experimentId}
          locked={locked}
          shownRowCount={filteredVariants.length}
          totalRowCount={document.variants.length}
          columns={arrangement.orderedColumns}
          domains={domains}
          rowFilters={definition.rowFilters}
          rowOverrideCount={Object.keys(definition.rowOverrides).length}
          showAllRows={showAllRows}
          onShowAllRowsChange={(value) => dispatch({ type: 'show-all-rows', value })}
          defaultSortRules={definition.defaultSortRules}
          temporarySort={temporarySort}
          temporarySortLabel={
            temporarySort ? arrangement.columnsById.get(temporarySort.columnId)?.label : undefined
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

      {document.variants.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs italic text-muted-foreground">
          No variants yet.
        </div>
      ) : arrangement.visibleColumns.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
          Select at least one column to show the results table.
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
          columns={arrangement.orderedVisibleColumns}
          variants={sortedVariants}
          context={{
            project,
            experimentId,
            declaredRunIds,
            maxLines: definition.maxLines,
            starredLabels,
            pinnedColumnSide: arrangement.pinnedColumnSide,
            sotaRanks,
            decimalPlaces: definition.decimalPlaces,
          }}
          eligibilityByVariant={eligibilityByVariant}
          rowOverrides={definition.rowOverrides}
          temporarySort={temporarySort}
          sotaModes={definition.sotaModes}
          canMutate={resultsViews.canMutate}
          drag={drag}
          headerActions={{
            onCycleSort: (columnId) => dispatch({ type: 'cycle-sort', columnId }),
            onHide: (columnId) => setColumnVisible(columnId, false),
            onPin: (columnId, side) => edit((d) => edits.setColumnPin(d, columnId, side)),
            onToggleStar: toggleStar,
            onSetSotaMode: (columnId, mode) => edit((d) => edits.setSotaMode(d, columnId, mode)),
            onSetDecimalPlaces: (columnId, places) =>
              edit((d) => edits.setDecimalPlaces(d, columnId, places)),
          }}
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
