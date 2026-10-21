import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
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

function detail(base: WikiListItem, content: string): WikiPageDetail {
  return {
    ...base,
    content,
    hash: 'a'.repeat(40),
    components: [],
  }
}

describe('WikiShell', () => {
  it('keeps prose plain without review decoration and width-limited without an inline mobile outline', () => {
    const page = detail(
      summary('W0002', '2026-05-04T08:00:00+00:00', {}),
      '## Evidence\nPlain prose.',
    )
    const { container } = renderWithQuery(
      <WikiDocumentView project="project-a" page={page} sourceSurface="side-wiki" />,
    )
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
        sourceSurface="full-wiki"
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
        sourceSurface="side-wiki"
      />,
    )
    expect(chinese.container.querySelector('[data-wiki-document-body]')).toHaveAttribute(
      'lang',
      'zh-CN',
    )
  })

  it('renders the flat newest-first card rail, selected document, and sticky outline', async () => {
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

    const { container } = renderWithQuery(<WikiShell project="project-a" selectedId="W0002" />)

    expect(await screen.findByTestId('wiki-markdown')).toHaveTextContent('Measured result.')
    const rail = screen.getByRole('complementary', { name: 'Wiki page picker' })
    expect(
      screen.getByRole('main').compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(rail).toHaveClass('border-l')
    expect(rail).not.toHaveClass('border-r')
    const cards = Array.from(container.querySelectorAll('[data-wiki-card]'))
    expect(cards[1]).toHaveAttribute('aria-current', 'page')
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

    await userEvent.type(screen.getByLabelText('Filter'), 'weekly')
    await waitFor(() => {
      const filtered = Array.from(container.querySelectorAll('[data-wiki-card]'))
      expect(filtered.map((card) => card.getAttribute('data-wiki-id'))).toEqual(['W0005'])
    })
    expect(screen.getByTestId('wiki-markdown')).toHaveTextContent('Measured result.')
    await userEvent.click(screen.getByRole('button', { name: 'Clear wiki page filter' }))
    expect(container.querySelectorAll('[data-wiki-card]')).toHaveLength(2)
  })

  it('scrolls only the reading surface when an outline entry is activated', async () => {
    const page = summary('W0002', '2026-05-04T08:00:00+00:00')
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [page] })
    vi.mocked(fetchWikiPage).mockResolvedValue(
      detail(page, ['# Title', '## Evidence', 'Measured result.'].join('\n')),
    )
    const { container } = renderWithQuery(
      <div id="inset" style={{ overflow: 'hidden' }}>
        <WikiShell project="project-a" selectedId="W0002" />
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

  it('distinguishes an unselected populated wiki from a genuinely empty wiki', async () => {
    const page = summary('W0001', '2026-05-04T08:00:00+00:00')
    vi.mocked(fetchWiki).mockResolvedValueOnce({ pages: [page] })
    const populated = renderWithQuery(<WikiShell project="project-a" selectedId={null} />)
    expect(
      await screen.findByText('Select a wiki page from the page list to begin reading.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/memon wiki create/)).not.toBeInTheDocument()
    populated.unmount()

    vi.mocked(fetchWiki).mockResolvedValueOnce({ pages: [] })
    renderWithQuery(<WikiShell project="project-b" selectedId={null} />)
    expect(await screen.findByText(/memon wiki create/)).toBeInTheDocument()
  })

  it('says a published-catalog miss is not refreshed when the source has the page', async () => {
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [summary('W0001', '2026-05-04T08:00:00+00:00')],
    })
    vi.mocked(fetchWikiPage).mockRejectedValue(new ApiError(404, 'Not refreshed', 'NOT_REFRESHED'))
    renderWithQuery(<WikiShell project="project-a" selectedId="W0004" />)
    expect(await screen.findByText('Not refreshed: W0004')).toBeInTheDocument()
    expect(screen.queryByText(/not found/)).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Wiki page picker' })).toBeInTheDocument()
  })

  it('shows a document-only share viewer the page without the page list', async () => {
    viewer.documentOnly = true
    try {
      const page = summary('W0004', '2026-05-04T08:00:00+00:00', { title: 'Roadmap' })
      vi.mocked(fetchWiki).mockClear()
      vi.mocked(fetchWikiPage).mockResolvedValue(detail(page, '## Plan\nShared body.'))
      const { container } = renderWithQuery(<WikiShell project="project-a" selectedId="W0004" />)
      expect(await screen.findByTestId('wiki-markdown')).toHaveTextContent('Shared body.')
      expect(container.querySelector('[data-wiki-rail]')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open list' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show wiki pages' })).not.toBeInTheDocument()
      expect(fetchWiki).not.toHaveBeenCalled()
    } finally {
      viewer.documentOnly = false
    }
  })

  it('expands a Markdown page over the window from the URL and exits on Escape', async () => {
    const page = summary('W0004', '2026-05-04T08:00:00+00:00', { title: 'Roadmap' })
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [page] })
    vi.mocked(fetchWikiPage).mockResolvedValue(detail(page, '## Plan\nExpanded body.'))
    window.history.replaceState(null, '', '/h/host-a/p/project-a/wiki/W0004?expanded=1')
    navigation.search = 'expanded=1'
    try {
      const { container } = renderWithQuery(<WikiShell project="project-a" selectedId="W0004" />)
      expect(await screen.findByTestId('wiki-markdown')).toHaveTextContent('Expanded body.')
      expect(container.querySelector('[data-expanded-pane="true"]')).toHaveClass('fixed', 'inset-0')
      expect(screen.getByRole('button', { name: 'Exit expanded view' })).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')
      await userEvent.keyboard('{Escape}')
      expect(window.location.search).toBe('')
    } finally {
      navigation.search = ''
    }
  })

  it('leaves Expand to the embed on HTML pages', async () => {
    const page = summary('W0005', '2026-05-04T08:00:00+00:00', { presentation: 'html' } as never)
    vi.mocked(fetchWiki).mockResolvedValue({ pages: [page] })
    vi.mocked(fetchWikiPage).mockResolvedValue(detail(page, ''))
    renderWithQuery(<WikiShell project="project-a" selectedId="W0005" />)
    await screen.findByRole('button', { name: /Limit reading width/ })
    expect(document.querySelector('[data-expand-view]')).toBeNull()
  })
})
