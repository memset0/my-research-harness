// Mounted-only Results table state: temporary show-all toggles, the temporary
// header sort, and drag-and-drop tracking. None of it is persisted; selecting,
// creating or deleting a View and Reset view clear the temporary controls in
// one `reset` action.

import type { SortKey } from './sorting'
import type { DragItem } from './types'

export interface TransientState {
  showAllColumns: boolean
  showAllRows: boolean
  temporarySort: SortKey | null
  dragged: DragItem | null
  dropTarget: DragItem | null
}

export type TransientAction =
  | { type: 'show-all-columns'; value: boolean }
  | { type: 'show-all-rows'; value: boolean }
  | { type: 'cycle-sort'; columnId: string }
  | { type: 'clear-temporary-sort' }
  | { type: 'reset' }
  | { type: 'drag-start'; item: DragItem }
  | { type: 'drag-over'; item: DragItem }
  | { type: 'drag-end' }

export const INITIAL_TRANSIENT_STATE: TransientState = {
  showAllColumns: false,
  showAllRows: false,
  temporarySort: null,
  dragged: null,
  dropTarget: null,
}

/** Default → temporary ascending → temporary descending → default. */
export function nextTemporarySort(current: SortKey | null, columnId: string): SortKey | null {
  if (!current || current.columnId !== columnId) return { columnId, direction: 'asc' }
  if (current.direction === 'asc') return { columnId, direction: 'desc' }
  return null
}

/**
 * A drop is allowed only onto a different item of the dragged kind in the
 * same scope: tree nodes and headers stay inside their parent group, pins
 * inside the pinned zone.
 */
export function canDropOn(dragged: DragItem | null, item: DragItem): boolean {
  return (
    dragged !== null &&
    dragged.kind === item.kind &&
    dragged.id !== item.id &&
    (dragged.scope ?? null) === (item.scope ?? null)
  )
}

const sameItem = (left: DragItem | null, right: DragItem | null) =>
  left?.kind === right?.kind && left?.id === right?.id && left?.scope === right?.scope

export function transientReducer(state: TransientState, action: TransientAction): TransientState {
  switch (action.type) {
    case 'show-all-columns':
      return state.showAllColumns === action.value
        ? state
        : { ...state, showAllColumns: action.value }
    case 'show-all-rows':
      return state.showAllRows === action.value ? state : { ...state, showAllRows: action.value }
    case 'cycle-sort':
      return { ...state, temporarySort: nextTemporarySort(state.temporarySort, action.columnId) }
    case 'clear-temporary-sort':
      return state.temporarySort === null ? state : { ...state, temporarySort: null }
    case 'reset':
      return { ...state, showAllColumns: false, showAllRows: false, temporarySort: null }
    case 'drag-start':
      return { ...state, dragged: action.item, dropTarget: null }
    case 'drag-over':
      if (!canDropOn(state.dragged, action.item) || sameItem(state.dropTarget, action.item)) {
        return state
      }
      return { ...state, dropTarget: action.item }
    case 'drag-end':
      return state.dragged === null && state.dropTarget === null
        ? state
        : { ...state, dragged: null, dropTarget: null }
  }
}
