// Results View definitions: shape, scope helpers and the single validation
// contract (experiment-results-views "View definitions share one validation
// contract"). `isExperimentResultsViewDefinition` is the strict guard used at
// the View API boundary; `normalizeResultsViewDefinition` is the
// summary-aware normalizer used when a stored View is rendered (legacy
// `schema:<key>` ids resolve there, stale ids drop silently, malformed
// entries are counted). Both are built from the same element predicates.

import type { ProjectTarget } from '../api'
import { columnAcceptsDisplay, isDisplaySelection, parseStatKey } from './stats'

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
  /** Legacy flat hidden-column list; folded into `nodeVisibility` when rendered. */
  hiddenColumnIds: string[]
  /** Legacy flat column order; orders tree parents that have no saved order. */
  columnOrderIds: string[]
  maxLines: number
  defaultSortRules: ResultsViewSortRule[]
  /**
   * Ordered pins of the single left zone after the Variant column; a stored
   * right pin renders at the end of that zone.
   */
  pinnedColumnIds: Record<ResultsViewPinSide, string[]>
  rowFilters: ResultsViewRowFilter[]
  rowOverrides: Record<string, ResultsViewRowOverride>
  sotaModes: Record<string, ResultsViewSotaMode>
  decimalPlaces: Record<string, number>
  /** Checked state stored on the changed tree node; descendants inherit it. */
  nodeVisibility: Record<string, boolean>
  /** Saved child order per tree parent node id. */
  treeOrder: Record<string, string[]>
  /** Header groups collapsed to one placeholder column. */
  collapsedGroups: string[]
  /** Stats column id → display: a vocabulary statistic or a display template. */
  statsDisplay: Record<string, string>
  /** Stats column id → the statistic sorting, filters and SOTA compare. */
  statsSort: Record<string, string>
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
  nodeVisibility: {},
  treeOrder: {},
  collapsedGroups: [],
  statsDisplay: {},
  statsSort: {},
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

/** A stats display: one vocabulary statistic (one or two levels) or a display template. */
export function isStatsDisplaySelection(value: unknown): value is string {
  return typeof value === 'string' && isDisplaySelection(value)
}

/** A stats sort selection: one vocabulary statistic (one or two levels). */
export function isStatsSortSelection(value: unknown): value is string {
  return typeof value === 'string' && parseStatKey(value) !== null
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
  if (!uniqueStrings(value.collapsedGroups)) return false
  if (
    !isRecord(value.treeOrder) ||
    !Object.values(value.treeOrder).every((order) => uniqueStrings(order))
  ) {
    return false
  }
  return (
    recordValues(value.rowOverrides, isRowOverride) &&
    recordValues(value.sotaModes, isSotaMode) &&
    recordValues(value.decimalPlaces, isDecimalPlaces) &&
    recordValues(value.nodeVisibility, (entry) => typeof entry === 'boolean') &&
    recordValues(value.statsDisplay, isStatsDisplaySelection) &&
    recordValues(value.statsSort, isStatsSortSelection)
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

// ── Legacy column identifiers ───────────────────────────────────────────────

/** The prefix of a pre-v9 flat column id (`schema:<key>`). */
export const LEGACY_COLUMN_PREFIX = 'schema:'

/**
 * One v8 key segment as the v8 → v9 migration sanitizes it (mirrors core's
 * `sanitizeSegment`): invalid characters become `_`, a leading digit or
 * hyphen gains a `_` prefix.
 */
function sanitizeSegment(raw: string): string {
  let segment = raw.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!/^[A-Za-z_]/.test(segment)) segment = `_${segment}`
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment) ? segment : '_'
}

/**
 * Resolve a stored column id against the current columns: an existing id
 * stays; a legacy `schema:<key>` refers to the unique `params.<key>` or
 * `metrics.<key>` path the migration produced; anything else is stale (null).
 */
export function resolveViewColumnId(id: string, columnIds: ReadonlySet<string>): string | null {
  if (columnIds.has(id)) return id
  if (!id.startsWith(LEGACY_COLUMN_PREFIX)) return null
  const key = id.slice(LEGACY_COLUMN_PREFIX.length)
  if (key === '') return null
  const segments = key.split('.').map(sanitizeSegment).join('.')
  const candidates = [`params.${segments}`, `metrics.${segments}`].filter((path) =>
    columnIds.has(path),
  )
  return candidates.length === 1 ? candidates[0]! : null
}

