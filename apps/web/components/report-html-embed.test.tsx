import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportHtmlEmbed, ReportHtmlZoomProvider } from './report-html-embed'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function response(status = 200, statusText = 'OK'): Response {
  return new Response(null, {
    status,
    statusText,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
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
    expect(actions?.className).toContain('w-full')
    const zoomOut = screen.getByRole('button', { name: 'Zoom out embedded reports' })
    const zoomIn = screen.getByRole('button', { name: 'Zoom in embedded reports' })
    const openInNewTab = screen.getByRole('link', { name: /open in new tab/i })
    const fullscreen = screen.getByRole('button', { name: /^fullscreen$/i })
    expect(zoomOut).toHaveAttribute('data-size', 'icon-sm')
    expect(zoomIn).toHaveAttribute('data-size', 'icon-sm')
    expect(openInNewTab).toHaveAttribute('data-size', 'sm')
    expect(fullscreen).toHaveAttribute('data-size', 'sm')
    const compactToolbarControls = [zoomOut, zoomIn, openInNewTab, fullscreen]
    for (const control of compactToolbarControls) {
      expect(control.className).not.toContain('min-h-11')
    }
    expect(screen.getByText('Training curves').parentElement?.className).toContain('flex-wrap')
    expect(container.querySelector('[data-report-html-wrapper]')).toHaveAttribute(
      'aria-labelledby',
      screen.getByText('Training curves').id,
    )

    fireEvent.load(iframe)
    expect(screen.getByText('Report ready')).toHaveAttribute('role', 'status')
    expect(viewport).toHaveAttribute('aria-busy', 'false')
  })

  it('offers new-tab and fullscreen controls with an unsupported-API fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    render(<ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Result explorer" />)
    await screen.findByTitle('Result explorer')

    const open = screen.getByRole('link', { name: /open in new tab/i })
    expect(open).toHaveAttribute('href', '/api/report-assets/p/R0001/view.html')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noreferrer noopener')

    fireEvent.click(screen.getByRole('button', { name: /^fullscreen$/i }))
    expect(screen.getByText(/fullscreen is unavailable.*open in new tab/i)).toHaveAttribute(
      'role',
      'status',
    )
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

  it('uses the Fullscreen API when the report wrapper supports it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()))
    const { container } = render(
      <ReportHtmlEmbed src="/api/report-assets/p/R0001/view.html" title="Result explorer" />,
    )
    await screen.findByTitle('Result explorer')
    const wrapper = container.querySelector('[data-report-html-wrapper]') as HTMLElement
    const fullscreenDescriptor = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    const exitDescriptor = Object.getOwnPropertyDescriptor(document, 'exitFullscreen')
    let fullscreenElement: Element | null = null
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    })
    const requestFullscreen = vi.fn(async () => {
      fullscreenElement = wrapper
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    const exitFullscreen = vi.fn(async () => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    Object.defineProperty(wrapper, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    })

    try {
      fireEvent.click(screen.getByRole('button', { name: /^fullscreen$/i }))
      await waitFor(() => expect(requestFullscreen).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: /exit fullscreen/i })).toBeInTheDocument()
      expect(wrapper.className).toContain('h-[100svh]')
      expect(wrapper.className).toContain('supports-[height:100dvh]:h-[100dvh]')
      expect(screen.queryByText(/fullscreen is unavailable/i)).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /exit fullscreen/i }))
      await waitFor(() => expect(exitFullscreen).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: /^fullscreen$/i })).toBeInTheDocument()
    } finally {
      if (fullscreenDescriptor) {
        Object.defineProperty(document, 'fullscreenElement', fullscreenDescriptor)
      } else {
        Reflect.deleteProperty(document, 'fullscreenElement')
      }
      if (exitDescriptor) {
        Object.defineProperty(document, 'exitFullscreen', exitDescriptor)
      } else {
        Reflect.deleteProperty(document, 'exitFullscreen')
      }
    }
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
