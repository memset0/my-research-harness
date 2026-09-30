// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'

import {
  DIFF_VIEW_EVENT,
  DIFF_VIEW_STORAGE_KEY,
  useDiffViewMode,
  type DiffViewMode,
} from './use-diff-view-mode'

function Probe({
  onMode,
  onSet,
}: {
  onMode: (m: DiffViewMode) => void
  onSet?: (set: (next: DiffViewMode) => void) => void
}) {
  const [mode, setMode] = useDiffViewMode()
  onMode(mode)
  if (onSet) onSet(setMode)
  return null
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('useDiffViewMode', () => {
  it('defaults to split when localStorage is empty', () => {
    const observed: DiffViewMode[] = []
    render(<Probe onMode={(m) => observed.push(m)} />)
    expect(observed.at(-1)).toBe('split')
  })

  it('reads the persisted value on mount', () => {
    window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, 'inline')
    const observed: DiffViewMode[] = []
    render(<Probe onMode={(m) => observed.push(m)} />)
    expect(observed.at(-1)).toBe('inline')
  })

  it('setMode writes to localStorage and emits the custom event', () => {
    let setter: ((m: DiffViewMode) => void) | null = null
    const observed: DiffViewMode[] = []
    render(
      <Probe
        onMode={(m) => observed.push(m)}
        onSet={(s) => {
          setter = s
        }}
      />,
    )
    act(() => {
      setter!('inline')
    })
    expect(window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY)).toBe('inline')
    expect(observed.at(-1)).toBe('inline')
  })

  it('a second mounted instance receives the new mode via the custom event', () => {
    let setter: ((m: DiffViewMode) => void) | null = null
    const aSeen: DiffViewMode[] = []
    const bSeen: DiffViewMode[] = []
    render(
      <>
        <Probe onMode={(m) => aSeen.push(m)} onSet={(s) => (setter = s)} />
        <Probe onMode={(m) => bSeen.push(m)} />
      </>,
    )
    expect(bSeen.at(-1)).toBe('split')
    act(() => {
      setter!('inline')
    })
    expect(bSeen.at(-1)).toBe('inline')
  })

  it('cross-tab: dispatching a storage event updates the mode', () => {
    const observed: DiffViewMode[] = []
    render(<Probe onMode={(m) => observed.push(m)} />)
    act(() => {
      const ev = new StorageEvent('storage', {
        key: DIFF_VIEW_STORAGE_KEY,
        newValue: 'inline',
        oldValue: 'split',
      })
      window.dispatchEvent(ev)
    })
    expect(observed.at(-1)).toBe('inline')
  })

  it('ignores invalid stored values (falls back to default)', () => {
    window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, 'garbage')
    const observed: DiffViewMode[] = []
    render(<Probe onMode={(m) => observed.push(m)} />)
    expect(observed.at(-1)).toBe('split')
  })

  it('custom event with detail ignores invalid values', () => {
    const observed: DiffViewMode[] = []
    render(<Probe onMode={(m) => observed.push(m)} />)
    expect(observed.at(-1)).toBe('split')
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DIFF_VIEW_EVENT, { detail: 'garbage' as unknown as DiffViewMode }),
      )
    })
    expect(observed.at(-1)).toBe('split')
  })
})
