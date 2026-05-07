'use client'

// Shared terminal-iframe view used by both the side drawer
// (terminal-sheet.tsx) and the popup-window route (app/terminal-popup/page.tsx).
// Owns the start-session lifecycle + the iframe + the loading/error/ready
// phases. Does NOT own outer chrome (header, close button, sheet/window
// scaffolding) — callers wrap as appropriate.

import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import { ApiError, startTerminal, type TerminalAgentKind } from '../lib/api'
import { cn } from '../lib/utils'

export interface TerminalViewProps {
  runId: string
  projectName: string
  agent: TerminalAgentKind
  /** When true, the view occupies 100vw x 100svh (popup-window mode). */
  fullscreen?: boolean
  /** Callback fired once the start endpoint returns the sessionName. */
  onSessionReady?: (sessionName: string) => void
}

export function TerminalView({
  runId,
  projectName,
  agent,
  fullscreen,
  onSessionReady,
}: TerminalViewProps) {
  const [phase, setPhase] = useState<'starting' | 'ready' | 'error'>('starting')
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const sessionAnnouncedRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPhase('starting')
    setError(null)
    setIframeUrl(null)
    setWarnings([])
    void startTerminal({ runId, projectName, agent })
      .then((res) => {
        if (cancelled) return
        setIframeUrl(res.url)
        setWarnings(res.warnings ?? [])
        setPhase('ready')
        if (sessionAnnouncedRef.current !== res.sessionName) {
          sessionAnnouncedRef.current = res.sessionName
          onSessionReady?.(res.sessionName)
        }
      })
      .catch((err) => {
        if (cancelled) return
        const msg = err instanceof ApiError ? err.message : (err as Error).message
        setError(msg)
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [runId, projectName, agent, onSessionReady])

  return (
    <div
      className={cn(
        'relative bg-zinc-950',
        fullscreen ? 'h-svh w-svw' : 'h-full w-full',
      )}
    >
      {warnings.length > 0 && phase === 'ready' && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-1 bg-amber-50/95 p-2 text-[11px] text-amber-800 dark:bg-amber-950/80 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span className="font-mono">{warnings.join('; ')}</span>
        </div>
      )}
      {phase === 'starting' && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300">
          <Loader2 className="mr-2 size-4 animate-spin" />
          starting ttyd…
        </div>
      )}
      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-zinc-200">
          <AlertTriangle className="size-5 text-amber-400" />
          <div className="font-mono">{error}</div>
        </div>
      )}
      {phase === 'ready' && iframeUrl && (
        <iframe
          key={iframeUrl}
          src={iframeUrl}
          title={`${agent} terminal`}
          className="h-full w-full border-0"
        />
      )}
    </div>
  )
}
