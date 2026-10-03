// Shared types of the Results table's pure logic. Type-only imports keep these
// modules safe for client bundles.

import type {
  ResultsCellPayload,
  ResultsColumnPayload,
  ResultsVariantPayload,
} from '../dto/experiments'

/** One Variant row of the generated Results summary. */
export type ResultVariant = ResultsVariantPayload

/**
 * A comparable cell value: a scalar, the selected statistic of a stats cell,
 * a list of texts (Run lists, per-Run values), or absent.
 */
export type ResultValue = string | number | boolean | null | string[] | undefined

export type ColumnKind =
  | 'variant'
  | 'status'
  | 'result'
  | 'entry'
  | 'recipe'
  | 'commit'
  | 'runs'
  | 'attempts'

export interface ResultTableColumn {
  /** The result path for a result column; a fixed id for built-ins. */
  id: string
  /** The column's own label (deeper group labels are added by the header). */
  label: string
  kind: ColumnKind
  /** The summary column of a result path. */
  result?: ResultsColumnPayload
  /** A `metrics.*` path: pale-blue treatment, SOTA. */
  metric: boolean
  /** Statistics the display dropdown offers (empty: not a stats column). */
  statOptions: string[]
  /** Tree node ids from the top-level node down to the direct parent. */
  ancestors: string[]
  /** The summary cell of a result column. */
  getCell?: (variant: ResultVariant) => ResultsCellPayload | undefined
  /** Comparable value for filters and sorting. */
  getValue: (variant: ResultVariant) => ResultValue
  /** Sort key when it differs from `getValue` (Status sorts by lifecycle). */
  getSortValue?: (variant: ResultVariant) => ResultValue
  /** Display text without markers; '' when the cell is empty. */
  getText: (variant: ResultVariant) => string
}

/** Drag kinds: tree nodes, table headers and the pinned list reorder within their scope. */
export type DragKind = 'tree-node' | 'column' | 'pinned' | 'row-filter' | 'sort-rule'
export type DropEdge = 'before' | 'after'

export interface DragItem {
  kind: DragKind
  id: string
  /** Items reorder only within the same scope (their parent node, or `pinned`). */
  scope?: string
}

export interface PinLayout {
  sticky: boolean
  leftOffsets: Record<string, number>
}

/** 1 = best, 2 = second, 3 = third. */
export type SotaRank = 1 | 2 | 3

export interface SotaRanking {
  /** Variant id → rank for the (at most three) best Variants. */
  ranks: Map<string, SotaRank>
  active: boolean
}
