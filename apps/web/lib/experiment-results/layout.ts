// Drag reordering and pinned-column layout helpers.

import type { CSSProperties } from 'react'
import type { DropEdge, PinLayout } from './types'

export const EMPTY_PIN_LAYOUT: PinLayout = { sticky: false, leftOffsets: {} }

/** Drop on the right half of the target means "after". */
export function dropEdgeAt(clientX: number, bounds: { left: number; width: number }): DropEdge {
  return clientX > bounds.left + bounds.width / 2 ? 'after' : 'before'
}

/** Drop on the lower half of a vertical list item means "after". */
export function dropEdgeAtVertical(
  clientY: number,
  bounds: { top: number; height: number },
): DropEdge {
  return clientY > bounds.top + bounds.height / 2 ? 'after' : 'before'
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
 * Sticky offsets from measured pinned header widths (in render order: the
 * Variant column, then the pins). Sticky positioning is enabled only when the
 * pinned total is narrower than the viewport.
 */
export function computePinLayout(
  headers: ReadonlyArray<{ columnId: string; width: number }>,
  viewportWidth: number,
): PinLayout {
  const pinnedWidth = headers.reduce((total, header) => total + header.width, 0)
  const leftOffsets: Record<string, number> = {}
  let offset = 0
  for (const header of headers) {
    leftOffsets[header.columnId] = offset
    offset += header.width
  }
  return { sticky: pinnedWidth > 0 && pinnedWidth < viewportWidth, leftOffsets }
}

export function samePinLayout(left: PinLayout, right: PinLayout): boolean {
  if (left.sticky !== right.sticky) return false
  const keys = Object.keys(left.leftOffsets)
  return (
    keys.length === Object.keys(right.leftOffsets).length &&
    keys.every((key) => left.leftOffsets[key] === right.leftOffsets[key])
  )
}

export function pinnedColumnStyle(
  columnId: string,
  pinned: boolean,
  layout: PinLayout,
): CSSProperties | undefined {
  if (!pinned || !layout.sticky) return undefined
  return { left: layout.leftOffsets[columnId] ?? 0 }
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
