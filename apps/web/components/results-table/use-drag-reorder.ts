'use client'

import type { Dispatch, DragEvent } from 'react'
import { dropEdgeAt, dropEdgeAtVertical } from '../../lib/experiment-results/layout'
import { canDropOn, type TransientAction } from '../../lib/experiment-results/transient-state'
import type { DragItem, DropEdge } from '../../lib/experiment-results/types'

/** Native drag-and-drop props for one draggable item. */
export interface DragBindings {
  draggable: true
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

/** Typed drag handler bundle shared by tree rows, headers and badges. */
export interface DragHandlers {
  /** `vertical`: the item sits in a vertical list (drop edge from the pointer's y). */
  bind: (item: DragItem, options?: { vertical?: boolean }) => DragBindings
  isDragged: (item: DragItem) => boolean
  isDropTarget: (item: DragItem) => boolean
}

/**
 * Wires native drag events to the transient reducer. `onReorder` runs once per
 * successful drop on a different item of the same kind and scope; a drop
 * outside the dragged item's scope is refused (no `preventDefault`, no edit).
 */
export function useDragReorder(
  state: { dragged: DragItem | null; dropTarget: DragItem | null },
  dispatch: Dispatch<TransientAction>,
  onReorder: (dragged: DragItem, target: DragItem, edge: DropEdge) => void,
): DragHandlers {
  const matches = (candidate: DragItem | null, item: DragItem) =>
    candidate?.kind === item.kind && candidate.id === item.id && candidate.scope === item.scope
  return {
    bind: (item, options = {}) => ({
      draggable: true,
      onDragStart: (event) => {
        event.stopPropagation()
        dispatch({ type: 'drag-start', item })
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`)
      },
      onDragOver: (event) => {
        if (!canDropOn(state.dragged, item)) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        dispatch({ type: 'drag-over', item })
      },
      onDrop: (event) => {
        if (state.dragged && canDropOn(state.dragged, item)) {
          event.preventDefault()
          event.stopPropagation()
          const bounds = event.currentTarget.getBoundingClientRect()
          const edge = options.vertical
            ? dropEdgeAtVertical(event.clientY, bounds)
            : dropEdgeAt(event.clientX, bounds)
          onReorder(state.dragged, item, edge)
          dispatch({ type: 'drag-end' })
        }
      },
      onDragEnd: () => dispatch({ type: 'drag-end' }),
    }),
    isDragged: (item) => matches(state.dragged, item),
    isDropTarget: (item) => matches(state.dropTarget, item),
  }
}
