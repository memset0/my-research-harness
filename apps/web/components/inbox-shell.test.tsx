import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '../lib/api'
import { renderWithQuery } from '../test/utils'

// Only the report reads/writes are stubbed; everything else in lib/api
// (project helpers, query-key builders) keeps its real behaviour.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, fetchReports: vi.fn(), fetchReport: vi.fn(), putReport: vi.fn() }
})

// Monaco cannot run in jsdom; a plain textarea keeps the editor contract.
vi.mock('./readme-monaco', () => ({
  ReadmeMonaco: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="Report source" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// The rendered-markdown surface drags in react-markdown + katex; render the
// source text so copy stays assertable.
vi.mock('./markdown', () => ({
  Markdown: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}))
vi.mock('./document-artifact-link-provider', () => ({
  DocumentArtifactLinkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { ProjectRefSchema } from '@memon/core'
import { ApiError, fetchReport, fetchReports, putReport } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
import { InboxShell } from './inbox-shell'

// Report links are page routes, which exist only for Host-qualified Projects.
const PROJECT = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

const FIRST = {
  id: 'R0001',
  slug: 'first-report',
  title: 'First report',
  description: 'What the first sweep found.',
  category: 'alpha',
  mtime: 1000,
  path: 'docs/reports/R0001-first-report/README.md',
}
const SECOND = {
  id: 'R0002',
  slug: 'second-report',
  title: 'Second report',
  category: 'beta',
  mtime: 2000,
  path: 'docs/reports/R0002-second-report/README.md',
}

function cards(container: HTMLElement): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-report-card]'))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('InboxShell report index — failed list is distinguishable from empty', () => {
  it('shows a retry affordance instead of the empty copy, and recovers on retry', async () => {
    vi.mocked(fetchReports).mockRejectedValueOnce(new Error('upstream 502'))

    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId={null} />,
    )

    // Failure is surfaced, not disguised as an empty project.
    expect(await screen.findByText('failed to load reports')).toBeInTheDocument()
    expect(screen.getByText('upstream 502')).toBeInTheDocument()
    expect(container.querySelector('[data-inbox-empty-state]')).toBeNull()

    const retry = screen.getByRole('button', { name: 'Retry' })
    vi.mocked(fetchReports).mockResolvedValueOnce({ reports: [FIRST] as never })
    await userEvent.click(retry)

    // Retry re-invokes the fetch and the recovered cards render.
    await waitFor(() => expect(vi.mocked(fetchReports)).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('First report')).toBeInTheDocument()
    expect(cards(container)).toHaveLength(1)
    expect(screen.queryByText('failed to load reports')).not.toBeInTheDocument()
  })

  it('shows the authoring empty copy (no retry, no index) when the list is genuinely empty', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [] })

    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId={null} />,
    )

    await waitFor(() => expect(container.querySelector('[data-inbox-empty-state]')).not.toBeNull())
    expect(container.querySelector('[data-inbox-empty-state]')).toHaveTextContent(
      'memon-write-report',
    )
    expect(container.querySelector('[data-report-index]')).toBeNull()
    expect(screen.queryByText('failed to load reports')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})

describe('InboxShell report index — card grid', () => {
  it('lists every Report as a card linking to its page, with the count and filters', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [FIRST, SECOND] as never })

    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId={null} />,
    )

    const index = await waitFor(() => {
      const node = container.querySelector<HTMLElement>('[data-report-index]')
      expect(node).not.toBeNull()
      expect(cards(container)).toHaveLength(2)
      return node!
    })
    expect(within(index).getByRole('heading', { level: 1 })).toHaveTextContent(/^Reports\s*2$/)
    const filters = index.querySelector('[data-content-filters]')
    expect(filters).not.toBeNull()
    expect(
      within(filters as HTMLElement)
        .getAllByRole('combobox')
        .map((select) => select.getAttribute('aria-label')),
    ).toEqual(['Categories', 'Freshness', 'Presentations'])

    const grid = index.querySelector('[data-report-index-grid]')
    expect(grid).not.toBeNull()
    const [first, second] = cards(container)
    expect(grid).toContainElement(first!)
    expect(first).toHaveAttribute('href', '/host-a/project-a/r/1')
    expect(second).toHaveAttribute('href', '/host-a/project-a/r/2')
    expect(first).toHaveTextContent('R0001')
    expect(first).toHaveTextContent('first-report')
    expect(first).toHaveTextContent('First report')
    expect(first).toHaveTextContent('What the first sweep found.')
    expect(first).not.toHaveAttribute('aria-current')

    // Navigation lives in the sidebar: no rail, picker toggle or drawer.
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('button', { name: /Open list|Show reports|Hide reports/ })).toBeNull()
    expect(container.querySelector('[data-inbox-empty-state]')).toBeNull()
    expect(fetchReport).not.toHaveBeenCalled()
  })

  it('narrows the cards with a content filter and shows the filtered count', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [FIRST, SECOND] as never })

    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId={null} />,
    )
    await waitFor(() => expect(cards(container)).toHaveLength(2))

    await userEvent.click(screen.getByRole('combobox', { name: 'Categories' }))
    await userEvent.click(await screen.findByRole('option', { name: 'beta' }))

    await waitFor(() => expect(cards(container)).toHaveLength(1))
    expect(cards(container)[0]).toHaveAttribute('href', '/host-a/project-a/r/2')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Reports\s*1 \/ 2$/)
  })
})

