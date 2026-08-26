'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  moveReportWorkspaceUrl,
  parseReportWorkspaceUrl,
  type ReportWorkspaceSurface,
  type ReportWorkspaceUrlState,
  removeReportWorkspaceUrl,
  setReportWorkspaceUrl,
  switchReportWorkspaceUrl,
} from '../lib/report-workspace-url'
import {
  currentWorkspaceHref,
  replaceWorkspaceHistory,
  WORKSPACE_HISTORY_EVENT,
} from '../lib/workspace-history'
import { useIsMobile } from './use-mobile'

export interface ReportWorkspaceController {
  project: string | null
  state: ReportWorkspaceUrlState | null
  effectiveSurface: ReportWorkspaceSurface | null
  openReport: (reportId: string, surface?: ReportWorkspaceSurface) => void
  switchReport: (reportId: string) => void
  moveReport: (surface: ReportWorkspaceSurface) => void
  closeReport: () => void
}

export function projectFromWorkspacePathname(pathname: string): string | null {
  const match = /^\/p\/([^/]+)(?:\/|$)/.exec(pathname)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return null
  }
}

export function useReportWorkspace(): ReportWorkspaceController {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()
  const currentHref = useMemo(() => {
    const search = searchParams?.toString() ?? ''
    return `${pathname ?? '/'}${search ? `?${search}` : ''}`
  }, [pathname, searchParams])
  const [optimisticHref, setOptimisticHref] = useState<string | null>(null)
  const effectiveHref = optimisticHref ?? currentHref
  const state = useMemo(() => parseReportWorkspaceUrl(effectiveHref), [effectiveHref])
  const project = useMemo(() => projectFromWorkspacePathname(pathname ?? '/'), [pathname])

  useEffect(() => {
    if (currentHref !== '') setOptimisticHref(null)
  }, [currentHref])

  useEffect(() => {
    const syncFromHistory = () => setOptimisticHref(currentWorkspaceHref(currentHref))
    window.addEventListener(WORKSPACE_HISTORY_EVENT, syncFromHistory)
    return () => window.removeEventListener(WORKSPACE_HISTORY_EVENT, syncFromHistory)
  }, [currentHref])

  const replace = useCallback(
    (build: (href: string) => string) => {
      const href = currentWorkspaceHref(currentHref)
      const nextHref = build(href)
      setOptimisticHref(nextHref)
      replaceWorkspaceHistory(nextHref)
    },
    [currentHref],
  )

  const openReport = useCallback(
    (reportId: string, surface: ReportWorkspaceSurface = 'split') => {
      replace((href) => setReportWorkspaceUrl(href, reportId, surface))
    },
    [replace],
  )
  const switchReport = useCallback(
    (reportId: string) => replace((href) => switchReportWorkspaceUrl(href, reportId)),
    [replace],
  )
  const moveReport = useCallback(
    (surface: ReportWorkspaceSurface) => replace((href) => moveReportWorkspaceUrl(href, surface)),
    [replace],
  )
  const closeReport = useCallback(
    () => replace((href) => removeReportWorkspaceUrl(href)),
    [replace],
  )

  return {
    project,
    state,
    effectiveSurface: state ? (isMobile ? 'drawer' : state.surface) : null,
    openReport,
    switchReport,
    moveReport,
    closeReport,
  }
}
