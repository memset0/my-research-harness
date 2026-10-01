// Pure edits of a Results View definition. Each takes the current (already
// normalized) definition and returns the next one, or the same instance when
// nothing changes, so the container can compose them against the latest
// stored value (race-safe accumulation, see web-dashboard Results
// preference requirements).

import { reorderIds, reorderItems } from './layout'
import type { DropEdge } from './types'
import {
  clampDecimalPlaces,
  type ExperimentResultsViewDefinition as Definition,
  normalizeMaxLines,
  type ResultsViewPinSide,
  type ResultsViewRowFilter,
  type ResultsViewRowOverride,
  type ResultsViewSortRule,
  type ResultsViewSotaMode,
} from './views'

export function setColumnVisible(
  definition: Definition,
  columnId: string,
  visible: boolean,
): Definition {
  const hidden = new Set(definition.hiddenColumnIds)
  if (visible) hidden.delete(columnId)
  else hidden.add(columnId)
  return { ...definition, hiddenColumnIds: Array.from(hidden) }
}

/** Pin to a side (appended to that side's order) or unpin with `null`. */
export function setColumnPin(
  definition: Definition,
  columnId: string,
  side: ResultsViewPinSide | null,
): Definition {
  const next = {
    left: definition.pinnedColumnIds.left.filter((id) => id !== columnId),
    right: definition.pinnedColumnIds.right.filter((id) => id !== columnId),
  }
  if (side) next[side].push(columnId)
  return { ...definition, pinnedColumnIds: next }
}

/** Move a column; pinned groups follow the shared order. */
export function reorderColumns(
  definition: Definition,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Definition {
  const columnOrderIds = reorderIds(definition.columnOrderIds, sourceId, targetId, edge)
  if (columnOrderIds === definition.columnOrderIds) return definition
  const left = new Set(definition.pinnedColumnIds.left)
  const right = new Set(definition.pinnedColumnIds.right)
  return {
    ...definition,
    columnOrderIds,
    pinnedColumnIds: {
      left: columnOrderIds.filter((id) => left.has(id)),
      right: columnOrderIds.filter((id) => right.has(id)),
    },
  }
}

export function reorderRowFilters(
  definition: Definition,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Definition {
  const rowFilters = reorderItems(definition.rowFilters, sourceId, targetId, edge)
  return rowFilters === definition.rowFilters ? definition : { ...definition, rowFilters }
}

export function reorderSortRules(
  definition: Definition,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Definition {
  const defaultSortRules = reorderItems(definition.defaultSortRules, sourceId, targetId, edge)
  return defaultSortRules === definition.defaultSortRules
    ? definition
    : { ...definition, defaultSortRules }
}

/** Replace the filter with the same id in place, or append a new one. */
export function upsertRowFilter(definition: Definition, filter: ResultsViewRowFilter): Definition {
  const exists = definition.rowFilters.some((candidate) => candidate.id === filter.id)
  return {
    ...definition,
    rowFilters: exists
      ? definition.rowFilters.map((candidate) => (candidate.id === filter.id ? filter : candidate))
      : [...definition.rowFilters, filter],
  }
}

export function removeRowFilter(definition: Definition, filterId: string): Definition {
  return {
    ...definition,
    rowFilters: definition.rowFilters.filter((filter) => filter.id !== filterId),
  }
}

export function setRowOverride(
  definition: Definition,
  variantId: string,
  override: ResultsViewRowOverride | null,
): Definition {
  const rowOverrides = { ...definition.rowOverrides }
  if (override) rowOverrides[variantId] = override
  else delete rowOverrides[variantId]
  return { ...definition, rowOverrides }
}

/**
 * Replace the rule with the same id in place, or append a new one; a column
 * keeps only its first rule.
 */
export function upsertSortRule(definition: Definition, rule: ResultsViewSortRule): Definition {
  const exists = definition.defaultSortRules.some((candidate) => candidate.id === rule.id)
  const rules = exists
    ? definition.defaultSortRules.map((candidate) => (candidate.id === rule.id ? rule : candidate))
    : [...definition.defaultSortRules, rule]
  return {
    ...definition,
    defaultSortRules: rules.filter(
      (candidate, index) =>
        rules.findIndex((item) => item.columnId === candidate.columnId) === index,
    ),
  }
}

export function removeSortRule(definition: Definition, ruleId: string): Definition {
  return {
    ...definition,
    defaultSortRules: definition.defaultSortRules.filter((rule) => rule.id !== ruleId),
  }
}

/** Move a sort rule one priority earlier (-1) or later (+1); no-op at the ends. */
export function moveSortRule(definition: Definition, ruleId: string, offset: -1 | 1): Definition {
  const rules = definition.defaultSortRules
  const index = rules.findIndex((rule) => rule.id === ruleId)
  const target = index + offset
  if (index < 0 || target < 0 || target >= rules.length) return definition
  const next = [...rules]
  const [moved] = next.splice(index, 1)
  if (!moved) return definition
  next.splice(target, 0, moved)
  return { ...definition, defaultSortRules: next }
}

export function setSotaMode(
  definition: Definition,
  columnId: string,
  mode: ResultsViewSotaMode,
): Definition {
  const sotaModes = { ...definition.sotaModes }
  // `off` is the default and is stored as absence.
  if (mode === 'off') delete sotaModes[columnId]
  else sotaModes[columnId] = mode
  return { ...definition, sotaModes }
}

export function setDecimalPlaces(
  definition: Definition,
  columnId: string,
  places: number,
): Definition {
  return {
    ...definition,
    decimalPlaces: { ...definition.decimalPlaces, [columnId]: clampDecimalPlaces(places) },
  }
}

export function setMaxLines(definition: Definition, maxLines: number): Definition {
  return { ...definition, maxLines: normalizeMaxLines(maxLines) }
}

/**
 * True when the persistent definition and the temporary controls already
 * equal the defaults, i.e. Reset view has nothing to do.
 */
export function isPristineView(
  definition: Definition,
  defaultColumnIds: readonly string[],
  transient: { showAllColumns: boolean; showAllRows: boolean; hasTemporarySort: boolean },
): boolean {
  return (
    definition.hiddenColumnIds.length === 0 &&
    definition.columnOrderIds.every((id, index) => id === defaultColumnIds[index]) &&
    definition.maxLines === 1 &&
    definition.defaultSortRules.length === 0 &&
    definition.pinnedColumnIds.left.length === 0 &&
    definition.pinnedColumnIds.right.length === 0 &&
    definition.rowFilters.length === 0 &&
    Object.keys(definition.rowOverrides).length === 0 &&
    Object.keys(definition.sotaModes).length === 0 &&
    Object.keys(definition.decimalPlaces).length === 0 &&
    !transient.showAllColumns &&
    !transient.showAllRows &&
    !transient.hasTemporarySort
  )
}

/** Fresh id for a new filter or sort badge. */
export function newEntryId(prefix: 'filter' | 'sort', sequence: number): string {
  return `${prefix}-${Date.now()}-${sequence}`
}
