import { ProjectRefSchema } from '@memon/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContentFilters,
  ContentMetadata,
  ContentPresentation,
  contentUrl,
  matchesContentFilter,
} from './content-presentation'

vi.mock('./session-provider', () => ({ useIsOwner: () => true }))
const embedProps: Array<{ expanded?: boolean; onExpandedChange?: (value: boolean) => void }> = []
vi.mock('./report-html-embed', () => ({
  ReportHtmlZoomProvider: ({ children }: { children: React.ReactNode }) => children,
  ReportHtmlEmbed: (props: {
    src: string
    title: string
    expanded?: boolean
    onExpandedChange?: (value: boolean) => void
  }) => {
    embedProps.push(props)
    return <iframe src={props.src} title={props.title} />
  },
}))
const navigation = { search: '' }
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
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

  it('renders the three content filters as one icon row showing their values', () => {
    const { container } = render(
      <ContentFilters
        items={[{ category: 'methods' }]}
        value={{ category: 'all', freshness: 'STALE', presentation: 'all' }}
        onChange={() => {}}
      />,
    )
    const row = container.querySelector('[data-content-filters]')
    expect(row).toHaveClass('grid', 'grid-cols-3')
    for (const [name, key] of [
      ['Categories', 'category'],
      ['Freshness', 'freshness'],
      ['Presentations', 'presentation'],
    ] as const) {
      const trigger = screen.getByRole('combobox', { name })
      expect(trigger).toHaveAttribute('title', name)
      expect(trigger.querySelector(`[data-content-filter-icon="${key}"]`)).not.toBeNull()
    }
    expect(
      within(screen.getByRole('combobox', { name: 'Categories' })).getByText('All'),
    ).toBeTruthy()
    expect(
      within(screen.getByRole('combobox', { name: 'Freshness' })).getByText('STALE'),
    ).toBeTruthy()
  })

  it('keeps the expanded HTML view of a full page in the URL', () => {
    window.history.replaceState(
      null,
      '',
      '/h/source-a/p/project-a/reports/R0006?tab=notes&expanded=1#top',
    )
    navigation.search = 'tab=notes&expanded=1'
    embedProps.length = 0
    wrap(
      <ContentPresentation
        project={project}
        kind="report"
        id="R0006"
        content={{ presentation: 'html' }}
        expandInUrl
      />,
    )
    const props = embedProps.at(-1)!
    expect(props.expanded).toBe(true)
    const replace = vi.spyOn(window.history, 'replaceState')
    props.onExpandedChange?.(false)
    // Next mirrors the URL into useSearchParams only for non-Next history state.
    expect(replace.mock.calls.at(-1)?.[0]).toBeNull()
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/h/source-a/p/project-a/reports/R0006?tab=notes#top',
    )
    props.onExpandedChange?.(true)
    expect(window.location.search).toBe('?tab=notes&expanded=1')
    replace.mockRestore()
  })

  it('leaves side and embedded views out of the URL', () => {
    navigation.search = 'expanded=1'
    embedProps.length = 0
    wrap(
      <ContentPresentation
        project={project}
        kind="wiki"
        id="W0004"
        content={{ presentation: 'html' }}
      />,
    )
    expect(embedProps.at(-1)?.expanded).toBeUndefined()
    expect(embedProps.at(-1)?.onExpandedChange).toBeUndefined()
  })
})
