import { describe, expect, it } from 'vitest'
import {
  computePinLayout,
  dropEdgeAt,
  EMPTY_PIN_LAYOUT,
  pinnedColumnStyle,
  pinnedOpaqueBackground,
  reorderIds,
  reorderItems,
  samePinLayout,
} from './layout'

describe('reorderIds', () => {
  const ids = ['a', 'b', 'c']
  it.each([
    ['c', 'a', 'before', ['c', 'a', 'b']],
    ['a', 'c', 'after', ['b', 'c', 'a']],
    ['a', 'b', 'after', ['b', 'a', 'c']],
  ] as const)('%s %s %s', (source, target, edge, expected) => {
    expect(reorderIds(ids, source, target, edge)).toEqual(expected)
  })

  it.each([
    ['a', 'a', 'before'],
    ['x', 'a', 'before'],
    ['a', 'x', 'after'],
    ['a', 'b', 'before'],
  ] as const)('returns the same instance for no-op %s→%s', (source, target, edge) => {
    expect(reorderIds(ids, source, target, edge)).toBe(ids)
  })

  it('handles an empty list', () => {
    const empty: string[] = []
    expect(reorderIds(empty, 'a', 'b', 'after')).toBe(empty)
  })
})

describe('reorderItems', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('moves items and keeps object identity', () => {
    const next = reorderItems(items, 'c', 'a', 'before')
    expect(next.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(next[0]).toBe(items[2])
    expect(reorderItems(items, 'a', 'a', 'after')).toBe(items)
  })
})

describe('dropEdgeAt', () => {
  it.each([
    [10, 'before'],
    [50, 'before'],
    [51, 'after'],
  ] as const)('x=%d', (x, edge) => {
    expect(dropEdgeAt(x, { left: 0, width: 100 })).toBe(edge)
  })
})

describe('pin layout', () => {
  const headers = [
    { columnId: 'a', side: 'left' as const, width: 50 },
    { columnId: 'b', side: 'left' as const, width: 30 },
    { columnId: 'y', side: 'right' as const, width: 20 },
    { columnId: 'z', side: 'right' as const, width: 40 },
  ]

  it('stacks offsets from each edge when pins fit', () => {
    expect(computePinLayout(headers, 500)).toEqual({
      sticky: true,
      leftOffsets: { a: 0, b: 50 },
      rightOffsets: { z: 0, y: 40 },
    })
  })

  it.each([
    [140, false],
    [141, true],
  ])('disables sticky when pins fill viewport %d', (viewport, sticky) => {
    expect(computePinLayout(headers, viewport).sticky).toBe(sticky)
  })

  it('has no sticky without pins', () => {
    expect(computePinLayout([], 500)).toEqual(EMPTY_PIN_LAYOUT)
  })

  it('compares layouts structurally', () => {
    const layout = computePinLayout(headers, 500)
    expect(samePinLayout(layout, computePinLayout(headers, 500))).toBe(true)
    expect(samePinLayout(layout, computePinLayout(headers, 100))).toBe(false)
    expect(samePinLayout(layout, { ...layout, leftOffsets: { a: 0 } })).toBe(false)
  })

  it('styles only sticky pinned columns', () => {
    const layout = computePinLayout(headers, 500)
    expect(pinnedColumnStyle('b', 'left', layout)).toEqual({ left: 50 })
    expect(pinnedColumnStyle('y', 'right', layout)).toEqual({ right: 40 })
    expect(pinnedColumnStyle('b', undefined, layout)).toBeUndefined()
    expect(pinnedColumnStyle('b', 'left', EMPTY_PIN_LAYOUT)).toBeUndefined()
  })

  it.each([
    [true, true, 'header', '!bg-amber-50 dark:!bg-amber-950'],
    [true, false, 'cell', '!bg-sky-50 dark:!bg-sky-950'],
    [false, false, 'header', '!bg-muted'],
    [false, false, 'cell', '!bg-background'],
  ] as const)('opaque background metric=%s starred=%s %s', (metric, starred, surface, expected) => {
    expect(pinnedOpaqueBackground(metric, starred, surface)).toBe(expected)
  })
})
