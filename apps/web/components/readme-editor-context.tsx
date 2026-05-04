'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { clampWidth, readWidthPref, writeWidthPref } from '../lib/readme-editor-prefs'

interface ReadmeEditorContextValue {
  open: boolean
  collapsed: boolean
  width: number
  setOpen: (v: boolean) => void
  toggleOpen: () => void
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void
  setWidth: (px: number) => void
}

const Ctx = createContext<ReadmeEditorContextValue | null>(null)

const DEFAULT_WIDTH = 560

export function ReadmeEditorProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const [collapsed, setCollapsedState] = useState(false)
  const [width, setWidthState] = useState<number>(DEFAULT_WIDTH)

  // Hydrate persisted width on first client tick
  useEffect(() => {
    const saved = readWidthPref()
    if (saved !== null) {
      const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
      setWidthState(clampWidth(saved, vw))
    }
  }, [])

  const setOpen = useCallback((v: boolean) => setOpenState(v), [])
  const toggleOpen = useCallback(() => setOpenState((p) => !p), [])
  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), [])
  const toggleCollapsed = useCallback(() => setCollapsedState((p) => !p), [])
  const setWidth = useCallback((px: number) => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440
    const clamped = clampWidth(px, vw)
    setWidthState(clamped)
    writeWidthPref(clamped)
  }, [])

  const value = useMemo<ReadmeEditorContextValue>(
    () => ({ open, collapsed, width, setOpen, toggleOpen, setCollapsed, toggleCollapsed, setWidth }),
    [open, collapsed, width, setOpen, toggleOpen, setCollapsed, toggleCollapsed, setWidth],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReadmeEditor(): ReadmeEditorContextValue {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error('useReadmeEditor must be used within <ReadmeEditorProvider>')
  }
  return v
}

/**
 * Optional variant that returns null when no provider is mounted.
 * Used by EditReadmeButton which is also rendered on pages without provider.
 */
export function useReadmeEditorOptional(): ReadmeEditorContextValue | null {
  return useContext(Ctx)
}
