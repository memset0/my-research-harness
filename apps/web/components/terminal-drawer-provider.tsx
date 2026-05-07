'use client'

// Layout-scoped state holder for the single browser-terminal drawer.
//
// Design rationale (see openspec/changes/run-action-bar-rework/):
// - Old model: every <TerminalButton> owned its own React state and the
//   drawer's onClose called /api/terminal/stop, killing the ttyd child
//   so a reopen had to bootstrap from scratch.
// - New model: drawer state lives here, mounted once in the project layout.
//   Closing the drawer hides it but keeps the ttyd + tmux session alive.
//   Tear-down happens on (a) explicit "Close + stop session", (b) route
//   change, or (c) a different `Open with` invocation that needs a
//   different sessionName (the existing single-port constraint).

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet'
import { Button } from './ui/button'
import { Power } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { stopTerminal, type TerminalAgentKind } from '../lib/api'
import { TerminalView } from './terminal-view'

interface DrawerState {
  runId: string
  projectName: string
  agent: TerminalAgentKind
  /** Populated once TerminalView reports the sessionName (post-start). */
  sessionName: string | null
}

interface DrawerApi {
  /** Open the drawer for a given run + agent. */
  open: (input: Omit<DrawerState, 'sessionName'>) => void
  /** Hide the drawer without killing the session (X / outside-click). */
  close: () => void
  /** Hide the drawer AND kill the session (explicit user action / route change). */
  closeAndStop: () => void
}

const TerminalDrawerContext = createContext<DrawerApi | null>(null)

const NOOP_API: DrawerApi = {
  open: () => {},
  close: () => {},
  closeAndStop: () => {},
}

/**
 * Returns the drawer API. If the caller is rendered outside a
 * <TerminalDrawerProvider>, returns a no-op API and leaves a console
 * warning. (Tests that mount sub-components without the layout get a
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
  const pathname = usePathname()
  const lastPathnameRef = useRef(pathname)

  const open = useCallback((input: Omit<DrawerState, 'sessionName'>) => {
    setState({ ...input, sessionName: null })
  }, [])

  const close = useCallback(() => {
    setState(null)
  }, [])

  const closeAndStop = useCallback(() => {
    setState((prev) => {
      if (prev?.sessionName) {
        void stopTerminal(prev.sessionName).catch(() => {
          /* swallow — best-effort */
        })
      }
      return null
    })
  }, [])

  // Tear down on route change.
  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname
      closeAndStop()
    }
  }, [pathname, closeAndStop])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) close()
    },
    [close],
  )

  const handleSessionReady = useCallback((sessionName: string) => {
    setState((prev) => (prev ? { ...prev, sessionName } : prev))
  }, [])

  return (
    <TerminalDrawerContext.Provider value={{ open, close, closeAndStop }}>
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
                      {state.sessionName ?? `memon-${state.agent === 'none' ? 'term' : state.agent}-${state.runId}`}
                    </SheetTitle>
                    <SheetDescription className="text-[11px]">
                      Closing this panel leaves the tmux session attached. It
                      stops on route change or by the button on the right.
                    </SheetDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={closeAndStop}
                    className="shrink-0"
                  >
                    <Power className="size-3" />
                    Close + stop
                  </Button>
                </div>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-hidden">
                <TerminalView
                  runId={state.runId}
                  projectName={state.projectName}
                  agent={state.agent}
                  onSessionReady={handleSessionReady}
                />
              </div>
            </>
          ) : (
            // Nothing to render when state is null. The Sheet is closed.
            <SheetTitle className="sr-only">terminal</SheetTitle>
          )}
        </SheetContent>
      </Sheet>
    </TerminalDrawerContext.Provider>
  )
}
