import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIsDesktop } from './use-is-desktop'

interface MQLStub {
  matches: boolean
  media: string
  listeners: Set<(e: MediaQueryListEvent) => void>
  addEventListener: (type: 'change', cb: (e: MediaQueryListEvent) => void) => void
  removeEventListener: (type: 'change', cb: (e: MediaQueryListEvent) => void) => void
  addListener: (cb: (e: MediaQueryListEvent) => void) => void
  removeListener: (cb: (e: MediaQueryListEvent) => void) => void
  onchange: null
  dispatchEvent: () => boolean
}

let currentMQL: MQLStub | null = null

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
    writable: true,
  })
  if (currentMQL) {
    currentMQL.matches = width >= 1024
  }
}

beforeEach(() => {
  currentMQL = null
  window.matchMedia = vi.fn((query: string) => {
    const stub: MQLStub = {
      matches: window.innerWidth >= 1024,
      media: query,
      listeners: new Set(),
      addEventListener: (_type, cb) => stub.listeners.add(cb),
      removeEventListener: (_type, cb) => stub.listeners.delete(cb),
      addListener: (cb) => stub.listeners.add(cb),
      removeListener: (cb) => stub.listeners.delete(cb),
      onchange: null,
      dispatchEvent: () => true,
    }
    currentMQL = stub
    return stub as unknown as MediaQueryList
  })
})

afterEach(() => {
  currentMQL = null
})

describe('useIsDesktop', () => {
  it('returns true when viewport ≥ 1024px', () => {
    setViewport(1280)
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(true)
  })

  it('returns false when viewport < 1024px', () => {
    setViewport(800)
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)
  })

  it('flips when viewport crosses the 1024px threshold', () => {
    setViewport(1280)
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(true)

    act(() => {
      setViewport(800)
      // Fire the matchMedia change listeners we registered
      currentMQL?.listeners.forEach((cb) => {
        cb({ matches: false } as MediaQueryListEvent)
      })
    })
    expect(result.current).toBe(false)

    act(() => {
      setViewport(1400)
      currentMQL?.listeners.forEach((cb) => {
        cb({ matches: true } as MediaQueryListEvent)
      })
    })
    expect(result.current).toBe(true)
  })
})
