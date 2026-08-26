'use client'

// SessionProvider — exposes `{role, scopeProjects}` to client components.
//
// The value is server-injected via a <script id="memon-session" type="application/json">
// block in the root layout. On client mount we read that script, parse it,
// and put it into a React context. SSR-safe: the same parsing happens on the
// server during initial render, so hydration matches.

import type { ProjectRef } from '@memon/core'
import { createContext, useContext, useMemo } from 'react'

export type SessionRole = 'owner' | 'viewer' | 'anon'

export interface SessionInfo {
  role: SessionRole
  scopeProjects: string[]
  scopeProjectRefs?: ProjectRef[]
}

// Test-friendly default: when no <SessionProvider> wraps the tree, treat the
// active session as owner. Production code always renders the provider with
// a real value (server-injected). This keeps legacy component tests that
// don't know about session context from accidentally tripping the
// viewer-mode disable path in ViewerGuard.
const FALLBACK_OWNER_SESSION: SessionInfo = {
  role: 'owner',
  scopeProjects: [],
  scopeProjectRefs: [],
}

const SessionContext = createContext<SessionInfo | null>(null)

interface ProviderProps {
  value: SessionInfo
  children: React.ReactNode
}

export function SessionProvider({ value, children }: ProviderProps) {
  const memoized = useMemo<SessionInfo>(
    () => ({
      role: value.role,
      scopeProjects: Array.from(new Set(value.scopeProjects)),
      scopeProjectRefs: value.scopeProjectRefs ?? [],
    }),
    [value.role, value.scopeProjects, value.scopeProjectRefs],
  )
  return <SessionContext.Provider value={memoized}>{children}</SessionContext.Provider>
}

export function useSession(): SessionInfo {
  const ctx = useContext(SessionContext)
  return ctx ?? FALLBACK_OWNER_SESSION
}

export function useIsViewer(): boolean {
  return useSession().role === 'viewer'
}

export function useIsOwner(): boolean {
  return useSession().role === 'owner'
}