// ── Summary-aware normalizer (rendering) ────────────────────────────────────

/** What the normalizer checks a stored View against. */
export interface ResultsViewDocument {
  /** Every column id: built-ins and result paths. */
  columnIds: readonly string[]
  /** Every tree node id (groups, partitions and leaves). */
  nodeIds: ReadonlySet<string>
  /** Tree parents whose child order may be saved (including the tree root). */
  parentIds: ReadonlySet<string>
  /** Header groups that may collapse. */
  collapsibleGroupIds: ReadonlySet<string>
  variantIds: Iterable<string>
  /** Stats column id → the statistics its display dropdown offers. */
  statOptions: ReadonlyMap<string, readonly string[]>
}

export interface NormalizedResultsViewDefinition {
  definition: ExperimentResultsViewDefinition
  /**
   * Saved entries ignored because they are malformed (wrong type, unknown
   * operator/direction/mode/statistic, out-of-range number, duplicate pin or
   * sort column). References to columns, nodes or Variants absent from the
   * current summary are stale, not invalid, and are not counted.
   */
  invalidCount: number
}

/**
 * Fit a stored (possibly legacy or partial) definition to the current Results
 * summary. Absent fields take defaults; legacy `schema:<key>` ids resolve to
 * their result paths; stale ids drop silently; the legacy hidden list folds
 * into node visibility; filters and sort rules with a missing or duplicate ID
 * keep their condition under a new ID; anything else malformed is dropped
 * and counted. Without a document the definition is only completed (seed
 * Views): every syntactically valid entry is kept. The output always
 * satisfies {@link isExperimentResultsViewDefinition}.
 */
