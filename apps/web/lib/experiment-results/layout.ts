// Drag reordering and pinned-column layout helpers.

import type { CSSProperties } from 'react'
import type { DropEdge, PinLayout } from './types'
import type { ResultsViewPinSide } from './views'

export const EMPTY_PIN_LAYOUT: PinLayout = { sticky: false, leftOffsets: {}, rightOffsets: {} }

/** Drop on the right half of the target means "after". */
export function dropEdgeAt(clientX: number, bounds: { left: number; width: number }): DropEdge {
  return clientX > bounds.left + bounds.width / 2 ? 'after' : 'before'
}

/**
 * Move `sourceId` before/after `targetId`. Returns the same array instance when
 * nothing changes (unknown ids, self-drop, or a no-op move).
 */
export function reorderIds(
  ids: string[],
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): string[] {
  if (sourceId === targetId) return ids
  const sourceIndex = ids.indexOf(sourceId)
  if (sourceIndex < 0 || !ids.includes(targetId)) return ids
  const next = ids.filter((id) => id !== sourceId)
  const targetIndex = next.indexOf(targetId)
  next.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, sourceId)
  return next.every((id, index) => id === ids[index]) ? ids : next
}

/** `reorderIds` for objects with an `id`; same-instance return on no-op. */
export function reorderItems<T extends { id: string }>(
  items: T[],
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): T[] {
  const currentIds = items.map((item) => item.id)
  const nextIds = reorderIds(currentIds, sourceId, targetId, edge)
  if (nextIds === currentIds) return items
  const itemsById = new Map(items.map((item) => [item.id, item] as const))
  const next = nextIds
    .map((id) => itemsById.get(id))
    .filter((item): item is T => item !== undefined)
  return next.every((item, index) => item === items[index]) ? items : next
}

/**
 * Sticky offsets from measured pinned header widths (in render order). Sticky
 * positioning is enabled only when the pinned total is narrower than the viewport.
 */
export function computePinLayout(
  headers: ReadonlyArray<{ columnId: string; side: ResultsViewPinSide; width: number }>,
  viewportWidth: number,
): PinLayout {
  const left = headers.filter((header) => header.side === 'left')
  const right = headers.filter((header) => header.side === 'right')
  const pinnedWidth = [...left, ...right].reduce((total, header) => total + header.width, 0)
  const leftOffsets: Record<string, number> = {}
  const rightOffsets: Record<string, number> = {}
  let offset = 0
  for (const header of left) {
    leftOffsets[header.columnId] = offset
    offset += header.width
  }
  offset = 0
  for (const header of [...right].reverse()) {
    rightOffsets[header.columnId] = offset
    offset += header.width
  }
  return { sticky: pinnedWidth > 0 && pinnedWidth < viewportWidth, leftOffsets, rightOffsets }
}

export function samePinLayout(left: PinLayout, right: PinLayout): boolean {
  if (left.sticky !== right.sticky) return false
  const sameOffsets = (a: Record<string, number>, b: Record<string, number>) => {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
  }
  return (
    sameOffsets(left.leftOffsets, right.leftOffsets) &&
    sameOffsets(left.rightOffsets, right.rightOffsets)
  )
}

export function pinnedColumnStyle(
  columnId: string,
  side: ResultsViewPinSide | undefined,
  layout: PinLayout,
): CSSProperties | undefined {
  if (!side || !layout.sticky) return undefined
  return side === 'left'
    ? { left: layout.leftOffsets[columnId] ?? 0 }
    : { right: layout.rightOffsets[columnId] ?? 0 }
}

/** Opaque surface for sticky cells; starred beats metric beats the default. */
export function pinnedOpaqueBackground(
  metric: boolean,
  starred: boolean,
  surface: 'header' | 'cell',
): string {
  if (starred) return '!bg-amber-50 dark:!bg-amber-950'
  if (metric) return '!bg-sky-50 dark:!bg-sky-950'
  return surface === 'header' ? '!bg-muted' : '!bg-background'
}
