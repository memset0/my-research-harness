import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { WikiListItem, WikiPageDetail } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { WikiShell } from './wiki-shell'

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
vi.mock('./session-provider', () => ({ useIsOwner: () => false }))
vi.mock('./document-artifact-link-provider', () => ({
  DocumentArtifactLinkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div data-testid="wiki-markdown">{children}</div>,
}))
vi.mock('./readme-monaco', () => ({ ReadmeMonaco: () => <div>editor</div> }))
vi.mock('./wiki-review-panel', () => ({
  WikiReviewPanel: () => null,
  WikiChangesDialog: () => null,
}))

import { fetchWiki, fetchWikiPage } from '../lib/api'

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
    tags: [],
    sources: [],
    legacyId: null,
    entry: null,
    deprecated: null,
    deprecatedSections: [],
    stale: false,
    staleSources: [],
    review: null,
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
    const cards = Array.from(container.querySelectorAll('[data-wiki-card]'))
    expect(cards[1]).toHaveAttribute('aria-current', 'page')
    const outline = container.querySelector('[data-wiki-outline]')
    expect(outline).toHaveClass('sticky')
    expect(outline).toHaveTextContent('Evidence')
    expect(outline).toHaveTextContent('Limits')
    expect(outline?.querySelector('a')).toHaveAttribute('href', '#wiki-w0002-evidence')
    expect(screen.getByTestId('wiki-markdown')).not.toHaveTextContent('---')

    await userEvent.type(screen.getByLabelText('Filter'), 'weekly')
    await waitFor(() => {
      const filtered = Array.from(container.querySelectorAll('[data-wiki-card]'))
      expect(filtered.map((card) => card.getAttribute('data-wiki-id'))).toEqual(['W0005'])
    })
    expect(screen.getByTestId('wiki-markdown')).toHaveTextContent('Measured result.')
    await userEvent.click(screen.getByRole('button', { name: 'Clear wiki page filter' }))
    expect(container.querySelectorAll('[data-wiki-card]')).toHaveLength(2)
  })

  it('distinguishes an unselected populated wiki from a genuinely empty wiki', async () => {
    const page = summary('W0001', '2026-05-04T08:00:00+00:00')
    vi.mocked(fetchWiki).mockResolvedValueOnce({ pages: [page] })
    const populated = renderWithQuery(<WikiShell project="project-a" selectedId={null} />)
    expect(await screen.findByText('Select a wiki page from the page list to begin reading.')).toBeInTheDocument()
    expect(screen.queryByText(/memon wiki create/)).not.toBeInTheDocument()
    populated.unmount()

    vi.mocked(fetchWiki).mockResolvedValueOnce({ pages: [] })
    renderWithQuery(<WikiShell project="project-b" selectedId={null} />)
    expect(await screen.findByText(/memon wiki create/)).toBeInTheDocument()
  })
})
