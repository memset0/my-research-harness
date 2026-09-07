'use client'

import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  MoreVertical,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

type EmbedPhase = 'checking' | 'loading' | 'ready' | 'error'
const EMBED_TIMEOUT_MS = 15_000
const DEFAULT_ZOOM_PERCENT = 100
const MIN_ZOOM_PERCENT = 50
const MAX_ZOOM_PERCENT = 200
const ZOOM_STEP_PERCENT = 10
export const REPORT_HTML_CHANGE_POLL_MS = 60_000
const AUTO_HEIGHT_PADDING_PX = 16
const AUTO_HEIGHT_FALLBACK_PX = 320
const MAX_AUTO_HEIGHT_PX = 4000

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
  /** Same-origin document URL. Mutually exclusive with `srcDoc`. */
  src?: string
  /**
   * Inline document rendered through `srcdoc`. Used by the `html-embed`
   * wiki component, whose payload IS the document, so there is nothing to
   * probe over HTTP. Mutually exclusive with `src`.
   */
  srcDoc?: string
  title: string
  /**
   * Fixed pixel height, or `auto` to size the frame to its content. Omitted
   * keeps the responsive viewport-relative height used by Report embeds.
   */
  height?: number | 'auto'
}

/**
 * A report-scoped HTML viewer with an observable loading lifecycle.
 *
 * Browsers fire an iframe `load` event for HTTP error documents too, so a
 * same-origin request is made before mounting the iframe. This preserves the
 * approved unsandboxed Report trust model while making 4xx/5xx asset failures
 * visible to the user instead of silently rendering a JSON error page.
 */
