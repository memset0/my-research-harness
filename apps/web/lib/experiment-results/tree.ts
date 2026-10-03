// The vertical column tree of the Results controls and the table layout
// derived from it.
//
// Nodes: top-level Status, the partitions (`params`, `metrics`, `env`), one
// node per group (path prefix), one leaf per declared or undeclared column,
// and the built-in Provenance group. Every parent has one effective child
// order: the View's saved order for that parent (stale and duplicate ids
// dropped, new children appended at the end), else a legacy flat order, else
// the summary's declaration order. The table's unpinned zone is a depth-first
// walk of this tree, so the displayed columns of one group are contiguous by
// construction. Checked state is stored on the changed node and inherited by
// its descendants.

import { groupLabel, PROVENANCE_GROUP, PROVENANCE_LABEL } from './columns'
import type { ResultTableColumn } from './types'

/** Parent id of the top-level nodes. */
export const TREE_ROOT = '$root'
/** Drag scope of the pinned zone. */
export const PINNED_SCOPE = 'pinned'

const GROUP_PREFIX = 'group:'

export interface ColumnTreeNode {
  id: string
  kind: 'partition' | 'group' | 'column'
  label: string
  parentId: string
  /** 0 for top-level nodes. */
  depth: number
  children: ColumnTreeNode[]
  column?: ResultTableColumn
  /** Leaf column ids beneath this node (the leaf itself for a column), in tree order. */
  leafIds: string[]
}

export interface ColumnTree {
  roots: ColumnTreeNode[]
  nodes: ReadonlyMap<string, ColumnTreeNode>
  /** Every leaf column id, depth first. */
  leafOrder: string[]
}

export interface TreeOrderInput {
  /** Saved child order per parent node id. */
  treeOrder?: Readonly<Record<string, readonly string[]>>
  /** A legacy flat column order (pre-tree Views), used for parents without a saved order. */
  legacyOrder?: readonly string[]
}

interface Draft {
  id: string
  kind: ColumnTreeNode['kind']
  label: string
  parentId: string
  column?: ResultTableColumn
  childIds: string[]
}

/** Build the tree of every column except the always-pinned Variant column. */
export function buildColumnTree(
  columns: readonly ResultTableColumn[],
  groups: Readonly<Record<string, { label?: string }>>,
  order: TreeOrderInput = {},
): ColumnTree {
  const drafts = new Map<string, Draft>()
  const rootChildren: string[] = []
  const attach = (draft: Draft) => {
    drafts.set(draft.id, draft)
    if (draft.parentId === TREE_ROOT) rootChildren.push(draft.id)
    else drafts.get(draft.parentId)!.childIds.push(draft.id)
  }
  for (const column of columns) {
    if (column.kind === 'variant' || drafts.has(column.id)) continue
    let parentId = TREE_ROOT
    for (const ancestor of column.ancestors) {
      if (!drafts.has(ancestor)) {
        const path = ancestor.slice(GROUP_PREFIX.length)
        const builtin = ancestor === PROVENANCE_GROUP
        attach({
          id: ancestor,
          kind: builtin || path.includes('.') ? 'group' : 'partition',
          label: builtin ? PROVENANCE_LABEL : groupLabel(path, groups),
          parentId,
          childIds: [],
        })
      }
      parentId = ancestor
    }
    attach({ id: column.id, kind: 'column', label: column.label, parentId, column, childIds: [] })
  }

  const legacyIndex = new Map((order.legacyOrder ?? []).map((id, index) => [id, index] as const))
  const leafMemo = new Map<string, string[]>()
  const leavesOf = (id: string): string[] => {
    const known = leafMemo.get(id)
    if (known) return known
    const draft = drafts.get(id)!
    const leaves = draft.kind === 'column' ? [id] : draft.childIds.flatMap(leavesOf)
    leafMemo.set(id, leaves)
    return leaves
  }
  const rank = (id: string) =>
    Math.min(...leavesOf(id).map((leaf) => legacyIndex.get(leaf) ?? Number.POSITIVE_INFINITY))
  const ordered = (parentId: string, childIds: readonly string[]): string[] => {
    const saved = order.treeOrder?.[parentId]
    if (saved) {
      const present = new Set(childIds)
      const seen = new Set<string>()
      const out: string[] = []
      for (const id of saved) {
        if (present.has(id) && !seen.has(id)) {
          seen.add(id)
          out.push(id)
        }
      }
      for (const id of childIds) if (!seen.has(id)) out.push(id)
      return out
    }
    if (legacyIndex.size === 0) return [...childIds]
    return childIds
      .map((id, index) => ({ id, index, rank: rank(id) }))
      .sort((left, right) =>
        left.rank === right.rank ? left.index - right.index : left.rank < right.rank ? -1 : 1,
      )
      .map((entry) => entry.id)
  }

  const nodes = new Map<string, ColumnTreeNode>()
  const build = (id: string, depth: number): ColumnTreeNode => {
    const draft = drafts.get(id)!
    const children = ordered(id, draft.childIds).map((child) => build(child, depth + 1))
    const node: ColumnTreeNode = {
      id,
      kind: draft.kind,
      label: draft.label,
      parentId: draft.parentId,
      depth,
      children,
      ...(draft.column ? { column: draft.column } : {}),
      leafIds: draft.kind === 'column' ? [id] : children.flatMap((child) => child.leafIds),
    }
    nodes.set(id, node)
    return node
  }
  const roots = ordered(TREE_ROOT, rootChildren).map((id) => build(id, 0))
  return { roots, nodes, leafOrder: roots.flatMap((root) => root.leafIds) }
}

