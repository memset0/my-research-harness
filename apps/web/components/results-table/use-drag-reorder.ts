'use client'

import type { Dispatch, DragEvent } from 'react'
import { dropEdgeAt } from '../../lib/experiment-results/layout'
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

/** Typed drag handler bundle shared by column chips, headers and badges. */
export interface DragHandlers {
  bind: (item: DragItem) => DragBindings
  isDragged: (item: DragItem) => boolean
  isDropTarget: (item: DragItem) => boolean
}

/**
 * Wires native drag events to the transient reducer. `onReorder` runs once per
 * successful drop on a different item of the same kind.
 */
export function useDragReorder(
  state: { dragged: DragItem | null; dropTarget: DragItem | null },
  dispatch: Dispatch<TransientAction>,
  onReorder: (kind: DragItem['kind'], sourceId: string, targetId: string, edge: DropEdge) => void,
): DragHandlers {
  const matches = (candidate: DragItem | null, item: DragItem) =>
    candidate?.kind === item.kind && candidate.id === item.id
  return {
    bind: (item) => ({
      draggable: true,
      onDragStart: (event) => {
        dispatch({ type: 'drag-start', item })
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`)
      },
      onDragOver: (event) => {
        if (!canDropOn(state.dragged, item)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        dispatch({ type: 'drag-over', item })
      },
      onDrop: (event) => {
        event.preventDefault()
        if (state.dragged && canDropOn(state.dragged, item)) {
          const edge = dropEdgeAt(event.clientX, event.currentTarget.getBoundingClientRect())
          onReorder(item.kind, state.dragged.id, item.id, edge)
        }
        dispatch({ type: 'drag-end' })
      },
      onDragEnd: () => dispatch({ type: 'drag-end' }),
    }),
    isDragged: (item) => matches(state.dragged, item),
    isDropTarget: (item) => matches(state.dropTarget, item),
  }
}
