import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  fetchWiki,
  fetchWikiPage,
  type WikiListItem,
  type WikiPageDetail,
} from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { WikiDocumentView, WikiShell } from './wiki-shell'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchWiki: vi.fn(),
    fetchWikiPage: vi.fn(),
    putWikiPage: vi.fn(),
  }
})
vi.mock('../lib/use-user-preference-state', () => ({
  useUserPreferenceState: () => [true, vi.fn()],
}))
const viewer = { documentOnly: false }
const navigation = { search: '' }
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
vi.mock('./session-provider', () => ({
  useIsOwner: () => false,
  useIsDocumentOnlyViewer: () => viewer.documentOnly,
  useSession: () => ({ role: 'viewer', scopeProjects: [] }),
}))
vi.mock('./document-artifact-link-provider', () => ({
  DocumentArtifactLinkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./markdown', () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="wiki-markdown">{children}</div>
  ),
}))
vi.mock('./readme-monaco', () => ({ ReadmeMonaco: () => <div>editor</div> }))
function summary(
  id: string,
  updatedAt: string,
  overrides: Partial<WikiListItem> = {},
): WikiListItem {
  return {
    id,
    slug: `${id.toLowerCase()}-page`,
    kind: 'finding',
    title: `Page ${id}`,
    description: null,
    status: 'TENTATIVE',
    date: null,
    language: 'en',
    tags: [],
    sources: [],
    legacyId: null,
    entry: null,
    deprecated: null,
    deprecatedSections: [],
    stale: false,
    staleSources: [],
    format: 'markdown',
    path: `docs/wiki/finding/${id}-page.md`,
    project: 'project-a',
    mtime: Date.parse(updatedAt),
    createdAt: updatedAt,
    updatedAt,
    diagnostics: [],
    ...overrides,
  }
}

// Wiki links are page routes, which exist only for Host-qualified Projects.
const PROJECT = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

function cardIds(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-wiki-card]'), (card) =>
    card.getAttribute('data-wiki-id'),
  )
}

function detail(base: WikiListItem, content: string): WikiPageDetail {
  return {
    ...base,
    content,
    hash: 'a'.repeat(40),
    components: [],
  }
}

