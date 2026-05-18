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
import { isManageTmuxNavShortcut } from '../app/manage/tmux/keyboard-nav'
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

  // When embedded in /manage/tmux (source === 'manage'), forward the
  // page-level `Ctrl+Shift+ArrowUp/Down` shortcut from the iframe up to
  // the parent window. The iframe URL is /api/terminal/proxy/... which
  // shares origin with the parent app, so we can attach a capture-phase
  // keydown directly on the iframe's contentDocument and contentWindow.
  // xterm.js's handlers are inside the iframe (target phase on the
  // helper textarea) — window/document capture runs first, so
  // preventDefault + stopPropagation here keeps the key out of the
  // terminal entirely. We then re-dispatch a synthesized KeyboardEvent
  // on the parent `window`, which the page-level handler catches and
  // turns into a row navigation.
  //
  // Critical race condition: when an iframe is inserted into the DOM
  // with `src` set, the browser exposes an initial `about:blank`
  // document synchronously (readyState `'complete'`, URL `about:blank`)
  // BEFORE the real navigation completes. A listener attached to that
  // placeholder gets orphaned the moment the real document replaces
  // it, with no error and no console warning — the iframe simply
  // stops receiving our shortcut. We guard against this by rejecting
  // any `contentDocument` whose `URL === 'about:blank'` and re-trying
  // on every iframe `load` event.
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    if (source !== 'manage') return
    if (phase !== 'ready') return
    const iframe = iframeRef.current
    if (!iframe) return

    let cleanup: (() => void) | null = null

    const tryAttach = (): boolean => {
      try {
        const doc = iframe.contentDocument
        const win = iframe.contentWindow
        if (!doc || !win) return false
        // Reject the placeholder about:blank document.
        if (doc.URL === 'about:blank') return false
        if (doc.readyState === 'loading') return false

        // Drop any stale attachment (e.g. iframe was re-loaded inside
        // the same React-mount and a previous listener targeted the
        // now-replaced document).
        cleanup?.()
        cleanup = null

        const listener = (event: KeyboardEvent) => {
          if (!isManageTmuxNavShortcut(event)) return
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          window.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: event.key,
              code: event.code,
              ctrlKey: true,
              shiftKey: true,
              altKey: false,
              metaKey: false,
              bubbles: true,
              cancelable: true,
            }),
          )
        }

        // Attach on BOTH the iframe's window AND document at capture
        // phase. Capture order is window → document → ... → target, so
        // window-capture fires first and document-capture is a backup
        // if window somehow misses. Capture beats every listener inside
        // the iframe (xterm.js's keydown is on the helper textarea,
        // which is the target phase).
        win.addEventListener('keydown', listener, { capture: true })
        doc.addEventListener('keydown', listener, { capture: true })

        cleanup = () => {
          try {
            win.removeEventListener('keydown', listener, { capture: true })
          } catch {
            // window may already be torn down — ignore
          }
          try {
            doc.removeEventListener('keydown', listener, { capture: true })
          } catch {
            // document may already be replaced — ignore
          }
        }
        return true
      } catch {
        // Cross-origin (shouldn't happen for the same-origin proxy URL,
        // but fail closed so a future config change doesn't crash here)
        return false
      }
    }

    // Always wire `load` — fires when the iframe's src finishes
    // navigating, which is the moment our `tryAttach` can see the
    // real ttyd document instead of `about:blank`. If the iframe
    // re-loads (rare), `load` fires again and `tryAttach` re-attaches
    // against the fresh document; `cleanup` is bumped on each
    // successful attach so listeners don't stack.
    const onLoad = () => {
      tryAttach()
    }
    iframe.addEventListener('load', onLoad)

    // Best-effort eager attach for the edge case where the iframe
    // already loaded by the time this effect runs (we'd miss the
    // `load` event entirely). The `about:blank` rejection inside
    // `tryAttach` makes this safe — if the navigation is still in
    // flight, we return false and the `load` handler picks it up.
    tryAttach()

    return () => {
      iframe.removeEventListener('load', onLoad)
      cleanup?.()
    }
  }, [phase, source, iframeUrl])

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
          ref={iframeRef}
          src={iframeUrl}
          title={iframeTitle}
          className="h-full w-full border-0"
        />
      )}
    </div>
  )
}
