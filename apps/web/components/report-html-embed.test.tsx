import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REPORT_HTML_CHANGE_POLL_MS,
  ReportHtmlEmbed,
  ReportHtmlZoomProvider,
} from './report-html-embed'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function response(status = 200, statusText = 'OK', revision?: string): Response {
  return new Response(null, {
    status,
    statusText,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(revision ? { 'x-memon-resource-version': revision } : {}),
    },
  })
}

interface IntersectionObserverHarnessEntry {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
  disconnect: ReturnType<typeof vi.fn>
}

function installIntersectionObserverHarness(): IntersectionObserverHarnessEntry[] {
  const observers: IntersectionObserverHarnessEntry[] = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds: readonly number[]
      readonly observe = vi.fn()
      readonly disconnect = vi.fn()
      readonly unobserve = vi.fn()
      readonly takeRecords = () => [] as IntersectionObserverEntry[]

      constructor(
        readonly callback: IntersectionObserverCallback,
        readonly options?: IntersectionObserverInit,
      ) {
        this.root = options?.root ?? null
        this.rootMargin = options?.rootMargin ?? '0px'
        this.thresholds = Array.isArray(options?.threshold)
          ? options.threshold
          : [options?.threshold ?? 0]
        observers.push(this)
      }
    },
  )
  return observers
}

