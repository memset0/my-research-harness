// Shared types of the Results table's pure logic. Type-only imports from
// `@memon/core` keep these modules safe for client bundles.

import type {
  ResultColumnAnnotation,
  ResultScalar,
  ResultColumn as ResultSchemaColumn,
  ResultVariant,
} from '@memon/core'

/** A cell value: a scalar, a Run-id list (Runs / Attempts), or absent. */
export type ResultValue = ResultScalar | string[] | undefined

export type ColumnKind =
  | 'variant'
  | 'status'
  | 'schema'
  | 'entry'
  | 'recipe'
  | 'commit'
  | 'runs'
  | 'attempts'

export interface ResultTableColumn {
  id: string
  label: string
  kind: ColumnKind
  schema?: ResultSchemaColumn
  annotation?: ResultColumnAnnotation
  getValue: (variant: ResultVariant) => ResultValue
  /** Sort key when it differs from the displayed value (Status sorts by lifecycle). */
  getSortValue?: (variant: ResultVariant) => ResultValue
}

export type DragKind = 'column' | 'row-filter' | 'sort-rule'
export type DropEdge = 'before' | 'after'

export interface DragItem {
  kind: DragKind
  id: string
}

export interface PinLayout {
  sticky: boolean
  leftOffsets: Record<string, number>
  rightOffsets: Record<string, number>
}

/** 1 = best, 2 = second, 3 = third. */
export type SotaRank = 1 | 2 | 3

export interface SotaRanking {
  /** Variant id → rank for the (at most three) best Variants. */
  ranks: Map<string, SotaRank>
  active: boolean
}
