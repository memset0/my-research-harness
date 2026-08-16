'use client'

import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

type EmbedPhase = 'checking' | 'loading' | 'ready' | 'error'
const EMBED_TIMEOUT_MS = 15_000
const DEFAULT_ZOOM_PERCENT = 100
const MIN_ZOOM_PERCENT = 50
const MAX_ZOOM_PERCENT = 200
const ZOOM_STEP_PERCENT = 10

interface ReportHtmlZoomValue {
  zoomPercent: number
  setZoomPercent: (zoomPercent: number) => void
}

const ReportHtmlZoomContext = createContext<ReportHtmlZoomValue | null>(null)

export function ReportHtmlZoomProvider({ children }: { children: ReactNode }) {
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_ZOOM_PERCENT)
  const value = useMemo(() => ({ zoomPercent, setZoomPercent }), [zoomPercent])
  return <ReportHtmlZoomContext.Provider value={value}>{children}</ReportHtmlZoomContext.Provider>
}

export interface ReportHtmlEmbedProps {
  src: string
  title: string
}

/**
 * A report-scoped HTML viewer with an observable loading lifecycle.
 *
 * Browsers fire an iframe `load` event for HTTP error documents too, so a
 * same-origin request is made before mounting the iframe. This preserves the
 * approved unsandboxed Report trust model while making 4xx/5xx asset failures
 * visible to the user instead of silently rendering a JSON error page.
 */
