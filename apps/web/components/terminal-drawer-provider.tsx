'use client'

// Root-mounted state holder for the single browser-terminal drawer.
//
// Design (post tmux-session-rework + attach-tmux-by-name):
// - Mounted at root layout (in `Providers`), so the drawer is reachable
//   from every page including `/manage/tmux`.
// - Drawer state is a discriminated union with two modes:
//   - `kind: 'standard'` — carries (project, scope, slug, agent). Used by
//     run/exp page action bar's `Open with` button. Hits POST
//     /api/terminal/start.
//   - `kind: 'raw'` — carries just sessionName. Used by /manage/tmux's
//     manual rows where no parsed target exists. Hits POST
//     /api/terminal/attach.
// - Drawer state persists across pathname changes — navigation alone
//   neither closes the drawer nor kills the underlying ttyd / tmux.
// - `X` close (or escape / outside-click) hides the drawer; ttyd + tmux
//   stay alive (LRU + Idle TTL handle ttyd cleanup; tmux is only killed
//   via the management page or by the user exiting the agent / shell from
//   inside ttyd).
// - `Pop out` opens the same target in a popup window AND closes the
//   drawer. Both views share the same ttyd via the manager's sessionName
//   dedup.

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
import type { TerminalAgentKind, TerminalScopeKind } from '../lib/api'
import { TerminalView } from './terminal-view'

export type { TerminalScopeKind }

interface StandardDrawerState {
  kind: 'standard'
  project: string
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
  /** Populated once TerminalView reports the sessionName (post-start). */
  sessionName: string | null
}

interface RawDrawerState {
  kind: 'raw'
  sessionName: string
}

type DrawerState = StandardDrawerState | RawDrawerState

export interface DrawerOpenInput {
  project: string
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
}

export interface DrawerOpenRawInput {
  sessionName: string
}

interface DrawerApi {
  /** Open the drawer in standard mode (parsed target → /api/terminal/start). */
  open: (input: DrawerOpenInput) => void
  /** Open the drawer in raw mode (sessionName-only → /api/terminal/attach). */
  openRaw: (input: DrawerOpenRawInput) => void
  close: () => void
}

const TerminalDrawerContext = createContext<DrawerApi | null>(null)

const NOOP_API: DrawerApi = {
  open: () => {},
  openRaw: () => {},
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

function deriveStandardSessionName(state: StandardDrawerState): string {
  return state.sessionName ??
    `memon-${state.agent === 'none' ? 'terminal' : state.agent}-${state.project}--${state.scope}--${state.slug}`
}

function popupUrlFor(state: DrawerState): string {
  if (state.kind === 'standard') {
    return (
      `/terminal-popup?project=${encodeURIComponent(state.project)}` +
      `&scope=${encodeURIComponent(state.scope)}` +
      `&slug=${encodeURIComponent(state.slug)}` +
      `&agent=${encodeURIComponent(state.agent)}`
    )
  }
  return `/terminal-popup?sessionName=${encodeURIComponent(state.sessionName)}`
}

function popupTargetFor(state: DrawerState): string {
  if (state.kind === 'standard') {
    const name = deriveStandardSessionName(state)
    return `memon-popup-${name}`
  }
  return `memon-popup-${state.sessionName}`
}

export function TerminalDrawerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DrawerState | null>(null)

  const open = useCallback((input: DrawerOpenInput) => {
    setState({ kind: 'standard', ...input, sessionName: null })
  }, [])

  const openRaw = useCallback((input: DrawerOpenRawInput) => {
    setState({ kind: 'raw', sessionName: input.sessionName })
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
    setState((prev) => {
      if (!prev) return prev
      if (prev.kind === 'standard') return { ...prev, sessionName }
      // Raw mode: sessionName is fixed at open time; no update needed.
      return prev
    })
  }, [])

  const handlePopOut = useCallback(() => {
    setState((cur) => {
      if (!cur) return cur
      window.open(popupUrlFor(cur), popupTargetFor(cur), 'popup,width=1200,height=800')
      return null
    })
  }, [])

  return (
    <TerminalDrawerContext.Provider value={{ open, openRaw, close }}>
      {children}
      <Sheet open={state !== null} onOpenChange={handleOpenChange}>
        <SheetContent
          side="right"
          className="flex w-[min(80vw,1280px)] flex-col gap-2 p-0 sm:max-w-[1280px]"
        >
          {state ? (
            <>
              <SheetHeader className="border-b p-3 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <SheetTitle className="font-mono text-xs">
                      {state.kind === 'standard' ? (
                        <>
                          {state.agent} · {deriveStandardSessionName(state)}
                        </>
                      ) : (
                        state.sessionName
                      )}
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
                {state.kind === 'standard' ? (
                  <TerminalView
                    mode="standard"
                    project={state.project}
                    scope={state.scope}
                    slug={state.slug}
                    agent={state.agent}
                    onSessionReady={handleSessionReady}
                    source="drawer"
                  />
                ) : (
                  <TerminalView
                    mode="raw"
                    sessionName={state.sessionName}
                    source="drawer"
                  />
                )}
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
