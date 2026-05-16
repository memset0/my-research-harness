import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_PX,
  MAX_PX,
  MIN_PX,
  STORAGE_KEY,
  parseStoredWidth,
  useSidebarWidth,
} from './use-sidebar-width'

describe('parseStoredWidth', () => {
  it('returns null for missing key', () => {
    expect(parseStoredWidth(null)).toBeNull()
  })

  it('returns null for non-numeric values (falls back to default)', () => {
    expect(parseStoredWidth('abc')).toBeNull()
  })

  it('clamps "50" to MIN_PX', () => {
    expect(parseStoredWidth('50')).toBe(MIN_PX)
  })

  it('clamps "1000" to MAX_PX', () => {
    expect(parseStoredWidth('1000')).toBe(MAX_PX)
  })

  it('passes through in-range values', () => {
    expect(parseStoredWidth('300')).toBe(300)
  })
})

describe('useSidebarWidth', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('initial value is DEFAULT_PX when storage is empty', () => {
    const { result } = renderHook(() => useSidebarWidth())
    expect(result.current.widthPx).toBe(DEFAULT_PX)
  })

  it('hydrates from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, '300')
    const { result } = renderHook(() => useSidebarWidth())
    // useEffect runs synchronously in @testing-library/react's renderHook
    // for jsdom, so the post-mount value is already in result.current.
    expect(result.current.widthPx).toBe(300)
  })

  it('clamps stored "1000" to MAX_PX on hydration', () => {
    localStorage.setItem(STORAGE_KEY, '1000')
    const { result } = renderHook(() => useSidebarWidth())
    expect(result.current.widthPx).toBe(MAX_PX)
  })

  it('falls back to DEFAULT_PX on unparseable stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'abc')
    const { result } = renderHook(() => useSidebarWidth())
    expect(result.current.widthPx).toBe(DEFAULT_PX)
  })

  it('setWidthPx writes back to localStorage with clamping', () => {
    const { result } = renderHook(() => useSidebarWidth())
    act(() => result.current.setWidthPx(320))
    expect(result.current.widthPx).toBe(320)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('320')

    act(() => result.current.setWidthPx(1000))
    expect(result.current.widthPx).toBe(MAX_PX)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(MAX_PX))

    act(() => result.current.setWidthPx(10))
    expect(result.current.widthPx).toBe(MIN_PX)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(MIN_PX))
  })

  it('rounds fractional values', () => {
    const { result } = renderHook(() => useSidebarWidth())
    act(() => result.current.setWidthPx(257.4))
    expect(result.current.widthPx).toBe(257)
  })
})