export function ReportHtmlEmbed({ src, srcDoc, title, height }: ReportHtmlEmbedProps) {
  const inline = typeof srcDoc === 'string'
  const documentId = inline ? 'srcdoc' : (src ?? '')
  const sharedZoom = useContext(ReportHtmlZoomContext)
  const [localZoomPercent, setLocalZoomPercent] = useState(DEFAULT_ZOOM_PERCENT)
  const zoomPercent = sharedZoom?.zoomPercent ?? localZoomPercent
  const setZoomPercent = sharedZoom?.setZoomPercent ?? setLocalZoomPercent
  const [attempt, setAttempt] = useState(0)
  const [iframeAttempt, setIframeAttempt] = useState(0)
  const [probedSrc, setProbedSrc] = useState<string | null>(null)
  const [phase, setPhase] = useState<EmbedPhase>('checking')
  const [error, setError] = useState<string | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [autoHeightPx, setAutoHeightPx] = useState<number | null>(null)
  const [hasApproachedViewport, setHasApproachedViewport] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  const [isEmbedVisible, setIsEmbedVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  const containerRef = useRef<HTMLElement | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const loadedRevisionRef = useRef<string | null>(null)
  const titleId = useId()

  useEffect(() => {
    if (inline) {
      // An inline document is already in hand: mount it immediately and skip
      // the probe/revision machinery, which exists for HTTP-served assets.
      setError(null)
      setProbedSrc(documentId)
      setIframeAttempt(attempt)
      loadedRevisionRef.current = null
      setUpdateAvailable(false)
      setPhase('loading')
      return
    }
    if (!src) {
      setError('No document was supplied for this embed.')
      setPhase('error')
      return
    }
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
    loadedRevisionRef.current = null

    void probeReportHtml(src, controller.signal)
      .then(({ revision }) => {
        if (!cancelled) {
          // Tie the iframe navigation to the exact probe attempt that
          // succeeded. A retry therefore mounts a fresh browsing context even
          // though its canonical URL intentionally stays unchanged.
          setProbedSrc(src)
          setIframeAttempt(attempt)
          loadedRevisionRef.current = revision
          setUpdateAvailable(false)
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
  }, [src, srcDoc, inline, documentId, attempt])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') {
      setHasApproachedViewport(true)
      setIsEmbedVisible(true)
      return
    }
    setHasApproachedViewport(false)
    setIsEmbedVisible(false)
    const proximityObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setHasApproachedViewport(true)
        proximityObserver.disconnect()
      },
      { rootMargin: '400px 0px' },
    )
    const visibilityObserver = new IntersectionObserver((entries) => {
      const current = entries.find((entry) => entry.target === container) ?? entries[0]
      setIsEmbedVisible(current?.isIntersecting ?? false)
    })
    proximityObserver.observe(container)
    visibilityObserver.observe(container)
    return () => {
      proximityObserver.disconnect()
      visibilityObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (phase !== 'loading' || !hasApproachedViewport) return
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
  }, [hasApproachedViewport, phase])

  useEffect(() => {
    if (inline || !src || phase !== 'ready' || updateAvailable || !isEmbedVisible) return
    let checking = false
    const controller = new AbortController()
    const checkForUpdate = async () => {
      if (checking || document.visibilityState !== 'visible') return
      checking = true
      try {
        const response = await fetch(src, {
          method: 'HEAD',
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const revision = reportResourceRevision(response)
        if (!revision) return
        if (loadedRevisionRef.current && revision !== loadedRevisionRef.current) {
          setUpdateAvailable(true)
        } else if (!loadedRevisionRef.current) {
          loadedRevisionRef.current = revision
        }
      } catch {
        // Revision polling is advisory. Network/auth transitions keep the
        // current iframe usable and the next interval can try again.
      } finally {
        checking = false
      }
    }
    const interval = window.setInterval(() => void checkForUpdate(), REPORT_HTML_CHANGE_POLL_MS)
    return () => {
      window.clearInterval(interval)
      controller.abort()
    }
  }, [inline, isEmbedVisible, phase, src, updateAvailable])

  useEffect(() => {
    if (!isExpanded) return
    const body = document.body
    const previousBodyOverflow = body.style.overflow
    const sheetContent = containerRef.current?.closest<HTMLElement>('[data-slot="sheet-content"]')
    const previousSheetTransform = sheetContent?.style.getPropertyValue('transform') ?? ''
    const previousSheetTransformPriority =
      sheetContent?.style.getPropertyPriority('transform') ?? ''
    body.style.overflow = 'hidden'
    sheetContent?.style.setProperty('transform', 'none', 'important')

    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setIsExpanded(false)
    }
    window.addEventListener('keydown', exitOnEscape, true)
    return () => {
      body.style.overflow = previousBodyOverflow
      if (sheetContent) {
        if (previousSheetTransform) {
          sheetContent.style.setProperty(
            'transform',
            previousSheetTransform,
            previousSheetTransformPriority,
          )
        } else {
          sheetContent.style.removeProperty('transform')
        }
      }
      window.removeEventListener('keydown', exitOnEscape, true)
    }
  }, [isExpanded])

  // `height="auto"` sizes the frame to its document. The document is
  // same-origin (a Report asset or an inline `srcdoc`), so it can be measured
  // directly; scripted content that draws after load is picked up by the
  // ResizeObserver on its body.
  useEffect(() => {
    if (height !== 'auto' || phase !== 'ready') return
    let frameDocument: Document | null = null
    try {
      frameDocument = iframeRef.current?.contentDocument ?? null
    } catch {
      return
    }
    const measured = frameDocument
    if (!measured) return
    const measure = () => {
      const next = Math.max(
        measured.documentElement?.scrollHeight ?? 0,
        measured.body?.scrollHeight ?? 0,
      )
      if (next > 0) setAutoHeightPx(Math.min(next + AUTO_HEIGHT_PADDING_PX, MAX_AUTO_HEIGHT_PX))
    }
    measure()
    if (typeof ResizeObserver === 'undefined' || !measured.body) return
    const observer = new ResizeObserver(measure)
    observer.observe(measured.body)
    return () => observer.disconnect()
  }, [height, phase, iframeAttempt])

  const retry = () => {
    setError(null)
    setPhase('checking')
    setAttempt((value) => value + 1)
  }

  const changeZoom = (delta: number) => {
    setZoomPercent(Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, zoomPercent + delta)))
  }

  const iframeScale = zoomPercent / 100

  const fixedHeightPx =
    typeof height === 'number'
      ? height
      : height === 'auto'
        ? (autoHeightPx ?? AUTO_HEIGHT_FALLBACK_PX)
        : null

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
      data-expanded={isExpanded ? 'true' : 'false'}
      aria-labelledby={titleId}
      className={cn(
        'not-prose my-4 min-w-0 overflow-hidden rounded-md border bg-background text-foreground',
        isExpanded &&
          'fixed inset-0 z-[100] m-0 flex h-[100svh] w-screen flex-col rounded-none border-0 shadow-2xl supports-[height:100dvh]:h-[100dvh]',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
        <div id={titleId} className="min-w-0 flex-1 truncate text-xs font-medium">
          {title}
        </div>
        <span
          className="hidden text-[0.6875rem] text-muted-foreground sm:inline-flex"
          role="status"
          aria-live="polite"
        >
          {statusLabel}
        </span>
        <MobileActionsMenu
          src={src}
          zoomPercent={zoomPercent}
          updateAvailable={updateAvailable}
          isExpanded={isExpanded}
          onZoom={changeZoom}
          onReload={retry}
          onToggleExpanded={() => setIsExpanded((value) => !value)}
        />
        <div className="hidden shrink-0 items-center justify-end gap-1 sm:flex">
          <fieldset
            className="flex min-w-0 items-center rounded-md border bg-background/70"
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
          </fieldset>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="relative"
            aria-label={
              updateAvailable
                ? 'Reload embedded report, updated content available'
                : 'Reload embedded report'
            }
            onClick={retry}
          >
            <RotateCw aria-hidden />
            Reload
            {updateAvailable && <UpdateAvailableDot />}
          </Button>
          {src && (
            <Button asChild size="sm" variant="ghost">
              <a href={src} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden />
                Open in new tab
              </a>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setIsExpanded((value) => !value)}
          >
            {isExpanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            {isExpanded ? 'Exit expanded view' : 'Expand'}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'relative w-full overflow-hidden bg-background',
          isExpanded
            ? 'min-h-0 flex-1'
            : fixedHeightPx === null && [
                'h-[65svh] max-h-[42rem]',
                'supports-[height:100dvh]:h-[65dvh]',
                'md:h-[70vh] md:max-h-[52rem]',
              ],
        )}
        style={
          !isExpanded && fixedHeightPx !== null ? { height: `${fixedHeightPx}px` } : undefined
        }
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

        {probedSrc === documentId && (phase === 'loading' || phase === 'ready') && (
          <iframe
            key={`${documentId}:${iframeAttempt}`}
            ref={iframeRef}
            src={inline ? undefined : src}
            srcDoc={srcDoc}
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

function MobileActionsMenu({
  src,
  zoomPercent,
  updateAvailable,
  isExpanded,
  onZoom,
  onReload,
  onToggleExpanded,
}: {
  src?: string
  zoomPercent: number
  updateAvailable: boolean
  isExpanded: boolean
  onZoom: (delta: number) => void
  onReload: () => void
  onToggleExpanded: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="relative sm:hidden"
          aria-label="Embedded report actions"
        >
          <MoreVertical aria-hidden />
          {updateAvailable && <UpdateAvailableDot />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[120] w-56 sm:hidden">
        <DropdownMenuLabel>Zoom</DropdownMenuLabel>
        <fieldset
          className="mx-1 mb-1 flex min-w-0 items-center rounded-md border bg-background/70"
          aria-label="Mobile embedded report zoom controls"
        >
          <DropdownMenuItem
            className="size-7 min-h-0 justify-center p-0"
            disabled={zoomPercent <= MIN_ZOOM_PERCENT}
            aria-label="Zoom out embedded reports"
            onSelect={(event) => {
              event.preventDefault()
              onZoom(-ZOOM_STEP_PERCENT)
            }}
          >
            <ZoomOut aria-hidden />
          </DropdownMenuItem>
          <output
            className="min-w-14 flex-1 text-center font-mono text-[0.6875rem] tabular-nums text-muted-foreground"
            aria-label="Mobile embedded report zoom"
          >
            {zoomPercent}%
          </output>
          <DropdownMenuItem
            className="size-7 min-h-0 justify-center p-0"
            disabled={zoomPercent >= MAX_ZOOM_PERCENT}
            aria-label="Zoom in embedded reports"
            onSelect={(event) => {
              event.preventDefault()
              onZoom(ZOOM_STEP_PERCENT)
            }}
          >
            <ZoomIn aria-hidden />
          </DropdownMenuItem>
        </fieldset>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReload}>
          <RotateCw aria-hidden />
          Reload
          {updateAvailable && (
            <span className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              Updated
            </span>
          )}
        </DropdownMenuItem>
        {src && (
          <DropdownMenuItem asChild>
            <a href={src} target="_blank" rel="noreferrer noopener">
              <ExternalLink aria-hidden />
              Open in new tab
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onToggleExpanded}>
          {isExpanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          {isExpanded ? 'Exit expanded view' : 'Expand'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UpdateAvailableDot() {
  return (
    <>
      <span
        className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background"
        aria-hidden
      />
      <span className="sr-only">Updated content available</span>
    </>
  )
}

async function probeReportHtml(
  src: string,
  signal: AbortSignal,
): Promise<{ revision: string | null }> {
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
  return { revision: reportResourceRevision(response) }
}

function reportResourceRevision(response: Response): string | null {
  return (
    response.headers.get('x-memon-resource-version') ??
    response.headers.get('etag') ??
    response.headers.get('last-modified')
  )
}
