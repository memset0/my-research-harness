'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import {
  ApiError,
  startTerminal,
  stopTerminal,
  type TerminalAgentKind,
  type TerminalScopeKind,
} from '../lib/api'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from './ui/sheet'

// Props: TerminalSheet accepts EITHER the legacy `{ runId, projectName }`
// pair (used by `experiment-detail.tsx` via `TerminalButton`, defaults to
// `agent: 'claude'`, `scope: 'run'`) OR the explicit
// `{ project, scope, slug, agent }` quartet used by the sidebar's per-row
// shell launcher (passes `agent: 'none'`, `scope: 'exp'`). The legacy
// shape is preserved verbatim so existing callsites are unaffected.
interface CommonProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface LegacyProps extends CommonProps {
  runId: string
  projectName: string
  project?: undefined
  scope?: undefined
  slug?: undefined
  agent?: undefined
}

interface ExplicitProps extends CommonProps {
  project: string
  scope: TerminalScopeKind
  slug: string
  agent: TerminalAgentKind
  runId?: undefined
  projectName?: undefined
}

export type TerminalSheetProps = LegacyProps | ExplicitProps

export function TerminalSheet(props: TerminalSheetProps) {
  // Normalize the two prop shapes into the explicit quartet, defaulting the
  // legacy form to `agent: 'claude'` and `scope: 'run'` — i.e. unchanged
  // behavior for `experiment-detail.tsx`'s usage.
  const project = props.project ?? props.projectName ?? ''
  const scope: TerminalScopeKind = props.scope ?? 'run'
  const slug = props.slug ?? props.runId ?? ''
  const agent: TerminalAgentKind = props.agent ?? 'claude'
  const { open, onOpenChange } = props

  const [phase, setPhase] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const lastSessionRef = useRef<string | null>(null)

  // Start the ttyd session whenever the sheet opens (and tear down when closed).
  useEffect(() => {
    if (!open) {
      // Sheet closed — fire-and-forget stop. Don't block the unmount.
      const sn = lastSessionRef.current
      if (sn) {
        void stopTerminal(sn).catch(() => {})
        lastSessionRef.current = null
      }
      // Reset local state so re-opening starts fresh
      setPhase('idle')
      setIframeUrl(null)
      setSessionName(null)
      setError(null)
      setWarnings([])
      return
    }

    let cancelled = false
    setPhase('starting')
    setError(null)
    void startTerminal({ project, scope, slug, agent })
      .then((res) => {
        if (cancelled) {
          // Closed before we got a response; ensure we still tear it down
          void stopTerminal(res.sessionName).catch(() => {})
          return
        }
        setIframeUrl(res.url)
        setSessionName(res.sessionName)
        setWarnings(res.warnings ?? [])
        lastSessionRef.current = res.sessionName
        setPhase('ready')
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
  }, [open, project, scope, slug, agent])

  // Sheet header label: legacy `claude · memon-claude-<slug>` for the
  // claude-agent shape (to keep the existing copy unchanged), or
  // `<agent> · <session>` for the explicit-props shape. Both forms render
  // the session name once it's known; before that, fall back to a
  // synthesized placeholder.
  const fallbackSessionName = `memon-${agent}-${slug}`

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[min(95vw,960px)] flex-col gap-2 p-0 sm:max-w-[960px]"
      >
        <SheetHeader className="border-b p-3 pb-2">
          <SheetTitle className="font-mono text-xs">
            {agent} · {sessionName ?? fallbackSessionName}
          </SheetTitle>
          <SheetDescription className="text-[11px]">
            Terminal runs inside tmux. Closing this panel leaves the session
            detached — re-attach with{' '}
            <code className="font-mono">
              tmux attach -t {sessionName ?? fallbackSessionName}
            </code>
            .
          </SheetDescription>
          {warnings.length > 0 && (
            <div className="mt-2 flex items-start gap-1 rounded-sm bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span className="font-mono">{warnings.join('; ')}</span>
            </div>
          )}
        </SheetHeader>

        <div className="relative flex-1 overflow-hidden bg-zinc-950">
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
      </SheetContent>
    </Sheet>
  )
}