describe('<ReportHtmlEmbed>', () => {
  it('preflights and renders an accessible, responsive, unsandboxed lazy iframe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(
      <ReportHtmlEmbed
        src="/api/report-assets/research/R0002/chart.html"
        title="Training curves"
      />,
    )

    expect(screen.getByText('Checking report')).toHaveAttribute('role', 'status')
    const iframe = await screen.findByTitle('Training curves')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/report-assets/research/R0002/chart.html',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    )
    expect(iframe).toHaveAttribute('loading', 'lazy')
    expect(iframe).toHaveAttribute('allowfullscreen')
    expect(iframe).not.toHaveAttribute('sandbox')
    expect(iframe).toHaveAttribute('data-report-html')
    expect(iframe).toHaveAttribute('data-zoom-percent', '100')
    expect(iframe).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })
    expect(screen.getByRole('status', { name: 'Embedded report zoom' })).toHaveTextContent('100%')

    const viewport = container.querySelector('[aria-busy]')
    expect(viewport?.className).toContain('h-[65svh]')
    expect(viewport?.className).toContain('supports-[height:100dvh]:h-[65dvh]')
    expect(viewport?.className).toContain('md:h-[70vh]')
    expect(viewport?.className).not.toContain('min-h-')

    const actions = screen.getByRole('link', { name: /open in new tab/i }).parentElement
    expect(actions).toHaveClass('hidden', 'sm:flex')
    const zoomOut = screen.getByRole('button', { name: 'Zoom out embedded reports' })
    const zoomIn = screen.getByRole('button', { name: 'Zoom in embedded reports' })
    const openInNewTab = screen.getByRole('link', { name: /open in new tab/i })
    const reload = screen.getByRole('button', { name: 'Reload embedded report' })
    const expand = screen.getByRole('button', { name: 'Expand' })
    expect(zoomOut).toHaveAttribute('data-size', 'icon-sm')
    expect(zoomIn).toHaveAttribute('data-size', 'icon-sm')
    expect(openInNewTab).toHaveAttribute('data-size', 'sm')
    expect(reload).toHaveAttribute('data-size', 'sm')
    expect(expand).toHaveAttribute('data-size', 'sm')
    const compactToolbarControls = [zoomOut, zoomIn, openInNewTab, reload, expand]
    for (const control of compactToolbarControls) {
      expect(control.className).not.toContain('min-h-11')
    }
    expect(screen.getByRole('button', { name: 'Embedded report actions' })).toHaveClass('sm:hidden')
    expect(screen.getByText('Training curves').parentElement?.className).not.toContain('flex-wrap')
    expect(container.querySelector('[data-report-html-wrapper]')).toHaveAttribute(
      'aria-labelledby',
      screen.getByText('Training curves').id,
    )

    fireEvent.load(iframe)
    expect(screen.getByText('Report ready')).toHaveAttribute('role', 'status')
    expect(viewport).toHaveAttribute('aria-busy', 'false')
  })

  it('keeps the canonical new-tab action and opens an in-page expanded view', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const requestFullscreen = vi.fn()
    const { container } = render(
      <ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Result explorer" />,
    )
    const iframe = await screen.findByTitle('Result explorer')
    const wrapper = container.querySelector('[data-report-html-wrapper]') as HTMLElement
    Object.defineProperty(wrapper, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })

    const open = screen.getByRole('link', { name: /open in new tab/i })
    expect(open).toHaveAttribute('href', '/api/report-assets/p/R0001/view.html')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noreferrer noopener')

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(wrapper).toHaveAttribute('data-expanded', 'true')
    expect(wrapper).toHaveClass('fixed', 'inset-0', 'z-[100]')
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByTitle('Result explorer')).toBe(iframe)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(wrapper).toHaveAttribute('data-expanded', 'false'))
    expect(document.body.style.overflow).toBe('')
  })

  it('changes iframe zoom in ten-percent steps and clamps the supported range', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Zoomable" />)
    const iframe = await screen.findByTitle('Zoomable')
    const zoomIn = screen.getByRole('button', { name: 'Zoom in embedded reports' })
    const zoomOut = screen.getByRole('button', { name: 'Zoom out embedded reports' })
    const output = screen.getByRole('status', { name: 'Embedded report zoom' })

    fireEvent.click(zoomIn)
    expect(output).toHaveTextContent('110%')
    expect(iframe).toHaveAttribute('data-zoom-percent', '110')
    expect(iframe).toHaveStyle({ transform: 'scale(1.1)' })

    fireEvent.click(zoomOut)
    fireEvent.click(zoomOut)
    expect(output).toHaveTextContent('90%')
    expect(iframe).toHaveAttribute('data-zoom-percent', '90')

    for (let index = 0; index < 10; index += 1) fireEvent.click(zoomIn)
    expect(output).toHaveTextContent('190%')
    fireEvent.click(zoomIn)
    expect(output).toHaveTextContent('200%')
    expect(zoomIn).toBeDisabled()
  })

  it('shares one zoom percentage across all HTML embeds in a Report surface', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(
      <ReportHtmlZoomProvider>
        <ReportHtmlEmbed src="/api/report-assets/p/R0001/first.html" title="First embed" />
        <ReportHtmlEmbed src="/api/report-assets/p/R0001/second.html" title="Second embed" />
      </ReportHtmlZoomProvider>,
    )
    const first = await screen.findByTitle('First embed')
    const second = await screen.findByTitle('Second embed')

    fireEvent.click(screen.getAllByRole('button', { name: 'Zoom in embedded reports' })[0]!)

    expect(first).toHaveAttribute('data-zoom-percent', '110')
    expect(second).toHaveAttribute('data-zoom-percent', '110')
    for (const output of screen.getAllByRole('status', { name: 'Embedded report zoom' })) {
      expect(output).toHaveTextContent('110%')
    }
  })

  it('escapes a transformed Report drawer while expanded and restores its style', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const { container } = render(
      <div data-slot="sheet-content" style={{ transform: 'translateX(0)' }}>
        <ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Drawer explorer" />
      </div>,
    )
    await screen.findByTitle('Drawer explorer')
    const wrapper = container.querySelector('[data-report-html-wrapper]') as HTMLElement
    const sheet = container.querySelector('[data-slot="sheet-content"]') as HTMLElement

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(wrapper).toHaveAttribute('data-expanded', 'true')
    expect(sheet.style.getPropertyValue('transform')).toBe('none')
    expect(sheet.style.getPropertyPriority('transform')).toBe('important')

    fireEvent.click(screen.getByRole('button', { name: 'Exit expanded view' }))
    expect(wrapper).toHaveAttribute('data-expanded', 'false')
    expect(sheet.style.transform).toBe('translateX(0)')
  })

  it('exposes every mobile action behind one compact overflow trigger', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Mobile explorer" />)
    await screen.findByTitle('Mobile explorer')

    const trigger = screen.getByRole('button', { name: 'Embedded report actions' })
    expect(trigger).toHaveClass('sm:hidden')
    expect(screen.getByRole('link', { name: /open in new tab/i }).parentElement).toHaveClass(
      'hidden',
      'sm:flex',
    )

    await userEvent.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /zoom out/i })).toBeInTheDocument()
    const zoomIn = within(menu).getByRole('menuitem', { name: /zoom in/i })
    expect(zoomIn).toBeInTheDocument()
    expect(
      within(menu).getByRole('status', { name: 'Mobile embedded report zoom' }),
    ).toHaveTextContent('100%')
    await userEvent.click(zoomIn)
    await userEvent.click(zoomIn)
    expect(screen.getByRole('menu')).toBe(menu)
    expect(
      within(menu).getByRole('status', { name: 'Mobile embedded report zoom' }),
    ).toHaveTextContent('120%')
    expect(within(menu).getByRole('menuitem', { name: /^reload$/i })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /open in new tab/i })).toHaveAttribute(
      'href',
      '/api/report-assets/p/R0001/view.html',
    )
    expect(within(menu).getByRole('menuitem', { name: /^expand$/i })).toBeInTheDocument()
  })

  it('marks a changed resource and reloads a fresh iframe only on demand', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      return Promise.resolve(
        init?.method === 'HEAD'
          ? response(200, 'OK', 'revision-b')
          : response(200, 'OK', 'revision-a'),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Live explorer" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const firstIframe = screen.getByTitle('Live explorer')
    fireEvent.load(firstIframe)

    await act(async () => {
      vi.advanceTimersByTime(REPORT_HTML_CHANGE_POLL_MS)
      await Promise.resolve()
      await Promise.resolve()
    })
    const reload = screen.getByRole('button', {
      name: 'Reload embedded report, updated content available',
    })
    expect(reload).toHaveTextContent('Updated content available')
    expect(screen.getByTitle('Live explorer')).toBe(firstIframe)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1)

    fireEvent.click(reload)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const secondIframe = screen.getByTitle('Live explorer')
    expect(secondIframe).not.toBe(firstIframe)
    expect(secondIframe).toHaveAttribute('src', '/api/report-assets/p/R0001/view.html')
    expect(screen.getByRole('button', { name: 'Reload embedded report' })).toBeInTheDocument()
  })

  it('keeps the update indicator when manual reload validation fails', async () => {
    vi.useFakeTimers()
    let getCount = 0
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') return Promise.resolve(response(200, 'OK', 'revision-b'))
      getCount += 1
      return Promise.resolve(
        getCount === 1 ? response(200, 'OK', 'revision-a') : response(503, 'Service Unavailable'),
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Live explorer" />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.load(screen.getByTitle('Live explorer'))

    await act(async () => {
      vi.advanceTimersByTime(REPORT_HTML_CHANGE_POLL_MS)
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reload embedded report, updated content available',
      }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503 Service Unavailable')
    expect(
      screen.getByRole('button', {
        name: 'Reload embedded report, updated content available',
      }),
    ).toHaveTextContent('Updated content available')
  })

  it('polls a ready embed only while the embed itself is visible', async () => {
    vi.useFakeTimers()
    const observers = installIntersectionObserverHarness()
    const fetchMock = vi.fn((_: string, init?: RequestInit) =>
      Promise.resolve(response(200, 'OK', init?.method === 'HEAD' ? 'revision-b' : 'revision-a')),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(
      <ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Scrolled plot" />,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.load(screen.getByTitle('Scrolled plot'))
    const wrapper = container.querySelector('[data-report-html-wrapper]') as HTMLElement
    const visibilityObserver = observers.find(
      (observer) => observer.options?.rootMargin === undefined,
    )
    expect(visibilityObserver).toBeDefined()

    act(() => {
      visibilityObserver?.callback(
        [{ isIntersecting: false, target: wrapper } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
      vi.advanceTimersByTime(REPORT_HTML_CHANGE_POLL_MS)
    })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(0)

    act(() => {
      visibilityObserver?.callback(
        [{ isIntersecting: true, target: wrapper } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    await act(async () => {
      vi.advanceTimersByTime(REPORT_HTML_CHANGE_POLL_MS)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1)
  })

  it('skips low-frequency revision checks while the document is hidden', async () => {
    vi.useFakeTimers()
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    let visibilityState: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    })
    const fetchMock = vi.fn((_: string, init?: RequestInit) =>
      Promise.resolve(response(200, 'OK', init?.method === 'HEAD' ? 'revision-b' : 'revision-a')),
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Hidden plot" />)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      fireEvent.load(screen.getByTitle('Hidden plot'))

      act(() => vi.advanceTimersByTime(REPORT_HTML_CHANGE_POLL_MS))
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(0)

      visibilityState = 'visible'
      await act(async () => {
        vi.advanceTimersByTime(REPORT_HTML_CHANGE_POLL_MS)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'HEAD')).toHaveLength(1)
    } finally {
      if (visibilityDescriptor) {
        Object.defineProperty(document, 'visibilityState', visibilityDescriptor)
      } else {
        Reflect.deleteProperty(document, 'visibilityState')
      }
    }
  })

  it('does not time out a lazy below-fold iframe until it approaches the viewport', async () => {
    vi.useFakeTimers()
    const observers = installIntersectionObserverHarness()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/later.html" title="Later plot" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTitle('Later plot')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(15_000))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTitle('Later plot')).toBeInTheDocument()

    const proximityObserver = observers.find(
      (observer) => observer.options?.rootMargin === '400px 0px',
    )
    expect(proximityObserver).toBeDefined()
    act(() => {
      proximityObserver?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    act(() => vi.advanceTimersByTime(15_000))
    expect(screen.getByRole('alert')).toHaveTextContent('did not finish loading within 15 seconds')
    expect(proximityObserver?.disconnect).toHaveBeenCalled()
  })

  it('shows an HTTP error and retries before mounting the iframe', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(404, 'Not Found'))
      .mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/missing.html" title="Missing chart" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('HTTP 404 Not Found')
    expect(screen.queryByTitle('Missing chart')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    const iframe = await screen.findByTitle('Missing chart')
    expect(iframe).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a successful non-HTML response before mounting the iframe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Chart" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'expected HTML but received application/json',
    )
    expect(screen.queryByTitle('Chart')).toBeNull()
  })

  it('does not navigate to a changed source before its new probe succeeds', async () => {
    let resolveNext: ((value: Response) => void) | undefined
    const nextResponse = new Promise<Response>((resolve) => {
      resolveNext = resolve
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(response()).mockReturnValueOnce(nextResponse)
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(
      <ReportHtmlEmbed src="/api/report-assets/p/R0001/first.html" title="First chart" />,
    )
    expect(await screen.findByTitle('First chart')).toBeInTheDocument()

    rerender(<ReportHtmlEmbed src="/api/report-assets/p/R0001/second.html" title="Second chart" />)
    expect(screen.queryByTitle('Second chart')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => resolveNext?.(response()))
    expect(await screen.findByTitle('Second chart')).toBeInTheDocument()
  })

  it('surfaces an iframe network error after a successful preflight', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Chart" />)

    const iframe = await screen.findByTitle('Chart')
    fireEvent.error(iframe)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'embedded report document could not be loaded',
    )
  })

  it('times out a stalled iframe load and lets the user retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetchMock)
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/stalled.html" title="Slow chart" />)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTitle('Slow chart')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('did not finish loading within 15 seconds')

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTitle('Slow chart')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