/** The current child ids of `parentId` in tree order. */
export function childIds(tree: ColumnTree, parentId: string): string[] {
  if (parentId === TREE_ROOT) return tree.roots.map((root) => root.id)
  return tree.nodes.get(parentId)?.children.map((child) => child.id) ?? []
}

/** The description file's default visibility (built-ins are shown). */
export function defaultColumnVisible(column: ResultTableColumn): boolean {
  return column.result ? !column.result.hidden : true
}

/**
 * A leaf's visibility: the nearest explicit choice on the leaf or an
 * ancestor, else the description file's default.
 */
export function isLeafVisible(
  tree: ColumnTree,
  leafId: string,
  nodeVisibility: Readonly<Record<string, boolean>>,
): boolean {
  let node = tree.nodes.get(leafId)
  const column = node?.column
  while (node) {
    const explicit = nodeVisibility[node.id]
    if (explicit !== undefined) return explicit
    node = tree.nodes.get(node.parentId)
  }
  return column ? defaultColumnVisible(column) : true
}

/** Checked, unchecked or indeterminate from the node's leaves. */
export function nodeCheckState(
  node: ColumnTreeNode,
  visible: (leafId: string) => boolean,
): boolean | 'indeterminate' {
  const shown = node.leafIds.filter(visible).length
  if (shown === 0) return false
  return shown === node.leafIds.length ? true : 'indeterminate'
}

/** Node ids beneath `node` (excluding itself). */
export function descendantIds(node: ColumnTreeNode): string[] {
  return node.children.flatMap((child) => [child.id, ...descendantIds(child)])
}

// ---------- table layout ----------

/** A first-row header band: a first-level group below a partition, or Provenance. */
export interface GridBand {
  id: string
  label: string
}

export type GridItem =
  | {
      kind: 'column'
      id: string
      column: ResultTableColumn
      pinned: boolean
      /** The two-row header's second-row label (breadcrumb when pinned). */
      headerLabel: string
      band: GridBand | null
      /** Drag scope: the parent node id, or `pinned`. */
      scope: string
    }
  | {
      kind: 'collapsed'
      id: string
      groupId: string
      label: string
      /** Visible unpinned columns the placeholder stands for. */
      visibleCount: number
      band: GridBand
    }

/** Whether a group is a first-row band (collapsible from the header). */
export function isBandGroup(tree: ColumnTree, node: ColumnTreeNode): boolean {
  if (node.id === PROVENANCE_GROUP) return true
  return node.kind === 'group' && tree.nodes.get(node.parentId)?.kind === 'partition'
}

