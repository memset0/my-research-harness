// Results View definitions: shape, scope helpers and the single validation
// contract (experiment-results-views "View definitions share one validation
// contract"). `isExperimentResultsViewDefinition` is the strict guard used at
// the View API boundary; `normalizeResultsViewDefinition` is the
// document-aware normalizer used when a stored View is rendered. Both are
// built from the same element predicates below.

import type { ProjectTarget } from '../api'

export type ResultsViewSortDirection = 'asc' | 'desc'
export type ResultsViewRowFilterOperator = 'eq' | 'neq' | 'gt' | 'lt'
export type ResultsViewRowOverride = 'include' | 'exclude'
export type ResultsViewPinSide = 'left' | 'right'
export type ResultsViewSotaMode = 'off' | 'higher-is-better' | 'lower-is-better'

export interface ResultsViewRowFilter {
  id: string
  columnId: string
  operator: ResultsViewRowFilterOperator
  value: string
}

export interface ResultsViewSortRule {
  id: string
  columnId: string
  direction: ResultsViewSortDirection
}

export interface ExperimentResultsViewDefinition {
  hiddenColumnIds: string[]
  columnOrderIds: string[]
  maxLines: number
  defaultSortRules: ResultsViewSortRule[]
  pinnedColumnIds: Record<ResultsViewPinSide, string[]>
  rowFilters: ResultsViewRowFilter[]
  rowOverrides: Record<string, ResultsViewRowOverride>
  sotaModes: Record<string, ResultsViewSotaMode>
  decimalPlaces: Record<string, number>
}

export interface ExperimentResultsViewScope {
  host: string | null
  project: string
  experimentId: string
}

export interface ExperimentResultsView {
  id: string
  scope: ExperimentResultsViewScope
  name: string
  definition: ExperimentResultsViewDefinition
  revision: number
  createdAt: number
  updatedAt: number
}

export interface ExperimentResultsViewsResponse {
  views: ExperimentResultsView[]
  canMutate: boolean
}

export const RESULTS_VIEW_NAME_MAX_LENGTH = 96
export const RESULTS_VIEW_DEFINITION_MAX_BYTES = 256 * 1024

export function resultsViewScope(
  project: ProjectTarget,
  experimentId: string,
): ExperimentResultsViewScope {
  return {
    host: typeof project === 'string' ? null : project.host,
    project: typeof project === 'string' ? project : project.project,
    experimentId,
  }
}

export function resultsViewScopeSearch(scope: ExperimentResultsViewScope): string {
  const search = new URLSearchParams()
  if (scope.host) search.set('host', scope.host)
  search.set('project', scope.project)
  search.set('experiment', scope.experimentId)
  return search.toString()
}

export function resultsViewLegacyPreferenceKey(scope: ExperimentResultsViewScope): string {
  const projectKey = scope.host ? `${scope.host}:${scope.project}` : scope.project
  return `memon:results-table:${projectKey}:${scope.experimentId}:preferences`
}

export function resultsViewLocalScopeKey(scope: ExperimentResultsViewScope): string {
  const projectKey = scope.host ? `${scope.host}:${scope.project}` : scope.project
  return `memon:results-views:${projectKey}:${scope.experimentId}`
}

export const RESULTS_VIEW_MAX_DECIMAL_PLACES = 10

export const DEFAULT_RESULTS_VIEW_DEFINITION: ExperimentResultsViewDefinition = {
  hiddenColumnIds: [],
  columnOrderIds: [],
  maxLines: 1,
  defaultSortRules: [],
  pinnedColumnIds: { left: [], right: [] },
  rowFilters: [],
  rowOverrides: {},
  sotaModes: {},
  decimalPlaces: {},
}

// ── Element predicates shared by both entry points ──────────────────────────

export function isSortDirection(value: unknown): value is ResultsViewSortDirection {
  return value === 'asc' || value === 'desc'
}

export function isRowFilterOperator(value: unknown): value is ResultsViewRowFilterOperator {
  return value === 'eq' || value === 'neq' || value === 'gt' || value === 'lt'
}

export function isRowOverride(value: unknown): value is ResultsViewRowOverride {
  return value === 'include' || value === 'exclude'
}

export function isSotaMode(value: unknown): value is ResultsViewSotaMode {
  return value === 'off' || value === 'higher-is-better' || value === 'lower-is-better'
}