export function ReportHtmlEmbed({ src, title }: ReportHtmlEmbedProps) {
  const sharedZoom = useContext(ReportHtmlZoomContext)
  const [localZoomPercent, setLocalZoomPercent] = useState(DEFAULT_ZOOM_PERCENT)
  const zoomPercent = sharedZoom?.zoomPercent ?? localZoomPercent
  const setZoomPercent = sharedZoom?.setZoomPercent ?? setLocalZoomPercent
  const [attempt, setAttempt] = useState(0)
  const [iframeAttempt, setIframeAttempt] = useState(0)
  const [probedSrc, setProbedSrc] = useState<string | null>(null)
  const [phase, setPhase] = useState<EmbedPhase>('checking')
  const [error, setError] = useState<string | null>(null)
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, EMBED_TIMEOUT_MS)

    setPhase('checking')
    setError(null)
    setProbedSrc(null)

    void probeReportHtml(src, controller.signal)
      .then(() => {
        if (!cancelled) {
          // Tie the iframe navigation to the exact probe attempt that
          // succeeded. A retry therefore mounts a fresh browsing context even
          // though its canonical URL intentionally stays unchanged.
          setProbedSrc(src)
          setIframeAttempt(attempt)
          setPhase('loading')
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        if (timedOut) {
          setError('The embedded report did not respond within 15 seconds.')
        } else {
          const detail = cause instanceof Error ? cause.message : String(cause)
          setError(`Unable to load the embedded report: ${detail}`)
        }
        setPhase('error')
      })
      .finally(() => window.clearTimeout(timeout))

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [src, attempt])

  useEffect(() => {
    if (phase !== 'loading') return
    const iframe = iframeRef.current
    const onLoad = () => setPhase('ready')
    const onError = () => {
      setError('The embedded report document could not be loaded.')
      setPhase('error')
    }
    iframe?.addEventListener('load', onLoad)
    iframe?.addEventListener('error', onError)
    const timeout = window.setTimeout(() => {
      setError('The embedded report document did not finish loading within 15 seconds.')
      setPhase('error')
    }, EMBED_TIMEOUT_MS)
    return () => {
      window.clearTimeout(timeout)
      iframe?.removeEventListener('load', onLoad)
      iframe?.removeEventListener('error', onError)
    }
  }, [phase])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  const retry = () => {
    setError(null)
    setPhase('checking')
    setAttempt((value) => value + 1)
  }

  const toggleFullscreen = async () => {
    setFullscreenNotice(null)
    const container = containerRef.current
    try {
      if (document.fullscreenElement === container && document.exitFullscreen) {
        await document.exitFullscreen()
        return
      }
      if (container?.requestFullscreen) {
        await container.requestFullscreen()
        return
      }
      setFullscreenNotice('Fullscreen is unavailable in this browser. Use Open in new tab instead.')
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause)
      setFullscreenNotice(`Could not enter fullscreen: ${detail}`)
    }
  }

  const changeZoom = (delta: number) => {
    setZoomPercent(Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, zoomPercent + delta)))
  }

  const iframeScale = zoomPercent / 100

  const statusLabel =
    phase === 'checking'
      ? 'Checking report'
      : phase === 'loading'
        ? 'Loading report'
        : phase === 'ready'
          ? 'Report ready'
          : 'Report failed to load'

  return (
    <section
      ref={containerRef}
      data-report-html-wrapper
      aria-labelledby={titleId}
      className={cn(
        'not-prose my-4 min-w-0 overflow-hidden rounded-md border bg-background text-foreground',
        isFullscreen &&
          'flex h-[100svh] w-screen flex-col rounded-none border-0 supports-[height:100dvh]:h-[100dvh]',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
        <div id={titleId} className="min-w-0 flex-1 truncate text-xs font-medium">
          {title}
        </div>
        <span className="text-[0.6875rem] text-muted-foreground" role="status" aria-live="polite">
          {statusLabel}
        </span>
        <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
          <div
            className="flex items-center rounded-md border bg-background/70"
            role="group"
            aria-label="Embedded report zoom controls"
          >
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={zoomPercent <= MIN_ZOOM_PERCENT}
              aria-label="Zoom out embedded reports"
              onClick={() => changeZoom(-ZOOM_STEP_PERCENT)}
            >
              <ZoomOut aria-hidden />
            </Button>
            <output
              className="min-w-12 px-1 text-center font-mono text-[0.6875rem] tabular-nums text-muted-foreground"
              aria-label="Embedded report zoom"
            >
              {zoomPercent}%
            </output>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={zoomPercent >= MAX_ZOOM_PERCENT}
              aria-label="Zoom in embedded reports"
              onClick={() => changeZoom(ZOOM_STEP_PERCENT)}
            >
              <ZoomIn aria-hidden />
            </Button>
          </div>
          <Button asChild size="sm" variant="ghost">
            <a href={src} target="_blank" rel="noreferrer noopener">
              <ExternalLink aria-hidden />
              Open in new tab
            </a>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      {fullscreenNotice && (
        <div className="border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="status">
          {fullscreenNotice}
        </div>
      )}

      <div
        className={cn(
          'relative w-full overflow-hidden bg-background',
          isFullscreen
            ? 'min-h-0 flex-1'
            : [
                'h-[65svh] max-h-[42rem]',
                'supports-[height:100dvh]:h-[65dvh]',
                'md:h-[70vh] md:max-h-[52rem]',
              ],
        )}
        aria-busy={phase === 'checking' || phase === 'loading'}
      >
        {(phase === 'checking' || phase === 'loading') && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/90">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {phase === 'checking' ? 'Checking embedded report…' : 'Loading embedded report…'}
            </div>
          </div>
        )}

        {probedSrc === src && (phase === 'loading' || phase === 'ready') && (
          <iframe
            key={`${src}:${iframeAttempt}`}
            ref={iframeRef}
            src={src}
            title={title}
            className="border-0 bg-background"
            style={{
              width: `${100 / iframeScale}%`,
              height: `${100 / iframeScale}%`,
              transform: `scale(${iframeScale})`,
              transformOrigin: 'top left',
            }}
            loading="lazy"
            allowFullScreen
            data-report-html
            data-zoom-percent={zoomPercent}
            // React's delegated load listener closes the tiny window before
            // the phase effect attaches its native listener; the native pair
            // remains necessary for reliable iframe error events in browsers
            // and jsdom. Both handlers are idempotent.
            onLoad={() => setPhase('ready')}
            onError={() => {
              setError('The embedded report document could not be loaded.')
              setPhase('error')
            }}
          />
        )}

        {phase === 'error' && (
          <div className="flex size-full items-center justify-center p-6" role="alert">
            <div className="max-w-lg text-center">
              <AlertTriangle className="mx-auto mb-3 size-6 text-destructive" aria-hidden />
              <p className="text-sm font-medium">Embedded report unavailable</p>
              <p className="mt-1 break-words text-xs text-muted-foreground">{error}</p>
              <Button type="button" className="mt-4" size="sm" variant="outline" onClick={retry}>
                <RotateCw aria-hidden />
                Retry
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

async function probeReportHtml(src: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(src, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'text/html,application/xhtml+xml' },
    signal,
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    const suffix = response.statusText ? ` ${response.statusText}` : ''
    throw new Error(`HTTP ${response.status}${suffix}`)
  }

  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`expected HTML but received ${contentType || 'an unknown content type'}`)
  }

  // The probe only needs status and headers. Do not retain/download a second
  // copy of a potentially large document before the iframe navigates to it.
  await response.body?.cancel().catch(() => undefined)
}