function bandOf(tree: ColumnTree, column: ResultTableColumn): GridBand | null {
  const id =
    column.ancestors[0] === PROVENANCE_GROUP ? PROVENANCE_GROUP : (column.ancestors[1] ?? null)
  if (id === null) return null
  return { id, label: tree.nodes.get(id)?.label ?? id }
}

function labelOf(tree: ColumnTree, id: string): string {
  return tree.nodes.get(id)?.label ?? id
}

/** Second-row label: deeper group labels merged into the column name (`adam › beta1`). */
export function columnHeaderLabel(tree: ColumnTree, column: ResultTableColumn): string {
  if (column.ancestors[0] === PROVENANCE_GROUP || column.ancestors.length <= 2) return column.label
  return [...column.ancestors.slice(2).map((id) => labelOf(tree, id)), column.label].join(' › ')
}

/** Breadcrumb of a pinned column's group labels (`Optimizer › LR`). */
export function columnBreadcrumb(tree: ColumnTree, column: ResultTableColumn): string {
  if (column.ancestors[0] === PROVENANCE_GROUP || column.ancestors.length <= 1) return column.label
  return [...column.ancestors.slice(1).map((id) => labelOf(tree, id)), column.label].join(' › ')
}

export interface GridLayoutOptions {
  visible: (leafId: string) => boolean
  /** Pinned column ids in pinned-zone order. */
  pinned: readonly string[]
  collapsed: ReadonlySet<string>
}

export interface GridLayout {
  /** The Variant column, then the visible pinned columns in order. */
  pinned: GridItem[]
  /** Depth-first walk of the tree: visible unpinned columns and collapsed groups. */
  unpinned: GridItem[]
}

export function layoutGrid(
  tree: ColumnTree,
  variantColumn: ResultTableColumn,
  options: GridLayoutOptions,
): GridLayout {
  const pinnedSet = new Set(options.pinned)
  const pinned: GridItem[] = [
    {
      kind: 'column',
      id: variantColumn.id,
      column: variantColumn,
      pinned: true,
      headerLabel: variantColumn.label,
      band: null,
      scope: PINNED_SCOPE,
    },
  ]
  for (const id of options.pinned) {
    const column = tree.nodes.get(id)?.column
    if (!column || !options.visible(id)) continue
    pinned.push({
      kind: 'column',
      id,
      column,
      pinned: true,
      headerLabel: columnBreadcrumb(tree, column),
      band: null,
      scope: PINNED_SCOPE,
    })
  }
  const unpinned: GridItem[] = []
  const walk = (node: ColumnTreeNode) => {
    if (node.kind === 'column') {
      if (!node.column || pinnedSet.has(node.id) || !options.visible(node.id)) return
      unpinned.push({
        kind: 'column',
        id: node.id,
        column: node.column,
        pinned: false,
        headerLabel: columnHeaderLabel(tree, node.column),
        band: bandOf(tree, node.column),
        scope: node.parentId,
      })
      return
    }
    if (options.collapsed.has(node.id) && isBandGroup(tree, node)) {
      const visibleCount = node.leafIds.filter(
        (id) => !pinnedSet.has(id) && options.visible(id),
      ).length
      if (visibleCount > 0)
        unpinned.push({
          kind: 'collapsed',
          id: `collapsed:${node.id}`,
          groupId: node.id,
          label: node.label,
          visibleCount,
          band: { id: node.id, label: node.label },
        })
      return
    }
    for (const child of node.children) walk(child)
  }
  for (const root of tree.roots) walk(root)
  return { pinned, unpinned }
}

/** One first-row header cell over a run of adjacent unpinned items. */
export interface BandCell {
  key: string
  band: GridBand | null
  span: number
  collapsed: boolean
}

export function bandCells(items: readonly GridItem[]): BandCell[] {
  const cells: BandCell[] = []
  for (const item of items) {
    const last = cells.at(-1)
    const bandId = item.band?.id ?? null
    if (last && (last.band?.id ?? null) === bandId && !last.collapsed && item.kind === 'column') {
      last.span += 1
      continue
    }
    cells.push({
      key: `${bandId ?? 'none'}:${item.id}`,
      band: item.band,
      span: 1,
      collapsed: item.kind === 'collapsed',
    })
  }
  return cells
}