/** A positive integer line count. */
export function isMaxLines(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** An integer from 0 through {@link RESULTS_VIEW_MAX_DECIMAL_PLACES}. */
export function isDecimalPlaces(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= RESULTS_VIEW_MAX_DECIMAL_PLACES
  )
}

/** Clamp any number to a valid decimal-places value (non-finite → 0). */
export function clampDecimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(RESULTS_VIEW_MAX_DECIMAL_PLACES, Math.floor(value)))
}

/** Floor any finite number to a valid line count (else 1). */
export function normalizeMaxLines(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

// ── Strict guard (API boundary) ─────────────────────────────────────────────

export function isExperimentResultsViewDefinition(
  value: unknown,
): value is ExperimentResultsViewDefinition {
  if (!isRecord(value)) return false
  if (!uniqueStrings(value.hiddenColumnIds) || !uniqueStrings(value.columnOrderIds)) return false
  if (!isMaxLines(value.maxLines)) return false
  if (!isRecord(value.pinnedColumnIds)) return false
  const { left, right } = value.pinnedColumnIds
  if (!Array.isArray(left) || !Array.isArray(right) || !uniqueStrings([...left, ...right])) {
    return false
  }
  if (
    !Array.isArray(value.defaultSortRules) ||
    !value.defaultSortRules.every(isStrictSortRule) ||
    !uniqueStrings(value.defaultSortRules.map((rule) => rule.id)) ||
    !uniqueStrings(value.defaultSortRules.map((rule) => rule.columnId))
  ) {
    return false
  }
  if (
    !Array.isArray(value.rowFilters) ||
    !value.rowFilters.every(isStrictRowFilter) ||
    !uniqueStrings(value.rowFilters.map((filter) => filter.id))
  ) {
    return false
  }
  return (
    recordValues(value.rowOverrides, isRowOverride) &&
    recordValues(value.sotaModes, isSotaMode) &&
    recordValues(value.decimalPlaces, isDecimalPlaces)
  )
}

function isStrictSortRule(value: unknown): value is ResultsViewSortRule {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.columnId === 'string' &&
    isSortDirection(value.direction)
  )
}

function isStrictRowFilter(value: unknown): value is ResultsViewRowFilter {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.columnId === 'string' &&
    typeof value.value === 'string' &&
    isRowFilterOperator(value.operator)
  )
}

// ── Document-aware normalizer (rendering) ───────────────────────────────────

export interface NormalizedResultsViewDefinition {
  definition: ExperimentResultsViewDefinition
  /**
   * Saved entries ignored because they are malformed (wrong type, unknown
   * operator/direction/mode, out-of-range number, duplicate pin or sort
   * column). References to columns or Variants absent from the current
   * document are stale, not invalid, and are not counted.
   */
  invalidCount: number
}

/**
 * Fit a stored (possibly legacy or partial) definition to the current Results
 * document. Absent fields take defaults; stale IDs are dropped silently;
 * filters and sort rules with a missing or duplicate ID keep their condition
 * under a new ID; anything else malformed is dropped and counted. The output
 * always satisfies {@link isExperimentResultsViewDefinition}.
 */