describe('InboxShell selected Report', () => {
  it('keeps metadata in the header behind Details and edits only Markdown Reports', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [FIRST] as never })
    vi.mocked(fetchReport).mockResolvedValue({
      ...FIRST,
      hash: 'h1',
      content: '# First\nBody text.',
      format: 'markdown',
      category: 'analysis',
      freshness: 'CURRENT',
      asOf: '2026-10-01T12:00:00+08:00',
    } as never)
    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId="R0001" />,
    )
    await screen.findByText(/Body text\./)
    const header = container.querySelector('[data-document-header]') as HTMLElement
    expect(within(header).getByText('analysis')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByText(/Evidence as of/)).toBeNull()
    // The collapsed line names the Report; clicking anywhere on it opens the rest.
    const line = header.querySelector('[data-document-header-line]') as HTMLElement
    await userEvent.click(line)
    expect(within(header).getByText(/Evidence as of/)).toBeInTheDocument()
    expect(within(header).getByRole('button', { expanded: true })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    await userEvent.click(line)
    expect(screen.queryByText(/Evidence as of/)).toBeNull()
  })

  it('gives an HTML Report the whole body and its embed controls the header', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [FIRST] as never })
    vi.mocked(fetchReport).mockResolvedValue({
      ...FIRST,
      hash: 'h1',
      content: '{}',
      format: 'bundle',
      presentation: 'html',
    } as never)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
        ),
    )
    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId="R0001" />,
    )
    const header = await waitFor(() => {
      const node = container.querySelector<HTMLElement>('[data-document-header]')
      expect(node).not.toBeNull()
      return node!
    })
    expect(within(header).queryByRole('button', { name: 'Edit' })).toBeNull()
    await waitFor(() =>
      expect(
        within(header.querySelector('[data-embed-toolbar-slot]') as HTMLElement).getByRole(
          'button',
          { name: 'Expand' },
        ),
      ).toBeInTheDocument(),
    )
    expect(container.querySelector('[data-report-html-wrapper]')).toHaveAttribute(
      'data-hosted',
      'true',
    )
    vi.unstubAllGlobals()
  })

  it('fills the main area with the Report and offers the quick switch in its header', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [FIRST, SECOND] as never })
    vi.mocked(fetchReport).mockResolvedValue({
      ...FIRST,
      hash: 'h1',
      content: '# First\nBody text.',
      format: 'markdown',
    })

    const { container } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId="R0001" />,
    )

    expect(await screen.findByText(/Body text\./)).toBeInTheDocument()
    const main = screen.getByRole('main')
    expect(main).toContainElement(container.querySelector('[data-inbox-reading-surface]'))
    expect(container.querySelector('[data-report-index]')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()

    // Navigation between Reports lives in the sidebar, not the header.
    expect(screen.queryByRole('button', { name: /Switch report/ })).toBeNull()
  })
})

describe('InboxShell report editor — list invalidation', () => {
  it('refetches the Report list of a Host-qualified Project after a save', async () => {
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [{ id: 'R0001', slug: 'first-report', title: 'First report', mtime: 1000 }] as never,
    })
    vi.mocked(fetchReport).mockResolvedValue({
      id: 'R0001',
      slug: 'first-report',
      mtime: 1000,
      hash: 'h1',
      content: '# First',
      format: 'markdown',
    })
    vi.mocked(putReport).mockResolvedValue({ mtime: 2000, hash: 'h2' } as never)

    const { queryClient } = renderWithQuery(
      <InboxShell kind="reports" project={PROJECT} selectedId="R0001" />,
    )
    await waitFor(() => expect(vi.mocked(fetchReports)).toHaveBeenCalledTimes(1))
    // The list read is keyed by the factory constructor the editor invalidates.
    expect(queryClient.getQueryState(queryKeys.reports(PROJECT))).toBeDefined()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const [source] = screen.getAllByLabelText('Report source')
    fireEvent.change(source!, { target: { value: '# First, edited' } })
    // Desktop and mobile editors both mount; the open mobile Sheet blocks
    // pointer events, so activate the first Save directly.
    const [save] = screen.getAllByRole('button', { name: 'Save', hidden: true })
    fireEvent.click(save!)

    await waitFor(() => expect(vi.mocked(putReport)).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(vi.mocked(fetchReports)).toHaveBeenCalledTimes(2))
  })
})

describe('InboxShell report detail — unrefreshed catalog', () => {
  it('shows Not refreshed instead of an error when the source has the Report', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [] })
    vi.mocked(fetchReport).mockRejectedValue(new ApiError(404, 'Not refreshed', 'NOT_REFRESHED'))

    renderWithQuery(<InboxShell kind="reports" project={PROJECT} selectedId="R0002" />)

    expect(await screen.findByText('Not refreshed: R0002')).toBeInTheDocument()
    expect(screen.queryByText(/^error:/)).not.toBeInTheDocument()
  })
})

describe('InboxShell — document-only share viewer', () => {
  it('shows the shared Report without the index or the list request', async () => {
    const { SessionProvider } = await import('./session-provider')
    vi.mocked(fetchReport).mockReturnValue(new Promise(() => {}))
    const { container } = renderWithQuery(
      <SessionProvider value={{ role: 'viewer', scopeProjects: [], documentOnly: true }}>
        <InboxShell kind="reports" project={PROJECT} selectedId="R0005" />
      </SessionProvider>,
    )
    await waitFor(() => expect(fetchReport).toHaveBeenCalled())
    expect(container.querySelector('[data-report-index]')).toBeNull()
    expect(container.querySelector('[data-report-card]')).toBeNull()
    expect(fetchReports).not.toHaveBeenCalled()
  })
})
