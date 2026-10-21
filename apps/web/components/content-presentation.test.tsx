import { ProjectRefSchema } from '@memon/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContentMetadata,
  ContentPresentation,
  contentUrl,
  matchesContentFilter,
} from './content-presentation'

vi.mock('./session-provider', () => ({ useIsOwner: () => true }))
vi.mock('./report-html-embed', () => ({
  ReportHtmlZoomProvider: ({ children }: { children: React.ReactNode }) => children,
  ReportHtmlEmbed: ({ src, title }: { src: string; title: string }) => (
    <iframe src={src} title={title} />
  ),
}))
afterEach(() => vi.unstubAllGlobals())
const project = ProjectRefSchema.parse({ host: 'source-a', project: 'project-a' })
function wrap(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>,
  )
}

describe('content presentation', () => {
  it('preserves host/project identity in relative HTML asset URLs', () => {
    wrap(
      <ContentPresentation
        project={project}
        kind="report"
        id="R0001"
        content={{ presentation: 'html', contentEntry: 'views/chart.html' }}
      />,
    )
    expect(screen.getByTitle('R0001 HTML')).toHaveAttribute(
      'src',
      '/api/content-assets/source-a/project-a/report/R0001/views/chart.html',
    )
  })
  it('shows explicit freshness and evidence cutoff independently', () => {
    render(
      <ContentMetadata
        content={{
          presentation: 'html',
          freshness: 'STALE',
          staleReason: 'Method superseded; measurement remains valid',
          asOf: '2026-10-01T12:00:00+08:00',
          sourceCommits: { '.': 'a'.repeat(40) },
        }}
      />,
    )
    expect(screen.getByText('STALE')).toBeInTheDocument()
    expect(screen.getByText('Method superseded; measurement remains valid')).toBeInTheDocument()
    expect(screen.getByText('2026-10-01T12:00:00+08:00')).toBeInTheDocument()
  })
  it('shows recoverable offline guidance without opening the application', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    wrap(
      <ContentPresentation
        project={project}
        kind="wiki"
        id="W0001"
        content={{ presentation: 'service' }}
      />,
    )
    await screen.findByText('Unavailable')
    expect(screen.getByText(/Start the application/)).toBeInTheDocument()
    expect(screen.queryByTitle('W0001 live application')).not.toBeInTheDocument()
  })
  it('opens a reachable application at its declared entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: true, status: 200 }) }),
    )
    wrap(
      <ContentPresentation
        project={project}
        kind="wiki"
        id="W0001"
        content={{ presentation: 'service', contentEntry: 'dashboard/' }}
      />,
    )
    await waitFor(() =>
      expect(screen.getByTitle('W0001 live application')).toHaveAttribute(
        'src',
        `${contentUrl(project, 'wiki', 'W0001', 'content-services')}dashboard/`,
      ),
    )
  })
  it('filters independently by category, freshness and presentation', () => {
    const content = {
      category: 'methods',
      presentation: 'html' as const,
      freshness: 'CURRENT' as const,
    }
    expect(
      matchesContentFilter(content, {
        category: 'methods',
        presentation: 'html',
        freshness: 'CURRENT',
      }),
    ).toBe(true)
    expect(
      matchesContentFilter(content, {
        category: 'methods',
        presentation: 'service',
        freshness: 'all',
      }),
    ).toBe(false)
    expect(
      matchesContentFilter(
        {},
        { category: 'all', presentation: 'markdown', freshness: 'UNDECLARED' },
      ),
    ).toBe(true)
  })
})
