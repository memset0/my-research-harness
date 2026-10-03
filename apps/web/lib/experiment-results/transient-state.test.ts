// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  canDropOn,
  INITIAL_TRANSIENT_STATE,
  nextTemporarySort,
  type TransientState,
  transientReducer,
} from './transient-state'

describe('nextTemporarySort', () => {
  it.each([
    [null, 'a', { columnId: 'a', direction: 'asc' }],
    [{ columnId: 'a', direction: 'asc' as const }, 'a', { columnId: 'a', direction: 'desc' }],
    [{ columnId: 'a', direction: 'desc' as const }, 'a', null],
    [{ columnId: 'a', direction: 'desc' as const }, 'b', { columnId: 'b', direction: 'asc' }],
  ])('%j then %s', (current, columnId, expected) => {
    expect(nextTemporarySort(current, columnId)).toEqual(expected)
  })
})

describe('canDropOn', () => {
  it.each([
    [null, { kind: 'column' as const, id: 'a' }, false],
    [{ kind: 'column' as const, id: 'a' }, { kind: 'column' as const, id: 'a' }, false],
    [{ kind: 'column' as const, id: 'a' }, { kind: 'row-filter' as const, id: 'b' }, false],
    [{ kind: 'column' as const, id: 'a' }, { kind: 'column' as const, id: 'b' }, true],
    [
      { kind: 'tree-node' as const, id: 'params.lr', scope: 'group:params.optim' },
      { kind: 'tree-node' as const, id: 'params.bs', scope: 'group:params.optim' },
      true,
    ],
    // A column never leaves its group: a drop in another scope is refused.
    [
      { kind: 'tree-node' as const, id: 'params.optim.lr', scope: 'group:params.optim' },
      { kind: 'tree-node' as const, id: 'params.model.depth', scope: 'group:params.model' },
      false,
    ],
    [
      { kind: 'pinned' as const, id: 'a', scope: 'pinned' },
      { kind: 'column' as const, id: 'b', scope: 'pinned' },
      false,
    ],
  ])('%j onto %j', (dragged, item, expected) => {
    expect(canDropOn(dragged, item)).toBe(expected)
  })
})

describe('transientReducer', () => {
  const busy: TransientState = {
    showAllColumns: true,
    showAllRows: true,
    temporarySort: { columnId: 'a', direction: 'asc' },
    dragged: { kind: 'column', id: 'a' },
    dropTarget: null,
  }

  it('reset clears temporary controls but not an in-flight drag', () => {
    expect(transientReducer(busy, { type: 'reset' })).toEqual({
      ...INITIAL_TRANSIENT_STATE,
      dragged: busy.dragged,
    })
  })

  it('returns the same state for no-op actions', () => {
    const state = INITIAL_TRANSIENT_STATE
    expect(transientReducer(state, { type: 'show-all-rows', value: false })).toBe(state)
    expect(transientReducer(state, { type: 'clear-temporary-sort' })).toBe(state)
    expect(transientReducer(state, { type: 'drag-end' })).toBe(state)
    expect(transientReducer(state, { type: 'drag-over', item: { kind: 'column', id: 'b' } })).toBe(
      state,
    )
  })

  it('tracks a drag from start to end', () => {
    let state = transientReducer(INITIAL_TRANSIENT_STATE, {
      type: 'drag-start',
      item: { kind: 'sort-rule', id: 's1' },
    })
    state = transientReducer(state, { type: 'drag-over', item: { kind: 'sort-rule', id: 's2' } })
    expect(state.dropTarget).toEqual({ kind: 'sort-rule', id: 's2' })
    const same = transientReducer(state, {
      type: 'drag-over',
      item: { kind: 'sort-rule', id: 's2' },
    })
    expect(same).toBe(state)
    expect(transientReducer(state, { type: 'drag-end' })).toEqual(INITIAL_TRANSIENT_STATE)
  })

  it('cycles the header sort and toggles show-all', () => {
    let state = transientReducer(INITIAL_TRANSIENT_STATE, { type: 'cycle-sort', columnId: 'a' })
    state = transientReducer(state, { type: 'cycle-sort', columnId: 'a' })
    expect(state.temporarySort).toEqual({ columnId: 'a', direction: 'desc' })
    state = transientReducer(state, { type: 'show-all-columns', value: true })
    expect(state.showAllColumns).toBe(true)
  })
})
