'use client'

// Root-mounted state holder for the single browser-terminal drawer.
//
// Design (post tmux-session-rework):
// - Mounted at root layout (in `Providers`), so the drawer is reachable
//   from every page including `/manage/tmux`.
// - Drawer state persists across pathname changes — navigation alone
//   neither closes the drawer nor kills the underlying ttyd / tmux.
// - `X` close (or escape / outside-click) hides the drawer; ttyd + tmux
//   stay alive (LRU + Idle TTL handle ttyd cleanup; tmux is only killed
//   via the management page or by the user exiting the agent / shell from
//   inside ttyd).
// - `Pop out` opens the same `(agent, project, scope, slug)` in a popup
//   window AND closes the drawer. Both views share the same ttyd thanks
//   to the manager's sessionName dedup.

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet'
import { Button } from './ui/button'
import { ExternalLink } from 'lucide-react'
import { createContext, useCallback, useContext, useState } from 'react'
import type { TerminalAgentKind } from '../lib/api'
import { TerminalView } from './terminal-view'

export type TerminalScopeKind = 'exp' | 'run'

interface DrawerState {
  project: string
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
  /** Populated once TerminalView reports the sessionName (post-start). */
  sessionName: string | null
}

export interface DrawerOpenInput {
  project: string
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
}

interface DrawerApi {
  open: (input: DrawerOpenInput) => void
  close: () => void
}

const TerminalDrawerContext = createContext<DrawerApi | null>(null)

const NOOP_API: DrawerApi = {
  open: () => {},
  close: () => {},
}

/**
 * Returns the drawer API. If the caller is rendered outside a
 * <TerminalDrawerProvider>, returns a no-op API and leaves a console
 * warning. (Tests that mount sub-components without the provider get a
 * silent no-op rather than an exception.)
 */
export function useTerminalDrawer(): DrawerApi {
  const ctx = useContext(TerminalDrawerContext)
  if (!ctx) {
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.warn(
        'useTerminalDrawer: no <TerminalDrawerProvider> in tree. Falling back to a no-op API.',
      )
    }
    return NOOP_API
  }
  return ctx
}

export function TerminalDrawerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DrawerState | null>(null)

  const open = useCallback((input: DrawerOpenInput) => {
    setState({ ...input, sessionName: null })
  }, [])

  const close = useCallback(() => {
    setState(null)
  }, [])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close()
    },
    [close],
  )

  const handleSessionReady = useCallback((sessionName: string) => {
    setState((prev) => (prev ? { ...prev, sessionName } : prev))
  }, [])

  const handlePopOut = useCallback(() => {
    setState((cur) => {
      if (!cur) return cur
      const target = cur.sessionName
        ? `memon-popup-${cur.sessionName}`
        : `memon-popup-${cur.agent}-${cur.project}-${cur.scope}-${cur.slug}`
      const url =
        `/terminal-popup?project=${encodeURIComponent(cur.project)}` +
        `&scope=${encodeURIComponent(cur.scope)}` +
        `&slug=${encodeURIComponent(cur.slug)}` +
        `&agent=${encodeURIComponent(cur.agent)}`
      window.open(url, target, 'popup,width=1200,height=800')
      return null
    })
  }, [])

  return (
    <TerminalDrawerContext.Provider value={{ open, close }}>
      {children}
      <Sheet open={state !== null} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="flex w-[min(95vw,960px)] flex-col gap-2 p-0 sm:max-w-[960px]"
        >
          {state ? (
            <>
              <SheetHeader className="border-b p-3 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <SheetTitle className="font-mono text-xs">
                      {state.agent} ·{' '}
                      {state.sessionName ??
                        `memon-${state.agent === 'none' ? 'terminal' : state.agent}-${state.project}--${state.scope}--${state.slug}`}
                    </SheetTitle>
                    <SheetDescription className="text-[11px]">
                      Closing this panel keeps ttyd and the tmux session alive.
                      Sessions persist across server restarts; manage them at{' '}
                      <code className="rounded bg-muted px-1">/manage/tmux</code>.
                    </SheetDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePopOut}
                    className="shrink-0"
                  >
                    <ExternalLink className="size-3" />
                    Pop out
                  </Button>
                </div>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-hidden">
                <TerminalView
                  project={state.project}
                  scope={state.scope}
                  slug={state.slug}
                  agent={state.agent}
                  onSessionReady={handleSessionReady}
                />
              </div>
            </>
          ) : (
            <SheetTitle className="sr-only">terminal</SheetTitle>
          )}
        </SheetContent>
      </Sheet>
    </TerminalDrawerContext.Provider>
  )
}
