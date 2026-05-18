// Unit tests for `resolveNeighbor` and `isManageTmuxNavShortcut` —
// the pure helpers backing `Ctrl+Shift+ArrowUp/Down` navigation on
// /manage/tmux. The same matcher predicate is shared by the parent
// `window.addEventListener('keydown', ...)` handler and the iframe-
// side capture-phase listener installed on the ttyd iframe's
// contentDocument; consolidating the modifier contract here prevents
// the two from drifting.

import { describe, expect, it } from 'vitest'
import {
  isManageTmuxNavShortcut,
  resolveNeighbor,
} from '../../app/manage/tmux/keyboard-nav'

type Row = { sessionName: string }
const row = (name: string): Row => ({ sessionName: name })

describe('resolveNeighbor', () => {
  it('returns null for an empty list regardless of direction', () => {
    expect(resolveNeighbor([], null, 'down')).toBeNull()
    expect(resolveNeighbor([], null, 'up')).toBeNull()
    expect(resolveNeighbor([], 'A', 'down')).toBeNull()
    expect(resolveNeighbor([], 'A', 'up')).toBeNull()
  })

  it('bootstraps to the first row when no selection exists', () => {
    const list = [row('A'), row('B'), row('C')]
    expect(resolveNeighbor(list, null, 'down')).toBe('A')
    expect(resolveNeighbor(list, null, 'up')).toBe('A')
  })

  it('moves selection to the next row when ArrowDown with room', () => {
    const list = [row('A'), row('B'), row('C')]
    expect(resolveNeighbor(list, 'A', 'down')).toBe('B')
    expect(resolveNeighbor(list, 'B', 'down')).toBe('C')
  })

  it('moves selection to the previous row when ArrowUp with room', () => {
    const list = [row('A'), row('B'), row('C')]
    expect(resolveNeighbor(list, 'C', 'up')).toBe('B')
    expect(resolveNeighbor(list, 'B', 'up')).toBe('A')
  })

  it('clamps at the bottom (no wrap-around) when ArrowDown on last row', () => {
    const list = [row('A'), row('B'), row('C')]
    expect(resolveNeighbor(list, 'C', 'down')).toBeNull()
  })

  it('clamps at the top (no wrap-around) when ArrowUp on first row', () => {
    const list = [row('A'), row('B'), row('C')]
    expect(resolveNeighbor(list, 'A', 'up')).toBeNull()
  })

  it('re-bootstraps to first row when current selection is not in the visible list', () => {
    // User had `X` selected, then switched the filter tab and `X` got
    // filtered out — visible list is `[B, D]`. Both directions resolve
    // to the head of the visible list.
    const list = [row('B'), row('D')]
    expect(resolveNeighbor(list, 'X', 'down')).toBe('B')
    expect(resolveNeighbor(list, 'X', 'up')).toBe('B')
  })

  it('handles a single-row list (selected: clamps both directions)', () => {
    const list = [row('A')]
    expect(resolveNeighbor(list, 'A', 'down')).toBeNull()
    expect(resolveNeighbor(list, 'A', 'up')).toBeNull()
  })

  it('handles a single-row list (no selection: bootstraps to it)', () => {
    const list = [row('A')]
    expect(resolveNeighbor(list, null, 'down')).toBe('A')
    expect(resolveNeighbor(list, null, 'up')).toBe('A')
  })

  it('does not mutate the input list', () => {
    const list = [row('A'), row('B'), row('C')]
    const snapshot = list.map((r) => r.sessionName)
    resolveNeighbor(list, 'B', 'down')
    resolveNeighbor(list, 'B', 'up')
    expect(list.map((r) => r.sessionName)).toEqual(snapshot)
  })
})

describe('isManageTmuxNavShortcut', () => {
  // KeyboardEvent constructor honors `ctrlKey` / `shiftKey` / `altKey` /
  // `metaKey` / `key` / `code` in jsdom, so we can synthesize events
  // matching the modifier shapes the matcher checks.
  const ev = (init: Partial<KeyboardEventInit>): KeyboardEvent =>
    new KeyboardEvent('keydown', { key: 'ArrowDown', ...init })

  it('matches Ctrl+Shift+ArrowDown', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({ key: 'ArrowDown', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true)
  })

  it('matches Ctrl+Shift+ArrowUp', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({ key: 'ArrowUp', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(true)
  })

  it('rejects Ctrl-without-Shift', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({ key: 'ArrowDown', ctrlKey: true, shiftKey: false }),
      ),
    ).toBe(false)
  })

  it('rejects Shift-without-Ctrl', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({ key: 'ArrowDown', ctrlKey: false, shiftKey: true }),
      ),
    ).toBe(false)
  })

  it('rejects when Alt is also held', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({
          key: 'ArrowDown',
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
        }),
      ),
    ).toBe(false)
  })

  it('rejects when Meta is also held', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({
          key: 'ArrowDown',
          ctrlKey: true,
          shiftKey: true,
          metaKey: true,
        }),
      ),
    ).toBe(false)
  })

  it('rejects unrelated keys with the same modifiers', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', 'a', 'PageDown']) {
      expect(
        isManageTmuxNavShortcut(
          ev({ key, ctrlKey: true, shiftKey: true }),
        ),
      ).toBe(false)
    }
  })

  it('rejects bare arrow keys without modifiers', () => {
    expect(
      isManageTmuxNavShortcut(
        ev({ key: 'ArrowDown', ctrlKey: false, shiftKey: false }),
      ),
    ).toBe(false)
  })
})