describe('WikiShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps prose plain without review decoration and width-limited without an inline mobile outline', () => {
    const page = detail(
      summary('W0002', '2026-05-04T08:00:00+00:00', {}),
      '## Evidence\nPlain prose.',
    )
    const { container } = renderWithQuery(<WikiDocumentView project="project-a" page={page} />)
    const body = container.querySelector('[data-wiki-document-body]')
    expect(body).toHaveClass('mx-auto', 'w-full', 'max-w-[800px]')
    expect(body).not.toHaveClass('rounded-md', 'border-l-4', 'bg-muted/50', 'py-2', 'pl-3')
    expect(container.querySelector('[data-wiki-review-summary]')).toBeNull()
    expect(container.querySelector('[data-wiki-unverified]')).toBeNull()
    expect(container.querySelector('[data-wiki-inline-toc]')).toBeNull()
  })

  it('declares the page language on the reading body', () => {
    const english = renderWithQuery(
      <WikiDocumentView
        project="project-a"
        page={detail(summary('W0006', '2026-05-04T08:00:00+00:00'), '## Evidence\nProse.')}
      />,
    )
    expect(english.container.querySelector('[data-wiki-document-body]')).toHaveAttribute(
      'lang',
      'en',
    )
    const chinese = renderWithQuery(
      <WikiDocumentView
        project="project-a"
        page={detail(
          summary('W0007', '2026-05-04T08:00:00+00:00', { language: 'zh' }),
          '## 证据\n实测结果。',
        )}
      />,
    )
    expect(chinese.container.querySelector('[data-wiki-document-body]')).toHaveAttribute(
      'lang',
      'zh-CN',
    )
  })

  it('renders the selected document with the sticky outline and the header quick switch', async () => {
    const older = summary('W0002', '2026-05-04T08:00:00+00:00', {
      title: 'Kernel evidence',
      tags: ['kernel'],
    })
    const newest = summary('W0005', '2026-05-06T08:00:00+00:00', {
      kind: 'meeting',
      title: 'Weekly sync',
      status: null,
    })
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [older, newest] })
    vi.mocked(fetchWikiPage).mockResolvedValue(
      detail(
        older,
        [
          '---',
          'id: W0002',
          'kind: finding',
          'title: Kernel evidence',
          'created_at: 2026-05-04T08:00:00+00:00',
          '---',
          '# Kernel evidence',
          '## Evidence',
          'Measured result.',
          '### Limits',
          'One host only.',
        ].join('\n'),
      ),
    )

    const { container } = renderWithQuery(<WikiShell project={PROJECT} selectedId="W0002" />)

    expect(await screen.findByTestId('wiki-markdown')).toHaveTextContent('Measured result.')
    // The page fills the main area: no rail, mobile rail or index.
    expect(screen.getByRole('main')).toContainElement(
      container.querySelector('[data-wiki-reading-surface]') as HTMLElement,
    )
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(container.querySelector('[data-wiki-index]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show wiki pages' })).toBeNull()

    const outline = container.querySelector('[data-wiki-outline]')
    expect(outline).toHaveClass('sticky')
    expect(outline).toHaveClass('hidden', 'md:block', 'self-start')
    const layout = container.querySelector('[data-wiki-reading-layout]')
    expect(layout).toHaveClass('justify-center', 'gap-6')
    expect(outline?.parentElement).toBe(layout)
    expect(container.querySelector('[data-wiki-document-column]')).toHaveClass(
      'max-w-[800px]',
      'min-w-0',
    )
    expect(container.querySelector('[data-wiki-review-summary]')).toBeNull()
    expect(container.querySelector('[data-wiki-unverified]')).toBeNull()
    expect(container.querySelector('[data-wiki-inline-toc]')).toBeNull()
    const outlineDisclosure = outline?.querySelector('details')
    expect(outlineDisclosure).toHaveAttribute('open')
    expect(outlineDisclosure?.querySelector('summary')).toHaveTextContent('On this page')
    expect(outline).toHaveClass('has-[details:not([open])]:w-auto')
    expect(outline).toHaveTextContent('Evidence')
    expect(outline).toHaveTextContent('Limits')
    expect(outline?.querySelector('a')).toHaveAttribute('href', '#wiki-w0002-evidence')
    expect(screen.getByTestId('wiki-markdown')).not.toHaveTextContent('---')

    const column = container.querySelector('[data-wiki-document-column]')
    const body = container.querySelector('[data-wiki-document-body]')
    expect(column).toHaveClass('bg-card')
    expect(container.querySelector('[data-wiki-reading-surface]')).not.toHaveClass('bg-card')
    expect(outline).not.toHaveClass('bg-card')
    const widthToggle = screen.getByRole('button', { name: 'Limit reading width to 800px' })
    expect(widthToggle).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(widthToggle)
    expect(widthToggle).toHaveAttribute('aria-pressed', 'false')
    expect(widthToggle).toHaveTextContent('Full width')
    expect(column).not.toHaveClass('max-w-[800px]')
    expect(body).not.toHaveClass('max-w-[800px]')
    expect(outline).toBeVisible()
    await userEvent.click(widthToggle)
    expect(widthToggle).toHaveAttribute('aria-pressed', 'true')
    expect(column).toHaveClass('max-w-[800px]')
    expect(body).toHaveClass('max-w-[800px]')

    // The identity header switches pages: newest edit first, current marked.
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch wiki page, current W0002 w0002-page' }),
    )
    const list = await waitFor(() => {
      const node = document.body.querySelector<HTMLElement>('[data-wiki-quick-switch-list]')
      expect(node).not.toBeNull()
      expect(node!.querySelectorAll('[data-wiki-card]')).toHaveLength(2)
      return node!
    })
    const switchCards = Array.from(list.querySelectorAll('[data-wiki-card]'))
    expect(switchCards.map((card) => card.getAttribute('data-wiki-id'))).toEqual(['W0005', 'W0002'])
    expect(switchCards[1]).toHaveAttribute('aria-current', 'page')
    expect(switchCards[0]).toHaveAttribute('href', '/host-a/project-a/w/5')
  })

  it('scrolls only the reading surface when an outline entry is activated', async () => {
    const page = summary('W0002', '2026-05-04T08:00:00+00:00')
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [page] })
    vi.mocked(fetchWikiPage).mockResolvedValue(
      detail(page, ['# Title', '## Evidence', 'Measured result.'].join('\n')),
    )
    const { container } = renderWithQuery(
      <div id="inset" style={{ overflow: 'hidden' }}>
        <WikiShell project={PROJECT} selectedId="W0002" />
      </div>,
    )
    const markdown = await screen.findByTestId('wiki-markdown')
    const heading = document.createElement('h2')
    heading.id = 'wiki-w0002-evidence'
    markdown.append(heading)

    const surface = container.querySelector('[data-wiki-reading-surface]') as HTMLElement
    const inset = container.querySelector('#inset') as HTMLElement
    surface.style.overflowY = 'auto'
    Object.defineProperty(surface, 'scrollHeight', { value: 3000 })
    Object.defineProperty(surface, 'clientHeight', { value: 600 })
    surface.getBoundingClientRect = () => ({ top: 100 }) as DOMRect
    heading.getBoundingClientRect = () => ({ top: 900 }) as DOMRect
    inset.scrollTop = 0

    const link = container.querySelector('[data-wiki-outline] a') as HTMLAnchorElement
    await userEvent.click(link)
    expect(surface.scrollTop).toBe(800)
    expect(inset.scrollTop).toBe(0)
    expect(window.location.hash).toBe('#wiki-w0002-evidence')
  })

  it('shows the Wiki index with count, filters and a newest-first card grid', async () => {
    const older = summary('W0002', '2026-05-04T08:00:00+00:00', {
      title: 'Kernel evidence',
      tags: ['kernel'],
      description: 'Measured on one host.',
    })
    const newest = summary('W0005', '2026-05-06T08:00:00+00:00', {
      kind: 'meeting',
      title: 'Weekly sync',
      status: null,
    })
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [older, newest] })
    const { container } = renderWithQuery(<WikiShell project={PROJECT} selectedId={null} />)

    const index = await waitFor(() => {
      const node = container.querySelector<HTMLElement>('[data-wiki-index]')
      expect(node).not.toBeNull()
      expect(cardIds(container)).toEqual(['W0005', 'W0002'])
      return node!
    })
    expect(within(index).getByRole('heading', { level: 1 })).toHaveTextContent(/^Wiki\s*2/)
    expect(index.querySelector('[data-content-filters]')).not.toBeNull()
    expect(index.querySelector('[data-slot="wiki-kind-filter"]')).not.toBeNull()
    expect(screen.getByLabelText('Filter')).toHaveAttribute('data-slot', 'wiki-text-filter')
    const grid = index.querySelector('[data-wiki-index-grid]') as HTMLElement
    expect(grid).not.toBeNull()
    const cards = Array.from(grid.querySelectorAll('[data-wiki-card]'))
    expect(cards.map((card) => card.getAttribute('href'))).toEqual([
      '/host-a/project-a/w/5',
      '/host-a/project-a/w/2',
    ])
    expect(cards[1]).toHaveTextContent('Kernel evidence')
    expect(cards[1]).toHaveTextContent('Measured on one host.')
    expect(cards[1]).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(container.querySelector('[data-wiki-empty-state]')).toBeNull()
    expect(fetchWikiPage).not.toHaveBeenCalled()

    // The text filter matches titles, slugs and tags.
    await userEvent.type(screen.getByLabelText('Filter'), 'weekly')
    await waitFor(() => expect(cardIds(container)).toEqual(['W0005']))
    expect(within(index).getByRole('heading', { level: 1 })).toHaveTextContent(/^Wiki\s*1 \/ 2/)
    await userEvent.clear(screen.getByLabelText('Filter'))
    await userEvent.type(screen.getByLabelText('Filter'), 'kernel')
    await waitFor(() => expect(cardIds(container)).toEqual(['W0002']))
    await userEvent.click(screen.getByRole('button', { name: 'Clear wiki page filter' }))
    expect(cardIds(container)).toEqual(['W0005', 'W0002'])

    // The kind select narrows to one kind; a filter with no match says so.
    await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }))
    await userEvent.click(await screen.findByRole('option', { name: /\(meeting\)/ }))
    await waitFor(() => expect(cardIds(container)).toEqual(['W0005']))
    await userEvent.type(screen.getByLabelText('Filter'), 'kernel')
    expect(await screen.findByText('no matching pages')).toBeInTheDocument()
    expect(container.querySelector('[data-wiki-empty-state]')).toBeNull()
  })

  it('shows the authoring empty copy only for a genuinely empty wiki', async () => {
    vi.mocked(fetchWiki).mockResolvedValueOnce({ pages: [] })
    const { container } = renderWithQuery(<WikiShell project={PROJECT} selectedId={null} />)
    await waitFor(() => expect(container.querySelector('[data-wiki-empty-state]')).not.toBeNull())
    expect(container.querySelector('[data-wiki-empty-state]')).toHaveTextContent(
      'memon wiki create',
    )
    expect(container.querySelector('[data-wiki-index]')).toBeNull()
  })

  it('keeps a failed list distinguishable from an empty wiki and recovers on retry', async () => {
    vi.mocked(fetchWiki).mockRejectedValueOnce(new Error('upstream 502'))
    const { container } = renderWithQuery(<WikiShell project={PROJECT} selectedId={null} />)
    expect(await screen.findByText('failed to load wiki pages')).toBeInTheDocument()
    expect(screen.getByText('upstream 502')).toBeInTheDocument()
    expect(container.querySelector('[data-wiki-empty-state]')).toBeNull()

    vi.mocked(fetchWiki).mockResolvedValueOnce({
      pages: [summary('W0001', '2026-05-04T08:00:00+00:00')],
    })
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(cardIds(container)).toEqual(['W0001']))
    expect(screen.queryByText('failed to load wiki pages')).not.toBeInTheDocument()
  })

  it('says a published-catalog miss is not refreshed when the source has the page', async () => {
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [summary('W0001', '2026-05-04T08:00:00+00:00')],
    })
    vi.mocked(fetchWikiPage).mockRejectedValue(new ApiError(404, 'Not refreshed', 'NOT_REFRESHED'))
    renderWithQuery(<WikiShell project={PROJECT} selectedId="W0004" />)
    expect(await screen.findByText('Not refreshed: W0004')).toBeInTheDocument()
    expect(screen.queryByText(/not found/)).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('shows a document-only share viewer the page without the page list', async () => {
    viewer.documentOnly = true
    try {
      const page = summary('W0004', '2026-05-04T08:00:00+00:00', { title: 'Roadmap' })
      vi.mocked(fetchWiki).mockClear()
      vi.mocked(fetchWikiPage).mockResolvedValue(detail(page, '## Plan\nShared body.'))
      const { container } = renderWithQuery(<WikiShell project={PROJECT} selectedId="W0004" />)
      expect(await screen.findByTestId('wiki-markdown')).toHaveTextContent('Shared body.')
      expect(container.querySelector('[data-wiki-index]')).toBeNull()
      expect(container.querySelector('[data-wiki-card]')).toBeNull()
      expect(fetchWiki).not.toHaveBeenCalled()
    } finally {
      viewer.documentOnly = false
    }
  })
})
