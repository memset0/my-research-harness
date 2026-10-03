// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  computePinLayout,
  dropEdgeAt,
  dropEdgeAtVertical,
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

describe('dropEdgeAtVertical', () => {
  it.each([
    [10, 'before'],
    [50, 'before'],
    [51, 'after'],
  ] as const)('y=%d', (y, edge) => {
    expect(dropEdgeAtVertical(y, { top: 0, height: 100 })).toBe(edge)
  })
})

describe('pin layout', () => {
  // The single left zone: the Variant column, then the pins in order.
  const headers = [
    { columnId: 'variant', width: 50 },
    { columnId: 'b', width: 30 },
    { columnId: 'y', width: 20 },
    { columnId: 'z', width: 40 },
  ]

  it('stacks offsets from the left edge when pins fit', () => {
    expect(computePinLayout(headers, 500)).toEqual({
      sticky: true,
      leftOffsets: { variant: 0, b: 50, y: 80, z: 100 },
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
    expect(samePinLayout(layout, { ...layout, leftOffsets: { variant: 0 } })).toBe(false)
  })

  it('styles only sticky pinned columns', () => {
    const layout = computePinLayout(headers, 500)
    expect(pinnedColumnStyle('b', true, layout)).toEqual({ left: 50 })
    expect(pinnedColumnStyle('z', true, layout)).toEqual({ left: 100 })
    expect(pinnedColumnStyle('b', false, layout)).toBeUndefined()
    expect(pinnedColumnStyle('b', true, EMPTY_PIN_LAYOUT)).toBeUndefined()
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