export function normalizeResultsViewDefinition(
  value: unknown,
  document?: ResultsViewDocument,
): NormalizedResultsViewDefinition {
  const candidate = isRecord(value) ? value : {}
  const columnIds = document ? new Set(document.columnIds) : null
  const variantIds = document ? new Set(document.variantIds) : null
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
  /** The current column id of a stored reference, or null when stale. */
  const column = (id: string): string | null =>
    columnIds === null ? id : resolveViewColumnId(id, columnIds)

  // Legacy flat lists: non-strings are invalid; stale and duplicate ids are cleaned.
  const columnIdList = (field: string) => {
    const seen = new Set<string>()
    for (const id of list(field)) {
      if (typeof id !== 'string') invalid()
      else {
        const resolved = column(id)
        if (resolved !== null) seen.add(resolved)
      }
    }
    return [...seen]
  }
  const legacyHidden = columnIdList('hiddenColumnIds')
  const columnOrderIds = columnIdList('columnOrderIds')

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
    const out: string[] = []
    for (const id of raw) {
      if (typeof id !== 'string' || pinnedSeen.has(id)) {
        invalid()
        continue
      }
      pinnedSeen.add(id)
      const resolved = column(id)
      // The Variant column is always pinned first; it is never a stored pin.
      if (resolved === null || resolved === 'variant' || out.includes(resolved)) continue
      out.push(resolved)
    }
    return out
  }
  const left = pinSide(pinned.left)
  const right = pinSide(pinned.right).filter((id) => !left.includes(id))
  const pinnedColumnIds = { left, right }

  const usedSortIds = new Set<string>()
  const sortColumns = new Set<string>()
  const defaultSortRules = list('defaultSortRules').flatMap((item, index) => {
    if (!isRecord(item) || typeof item.columnId !== 'string' || !isSortDirection(item.direction)) {
      invalid()
      return []
    }
    const columnId = column(item.columnId)
    if (columnId === null) return []
    if (sortColumns.has(columnId)) {
      invalid()
      return []
    }
    sortColumns.add(columnId)
    const id = entryId(item.id, `restored-sort-${index}`, usedSortIds)
    return [{ id, columnId, direction: item.direction }]
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
    const columnId = column(item.columnId)
    if (columnId === null) return []
    const id = entryId(item.id, `restored-filter-${index}`, usedFilterIds)
    return [{ id, columnId, operator: item.operator, value: item.value }]
  })

  const rowOverrides: Record<string, ResultsViewRowOverride> = {}
  for (const [variantId, override] of Object.entries(record(candidate.rowOverrides))) {
    if (!isRowOverride(override)) invalid()
    else if (variantIds === null || variantIds.has(variantId)) rowOverrides[variantId] = override
  }

  const sotaModes: Record<string, ResultsViewSotaMode> = {}
  for (const [columnId, mode] of Object.entries(record(candidate.sotaModes))) {
    if (!isSotaMode(mode)) invalid()
    else {
      const resolved = column(columnId)
      // `off` is the default and is stored as absence.
      if (resolved !== null && mode !== 'off') sotaModes[resolved] = mode
    }
  }

  const decimalPlaces: Record<string, number> = {}
  for (const [columnId, raw] of Object.entries(record(candidate.decimalPlaces))) {
    const places = typeof raw === 'number' ? Math.floor(raw) : Number.NaN
    if (!isDecimalPlaces(places)) invalid()
    else {
      const resolved = column(columnId)
      if (resolved !== null) decimalPlaces[resolved] = places
    }
  }

  const nodeVisibility: Record<string, boolean> = {}
  for (const [nodeId, visible] of Object.entries(record(candidate.nodeVisibility))) {
    if (typeof visible !== 'boolean') invalid()
    else if (!document || document.nodeIds.has(nodeId)) nodeVisibility[nodeId] = visible
    else {
      const resolved = column(nodeId)
      if (resolved !== null && document.nodeIds.has(resolved)) nodeVisibility[resolved] = visible
    }
  }
  // A legacy hidden column hides that leaf unless the tree records a choice for it.
  if (document) {
    for (const id of legacyHidden) {
      if (document.nodeIds.has(id) && nodeVisibility[id] === undefined) nodeVisibility[id] = false
    }
  }

  const treeOrder: Record<string, string[]> = {}
  for (const [parentId, raw] of Object.entries(record(candidate.treeOrder))) {
    if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string')) {
      invalid()
      continue
    }
    if (document && !document.parentIds.has(parentId)) continue
    const seen = new Set<string>()
    for (const id of raw as string[]) {
      if (!document || document.nodeIds.has(id)) seen.add(id)
    }
    if (seen.size > 0) treeOrder[parentId] = [...seen]
  }

  const collapsedSeen = new Set<string>()
  for (const id of list('collapsedGroups')) {
    if (typeof id !== 'string') invalid()
    else if (!document || document.collapsibleGroupIds.has(id)) collapsedSeen.add(id)
  }

  const statsDisplay: Record<string, string> = {}
  for (const [columnId, selection] of Object.entries(record(candidate.statsDisplay))) {
    if (!isStatsDisplaySelection(selection)) {
      invalid()
      continue
    }
    const resolved = column(columnId)
    if (resolved === null) continue
    const options = document?.statOptions.get(resolved)
    if (document && (!options || !columnAcceptsDisplay(selection, options))) continue
    statsDisplay[resolved] = selection
  }

  const statsSort: Record<string, string> = {}
  for (const [columnId, stat] of Object.entries(record(candidate.statsSort))) {
    if (!isStatsSortSelection(stat)) {
      invalid()
      continue
    }
    const resolved = column(columnId)
    if (resolved === null) continue
    const options = document?.statOptions.get(resolved)
    if (document && !options?.includes(stat)) continue
    statsSort[resolved] = stat
  }

  return {
    definition: {
      hiddenColumnIds: document ? [] : legacyHidden,
      columnOrderIds,
      maxLines,
      defaultSortRules,
      pinnedColumnIds,
      rowFilters,
      rowOverrides,
      sotaModes,
      decimalPlaces,
      nodeVisibility,
      treeOrder,
      collapsedGroups: [...collapsedSeen],
      statsDisplay,
      statsSort,
    },
    invalidCount,
  }
}

/** A complete definition from any stored or legacy value (no document checks). */
export function completeResultsViewDefinition(value: unknown): ExperimentResultsViewDefinition {
  return normalizeResultsViewDefinition(value).definition
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
