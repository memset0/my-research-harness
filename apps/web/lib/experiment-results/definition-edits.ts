// Pure edits of a Results View definition. Each takes the current (already
// normalized) definition and returns the next one, or the same instance when
// nothing changes, so the container can compose them against the latest
// stored value (race-safe accumulation, see web-dashboard Results
// preference requirements).

import { reorderIds, reorderItems } from './layout'
import { type ColumnTree, childIds, descendantIds } from './tree'
import type { DropEdge } from './types'
import {
  clampDecimalPlaces,
  type ExperimentResultsViewDefinition as Definition,
  normalizeMaxLines,
  type ResultsViewRowFilter,
  type ResultsViewRowOverride,
  type ResultsViewSortRule,
  type ResultsViewSotaMode,
} from './views'

/**
 * Check or clear a tree node: the choice is stored on that node and every
 * descendant's own choice is removed, so the descendants (and columns that
 * appear later) inherit it.
 */
export function setNodeVisible(
  definition: Definition,
  tree: ColumnTree,
  nodeId: string,
  visible: boolean,
): Definition {
  const node = tree.nodes.get(nodeId)
  if (!node) return definition
  const nodeVisibility = { ...definition.nodeVisibility }
  for (const id of descendantIds(node)) delete nodeVisibility[id]
  nodeVisibility[nodeId] = visible
  return { ...definition, nodeVisibility }
}

/**
 * Move a tree node before or after a sibling. A drop outside the node's own
 * parent is refused (same instance returned): groups come from result paths.
 */
export function reorderTreeNode(
  definition: Definition,
  tree: ColumnTree,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Definition {
  const source = tree.nodes.get(sourceId)
  const target = tree.nodes.get(targetId)
  if (!source || !target || source.parentId !== target.parentId) return definition
  const current = childIds(tree, source.parentId)
  const next = reorderIds(current, sourceId, targetId, edge)
  if (next === current) return definition
  return { ...definition, treeOrder: { ...definition.treeOrder, [source.parentId]: next } }
}

/** The pinned zone order after the Variant column (stored right pins render last). */
export function pinnedOrder(definition: Definition): string[] {
  return [...definition.pinnedColumnIds.left, ...definition.pinnedColumnIds.right]
}

/** Pin a column at the end of the left zone, or unpin it (it returns to its group). */
export function setColumnPinned(
  definition: Definition,
  columnId: string,
  pinned: boolean,
): Definition {
  if (columnId === 'variant') return definition
  const current = pinnedOrder(definition)
  if (pinned === current.includes(columnId)) return definition
  const left = pinned ? [...current, columnId] : current.filter((id) => id !== columnId)
  return { ...definition, pinnedColumnIds: { left, right: [] } }
}

/** Reorder the pinned zone (the order of the tree's pinned section). */
export function reorderPinned(
  definition: Definition,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Definition {
  const current = pinnedOrder(definition)
  const left = reorderIds(current, sourceId, targetId, edge)
  if (left === current) return definition
  return { ...definition, pinnedColumnIds: { left, right: [] } }
}

/** Collapse a header group to one placeholder column, or expand it again. */
export function toggleGroupCollapsed(definition: Definition, groupId: string): Definition {
  const collapsed = definition.collapsedGroups.includes(groupId)
  return {
    ...definition,
    collapsedGroups: collapsed
      ? definition.collapsedGroups.filter((id) => id !== groupId)
      : [...definition.collapsedGroups, groupId],
  }
}

/**
 * Choose a stats column's display (null: the column's default). Choosing a
 * display also decides its sort statistic again, so a separate sort choice
 * is cleared.
 */
export function setStatsDisplay(
  definition: Definition,
  columnId: string,
  selection: string | null,
): Definition {
  const statsDisplay = { ...definition.statsDisplay }
  if (selection === null) delete statsDisplay[columnId]
  else statsDisplay[columnId] = selection
  const statsSort = { ...definition.statsSort }
  delete statsSort[columnId]
  return { ...definition, statsDisplay, statsSort }
}

/** Sort, filter and rank a stats column by one statistic (null: follow the display). */
export function setStatsSort(
  definition: Definition,
  columnId: string,
  stat: string | null,
): Definition {
  const statsSort = { ...definition.statsSort }
  if (stat === null) delete statsSort[columnId]
  else statsSort[columnId] = stat
  return { ...definition, statsSort }
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
  transient: { showAllColumns: boolean; showAllRows: boolean; hasTemporarySort: boolean },
): boolean {
  return (
    definition.hiddenColumnIds.length === 0 &&
    definition.columnOrderIds.length === 0 &&
    definition.maxLines === 1 &&
    definition.defaultSortRules.length === 0 &&
    definition.pinnedColumnIds.left.length === 0 &&
    definition.pinnedColumnIds.right.length === 0 &&
    definition.rowFilters.length === 0 &&
    Object.keys(definition.rowOverrides).length === 0 &&
    Object.keys(definition.sotaModes).length === 0 &&
    Object.keys(definition.decimalPlaces).length === 0 &&
    Object.keys(definition.nodeVisibility).length === 0 &&
    Object.keys(definition.treeOrder).length === 0 &&
    definition.collapsedGroups.length === 0 &&
    Object.keys(definition.statsDisplay).length === 0 &&
    Object.keys(definition.statsSort).length === 0 &&
    !transient.showAllColumns &&
    !transient.showAllRows &&
    !transient.hasTemporarySort
  )
}

/** Fresh id for a new filter or sort badge. */
export function newEntryId(prefix: 'filter' | 'sort', sequence: number): string {
  return `${prefix}-${Date.now()}-${sequence}`
}
