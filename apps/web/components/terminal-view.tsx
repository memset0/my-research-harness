'use client'

// Shared terminal-iframe view used by both the side drawer
// (terminal-drawer-provider.tsx) and the popup-window route
// (app/terminal-popup/page.tsx). Owns the start-session lifecycle + the
// iframe + the loading/error/ready phases. Does NOT own outer chrome
// (header, close button, sheet/window scaffolding) — callers wrap as
// appropriate.
//
// Two modes, discriminated by the `mode` prop:
//   - 'standard': calls POST /api/terminal/start with parsed
//     (project, scope, slug, agent). Used for run/exp page action bar.
//   - 'raw': calls POST /api/terminal/attach with just sessionName. Used
//     for /manage/tmux's manual rows (legacy or arbitrary memon-* names).

import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import {
  ApiError,
  attachTerminal,
  startTerminal,
  type TerminalAgentKind,
  type TerminalScopeKind,
} from '../lib/api'
import { cn } from '../lib/utils'

export type TerminalViewSource = 'manage' | 'drawer' | 'popup' | 'unknown'

export type TerminalViewProps = (
  | {
      mode: 'standard'
      project: string
      scope: TerminalScopeKind
      slug: string
      agent: TerminalAgentKind
    }
  | {
      mode: 'raw'
      sessionName: string
    }
) & {
  /** When true, the view occupies 100vw x 100svh (popup-window mode). */
  fullscreen?: boolean
  /** Callback fired once the start/attach endpoint returns the sessionName. */
  onSessionReady?: (sessionName: string) => void
  /**
   * Surface attribution for the cross-page `memon:terminal-attached`
   * BroadcastChannel post. Cache holders elsewhere (e.g. /manage/tmux)
   * use the broadcast to release backgrounded entries when the same
   * session opens here. Default `'unknown'` keeps test/storybook
   * mounts inert.
   */
  source?: TerminalViewSource
}

const ATTACH_BROADCAST_CHANNEL = 'memon:terminal-attached'

export function postTerminalAttached(
  sessionName: string,
  source: TerminalViewSource,
): void {
  if (typeof BroadcastChannel === 'undefined') return
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(ATTACH_BROADCAST_CHANNEL)
    channel.postMessage({ sessionName, source, attachedAt: Date.now() })
  } finally {
    channel?.close()
  }
}

export function TerminalView(props: TerminalViewProps) {
  const { mode, fullscreen, onSessionReady, source } = props
  const [phase, setPhase] = useState<'starting' | 'ready' | 'error'>('starting')
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const sessionAnnouncedRef = useRef<string | null>(null)
  // Read source via a ref inside the start/attach effect so a parent
  // changing the source tag does NOT trigger a fresh start/attach
  // cycle. Source is purely a broadcast tag; it's read at the moment
  // the broadcast fires.
  const sourceRef = useRef<TerminalViewSource>(source ?? 'unknown')
  useEffect(() => {
    sourceRef.current = source ?? 'unknown'
  }, [source])

  // Effect deps: pull individual fields out so changing one re-fires.
  // Discriminated-union access: we read `mode` plus mode-specific fields.
  // The eslint-react-hooks rule isn't sophisticated enough to prove our
  // disjoint effect deps are exhaustive without listing all of them.
  const standardProject = mode === 'standard' ? props.project : undefined
  const standardScope = mode === 'standard' ? props.scope : undefined
  const standardSlug = mode === 'standard' ? props.slug : undefined
  const standardAgent = mode === 'standard' ? props.agent : undefined
  const rawSessionName = mode === 'raw' ? props.sessionName : undefined

  useEffect(() => {
    let cancelled = false
    setPhase('starting')
    setError(null)
    setIframeUrl(null)
    setWarnings([])
    const promise =
      mode === 'standard'
        ? startTerminal({
            project: standardProject!,
            scope: standardScope!,
            slug: standardSlug!,
            agent: standardAgent,
          })
        : attachTerminal({ sessionName: rawSessionName! })
    void promise
      .then((res) => {
        if (cancelled) return
        setIframeUrl(res.url)
        setWarnings(res.warnings ?? [])
        setPhase('ready')
        if (sessionAnnouncedRef.current !== res.sessionName) {
          sessionAnnouncedRef.current = res.sessionName
          onSessionReady?.(res.sessionName)
        }
        postTerminalAttached(res.sessionName, sourceRef.current)
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
  }, [
    mode,
    standardProject,
    standardScope,
    standardSlug,
    standardAgent,
    rawSessionName,
    onSessionReady,
  ])

  const iframeTitle =
    mode === 'standard' ? `${standardAgent} terminal` : `${rawSessionName} terminal`

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
          title={iframeTitle}
          className="h-full w-full border-0"
        />
      )}
    </div>
  )
}