export function normalizeResultsViewDefinition(
  value: unknown,
  columnIds: readonly string[],
  variantIds: Iterable<string>,
): NormalizedResultsViewDefinition {
  const candidate = isRecord(value) ? value : {}
  const validColumnIds = new Set(columnIds)
  const validVariantIds = new Set(variantIds)
  let invalidCount = 0
  const invalid = () => {
    invalidCount += 1
  }
  const list = (field: string): unknown[] => {
    const raw = candidate[field]
    if (raw === undefined) return []
    if (Array.isArray(raw)) return raw
    invalid()
    return []
  }
  const record = (raw: unknown): Record<string, unknown> => {
    if (raw === undefined) return {}
    if (isRecord(raw)) return raw
    invalid()
    return {}
  }

  // Column ID lists: non-strings are invalid; stale and duplicate IDs are cleaned.
  const columnIdList = (field: string) => {
    const seen = new Set<string>()
    for (const id of list(field)) {
      if (typeof id !== 'string') invalid()
      else if (validColumnIds.has(id)) seen.add(id)
    }
    return [...seen]
  }
  const hiddenColumnIds = columnIdList('hiddenColumnIds')
  const restoredOrder = columnIdList('columnOrderIds')
  const columnOrderIds = [
    ...restoredOrder,
    ...columnIds.filter((id) => !restoredOrder.includes(id)),
  ]

  let maxLines = 1
  if (candidate.maxLines !== undefined) {
    if (typeof candidate.maxLines === 'number' && Number.isFinite(candidate.maxLines)) {
      maxLines = normalizeMaxLines(candidate.maxLines)
    } else invalid()
  }

  const pinned = record(candidate.pinnedColumnIds)
  const pinnedSeen = new Set<string>()
  const pinSide = (raw: unknown): string[] => {
    if (raw === undefined) return []
    if (!Array.isArray(raw)) {
      invalid()
      return []
    }
    return raw.filter((id): id is string => {
      if (typeof id !== 'string' || pinnedSeen.has(id)) {
        invalid()
        return false
      }
      if (!validColumnIds.has(id)) return false
      pinnedSeen.add(id)
      return true
    })
  }
  const pinnedColumnIds = { left: pinSide(pinned.left), right: pinSide(pinned.right) }

  const usedSortIds = new Set<string>()
  const sortColumns = new Set<string>()
  const defaultSortRules = list('defaultSortRules').flatMap((item, index) => {
    if (!isRecord(item) || typeof item.columnId !== 'string' || !isSortDirection(item.direction)) {
      invalid()
      return []
    }
    if (!validColumnIds.has(item.columnId)) return []
    if (sortColumns.has(item.columnId)) {
      invalid()
      return []
    }
    sortColumns.add(item.columnId)
    const id = entryId(item.id, `restored-sort-${index}`, usedSortIds)
    return [{ id, columnId: item.columnId, direction: item.direction }]
  })

  const usedFilterIds = new Set<string>()
  const rowFilters = list('rowFilters').flatMap((item, index) => {
    if (
      !isRecord(item) ||
      typeof item.columnId !== 'string' ||
      !isRowFilterOperator(item.operator) ||
      typeof item.value !== 'string'
    ) {
      invalid()
      return []
    }
    if (!validColumnIds.has(item.columnId)) return []
    const id = entryId(item.id, `restored-filter-${index}`, usedFilterIds)
    return [{ id, columnId: item.columnId, operator: item.operator, value: item.value }]
  })

  const rowOverrides: Record<string, ResultsViewRowOverride> = {}
  for (const [variantId, override] of Object.entries(record(candidate.rowOverrides))) {
    if (!isRowOverride(override)) invalid()
    else if (validVariantIds.has(variantId)) rowOverrides[variantId] = override
  }

  const sotaModes: Record<string, ResultsViewSotaMode> = {}
  for (const [columnId, mode] of Object.entries(record(candidate.sotaModes))) {
    if (!isSotaMode(mode)) invalid()
    // `off` is the default and is stored as absence.
    else if (validColumnIds.has(columnId) && mode !== 'off') sotaModes[columnId] = mode
  }

  const decimalPlaces: Record<string, number> = {}
  for (const [columnId, raw] of Object.entries(record(candidate.decimalPlaces))) {
    const places = typeof raw === 'number' ? Math.floor(raw) : Number.NaN
    if (!isDecimalPlaces(places)) invalid()
    else if (validColumnIds.has(columnId)) decimalPlaces[columnId] = places
  }

  return {
    definition: {
      hiddenColumnIds,
      columnOrderIds,
      maxLines,
      defaultSortRules,
      pinnedColumnIds,
      rowFilters,
      rowOverrides,
      sotaModes,
      decimalPlaces,
    },
    invalidCount,
  }
}

/** Keep a unique string ID, otherwise derive a fresh one from `fallback`. */
function entryId(raw: unknown, fallback: string, used: Set<string>): string {
  let id = typeof raw === 'string' && !used.has(raw) ? raw : fallback
  for (let suffix = 2; used.has(id); suffix += 1) id = `${fallback}-${suffix}`
  used.add(id)
  return id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function uniqueStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string') &&
    new Set(value).size === value.length
  )
}

function recordValues(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): value is Record<string, unknown> {
  return isRecord(value) && Object.values(value).every(predicate)
}
