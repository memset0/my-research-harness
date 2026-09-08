import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampWorkspacePanelWidth,
  DRAWER_WIDTH_STORAGE_KEY,
  defaultWorkspacePanelWidth,
  getWorkspacePanelBounds,
  parseStoredWorkspacePanelWidth,
  SPLIT_WIDTH_STORAGE_KEY,
  useWorkspacePanelWidth,
} from './use-workspace-panel-width'

describe('workspace panel width preferences', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1440,
    })
  })

  it('preserves the historical drawer defaults', () => {
    expect(defaultWorkspacePanelWidth('drawer', 1920)).toBe(1280)
    expect(defaultWorkspacePanelWidth('drawer', 1024)).toBe(819)
  })

  it('reserves usable dashboard width for the split', () => {
    expect(getWorkspacePanelBounds('split', 1200)).toEqual({ min: 360, max: 840 })
    expect(clampWorkspacePanelWidth(1000, 'split', 1200)).toBe(840)
  })

  it('clamps the drawer to a viewport gutter and absolute maximum', () => {
    expect(clampWorkspacePanelWidth(2000, 'drawer', 1920)).toBe(1600)
    expect(clampWorkspacePanelWidth(1000, 'drawer', 800)).toBe(768)
  })

  it('rejects malformed persisted values', () => {
    expect(parseStoredWorkspacePanelWidth(null)).toBeNull()
    expect(parseStoredWorkspacePanelWidth('')).toBeNull()
    expect(parseStoredWorkspacePanelWidth('wide')).toBeNull()
    expect(parseStoredWorkspacePanelWidth('-20')).toBeNull()
    expect(parseStoredWorkspacePanelWidth('612.6')).toBe(613)
  })

  it('restores and stores drawer and split widths independently', async () => {
    localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, '900')
    localStorage.setItem(SPLIT_WIDTH_STORAGE_KEY, '520')
    const drawer = renderHook(() => useWorkspacePanelWidth('drawer'))
    const split = renderHook(() => useWorkspacePanelWidth('split'))
    await waitFor(() => expect(drawer.result.current.widthPx).toBe(900))
    await waitFor(() => expect(split.result.current.widthPx).toBe(520))

    act(() => drawer.result.current.setWidthPx(940))
    act(() => split.result.current.setWidthPx(560))
    expect(localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY)).toBe('940')
    expect(localStorage.getItem(SPLIT_WIDTH_STORAGE_KEY)).toBe('560')
  })

  it('uses the measured workspace outlet width for split bounds', async () => {
    localStorage.setItem(SPLIT_WIDTH_STORAGE_KEY, '800')
    const split = renderHook(
      ({ availableWidth }) => useWorkspacePanelWidth('split', availableWidth),
      { initialProps: { availableWidth: 900 } },
    )

    await waitFor(() => expect(split.result.current.widthPx).toBe(540))

    split.rerender({ availableWidth: 1200 })
    await waitFor(() => expect(split.result.current.widthPx).toBe(800))
  })
})
