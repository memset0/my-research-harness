'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import type { ProjectTarget } from '../lib/api'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  moveWikiWorkspaceUrl,
  parseWikiWorkspaceUrl,
  removeWikiWorkspaceUrl,
  setWikiWorkspaceUrl,
  switchWikiWorkspaceUrl,
  type WikiWorkspaceSurface,
  type WikiWorkspaceUrlState,
} from '../lib/wiki-workspace-url'
import {
  currentWorkspaceHref,
  replaceWorkspaceHistory,
  WORKSPACE_HISTORY_EVENT,
} from '../lib/workspace-history'
import { projectFromWorkspacePathname } from './use-report-workspace'
import { useIsMobile } from './use-mobile'

export interface WikiWorkspaceController {
  project: ProjectTarget | null
  state: WikiWorkspaceUrlState | null
  effectiveSurface: WikiWorkspaceSurface | null
  openWiki: (wikiId: string, surface?: WikiWorkspaceSurface) => void
  switchWiki: (wikiId: string) => void
  moveWiki: (surface: WikiWorkspaceSurface) => void
  closeWiki: () => void
}

export function useWikiWorkspace(): WikiWorkspaceController {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()
  const currentHref = useMemo(() => {
    const search = searchParams?.toString() ?? ''
    return `${pathname ?? '/'}${search ? `?${search}` : ''}`
  }, [pathname, searchParams])
  const [optimisticHref, setOptimisticHref] = useState<string | null>(null)
  const effectiveHref = optimisticHref ?? currentHref
  const state = useMemo(() => parseWikiWorkspaceUrl(effectiveHref), [effectiveHref])
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

  // A stale/manual URL may carry both document identities. Wiki wins by
  // contract, and normalization removes the redundant Report pair without a
  // route navigation or remount of the left document.
  useEffect(() => {
    if (!state) return
    const url = new URL(effectiveHref, 'http://memon.invalid')
    if (!url.searchParams.has('report') && !url.searchParams.has('reportSurface')) return
    const normalized = setWikiWorkspaceUrl(effectiveHref, state.wikiId, state.surface)
    setOptimisticHref(normalized)
    replaceWorkspaceHistory(normalized)
  }, [effectiveHref, state])

  const openWiki = useCallback(
    (wikiId: string, surface: WikiWorkspaceSurface = 'split') => {
      replace((href) => setWikiWorkspaceUrl(href, wikiId, surface))
    },
    [replace],
  )
  const switchWiki = useCallback(
    (wikiId: string) => replace((href) => switchWikiWorkspaceUrl(href, wikiId)),
    [replace],
  )
  const moveWiki = useCallback(
    (surface: WikiWorkspaceSurface) => replace((href) => moveWikiWorkspaceUrl(href, surface)),
    [replace],
  )
  const closeWiki = useCallback(() => replace((href) => removeWikiWorkspaceUrl(href)), [replace])

  return {
    project,
    state,
    // A viewport that cannot host two usable columns collapses a requested
    // split into the drawer without rewriting the URL, so restoring the same
    // link on a wide screen still yields the split.
    effectiveSurface: state ? (isMobile ? 'drawer' : state.surface) : null,
    openWiki,
    switchWiki,
    moveWiki,
    closeWiki,
  }
}
