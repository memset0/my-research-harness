'use client'

import { useCallback, useEffect, useState } from 'react'

export type WorkspacePanelSurface = 'drawer' | 'split'

export const DRAWER_WIDTH_STORAGE_KEY = 'memon:workspace:drawer-width'
export const SPLIT_WIDTH_STORAGE_KEY = 'memon:workspace:split-width'

export const MIN_WORKSPACE_PANEL_PX = 360
export const MIN_SPLIT_MAIN_PX = 360
export const MAX_WORKSPACE_PANEL_PX = 1600

const DRAWER_VIEWPORT_GUTTER_PX = 32
const DRAWER_MAX_DEFAULT_PX = 1280
const SPLIT_MAX_DEFAULT_PX = 720
const FALLBACK_VIEWPORT_PX = 1200

export interface WorkspacePanelBounds {
  min: number
  max: number
}

function storageKeyFor(surface: WorkspacePanelSurface): string {
  return surface === 'drawer' ? DRAWER_WIDTH_STORAGE_KEY : SPLIT_WIDTH_STORAGE_KEY
}

export function getWorkspacePanelBounds(
  surface: WorkspacePanelSurface,
  availableWidth: number,
): WorkspacePanelBounds {
  const safeAvailableWidth = Number.isFinite(availableWidth)
    ? Math.max(0, Math.round(availableWidth))
    : FALLBACK_VIEWPORT_PX
  const available =
    surface === 'drawer'
      ? safeAvailableWidth - DRAWER_VIEWPORT_GUTTER_PX
      : safeAvailableWidth - MIN_SPLIT_MAIN_PX
  const max = Math.max(240, Math.min(MAX_WORKSPACE_PANEL_PX, available))
  return { min: Math.min(MIN_WORKSPACE_PANEL_PX, max), max }
}

export function clampWorkspacePanelWidth(
  width: number,
  surface: WorkspacePanelSurface,
  availableWidth: number,
): number {
  const bounds = getWorkspacePanelBounds(surface, availableWidth)
  const safeWidth = Number.isFinite(width) ? width : bounds.min
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, safeWidth)))
}

export function defaultWorkspacePanelWidth(
  surface: WorkspacePanelSurface,
  availableWidth: number,
): number {
  const desired =
    surface === 'drawer'
      ? Math.min(availableWidth * 0.8, DRAWER_MAX_DEFAULT_PX)
      : Math.min(availableWidth * 0.4, SPLIT_MAX_DEFAULT_PX)
  return clampWorkspacePanelWidth(desired, surface, availableWidth)
}

export function parseStoredWorkspacePanelWidth(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null
}

function currentViewportWidth(): number {
  return typeof window === 'undefined' ? FALLBACK_VIEWPORT_PX : window.innerWidth
}

/**
 * Persisted width for the shared drawer/right-split workspace surface.
 *
 * Drawers are bounded by the browser viewport. A split may pass the measured
 * width of its outlet because the project sidebar now sits outside that
 * outlet; using `window.innerWidth` there would reserve 360px for the sidebar
 * plus document together rather than for the document itself.
 */
export function useWorkspacePanelWidth(surface: WorkspacePanelSurface, availableWidth?: number) {
  const widthBasis = useCallback(() => {
    if (
      surface === 'split' &&
      availableWidth !== undefined &&
      Number.isFinite(availableWidth) &&
      availableWidth > 0
    ) {
      return availableWidth
    }
    return currentViewportWidth()
  }, [availableWidth, surface])

  const [widthPx, setWidthState] = useState(() =>
    defaultWorkspacePanelWidth(surface, FALLBACK_VIEWPORT_PX),
  )

  useEffect(() => {
    const currentAvailableWidth = widthBasis()
    let stored: number | null = null
    try {
      stored = parseStoredWorkspacePanelWidth(localStorage.getItem(storageKeyFor(surface)))
    } catch {
      // Storage can be unavailable in privacy-restricted browsing contexts.
    }
    setWidthState(
      stored == null
        ? defaultWorkspacePanelWidth(surface, currentAvailableWidth)
        : clampWorkspacePanelWidth(stored, surface, currentAvailableWidth),
    )

    const handleResize = () => {
      setWidthState((current) => clampWorkspacePanelWidth(current, surface, widthBasis()))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [surface, widthBasis])

  const setWidthPx = useCallback(
    (next: number) => {
      const clamped = clampWorkspacePanelWidth(next, surface, widthBasis())
      setWidthState(clamped)
      try {
        localStorage.setItem(storageKeyFor(surface), String(clamped))
      } catch {
        // The width remains useful for this mount even if it cannot persist.
      }
    },
    [surface, widthBasis],
  )

  return { widthPx, setWidthPx }
}
