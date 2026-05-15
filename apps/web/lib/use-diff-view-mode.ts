'use client'

// Global preference: side-by-side ("split") vs unified ("inline") diff
// rendering. Persisted in localStorage so the setting survives reload, and
// broadcast via a custom event so every mounted `<FileDiff />` re-renders
// the same way without prop drilling.

import { useCallback, useEffect, useState } from 'react'

export type DiffViewMode = 'split' | 'inline'

export const DIFF_VIEW_STORAGE_KEY = 'memon:diff-view:mode'
export const DIFF_VIEW_EVENT = 'memon:diff-view-mode-change'

const DEFAULT_MODE: DiffViewMode = 'split'

function isValid(v: unknown): v is DiffViewMode {
  return v === 'split' || v === 'inline'
}

function readFromStorage(): DiffViewMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  try {
    const raw = window.localStorage.getItem(DIFF_VIEW_STORAGE_KEY)
    return isValid(raw) ? raw : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

export function useDiffViewMode(): [DiffViewMode, (next: DiffViewMode) => void] {
  // Start with the SSR-safe default; sync to localStorage after mount.
  const [mode, setLocalMode] = useState<DiffViewMode>(DEFAULT_MODE)

  useEffect(() => {
    setLocalMode(readFromStorage())
    function onChange(ev: Event) {
      const detail = (ev as CustomEvent<DiffViewMode>).detail
      if (isValid(detail)) setLocalMode(detail)
    }
    function onStorage(ev: StorageEvent) {
      if (ev.key !== DIFF_VIEW_STORAGE_KEY) return
      if (isValid(ev.newValue)) setLocalMode(ev.newValue)
    }
    window.addEventListener(DIFF_VIEW_EVENT, onChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(DIFF_VIEW_EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setMode = useCallback((next: DiffViewMode) => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, next)
    } catch {
      /* localStorage unavailable — still emit the event so this tab updates */
    }
    window.dispatchEvent(
      new CustomEvent<DiffViewMode>(DIFF_VIEW_EVENT, { detail: next }),
    )
  }, [])

  return [mode, setMode]
}
