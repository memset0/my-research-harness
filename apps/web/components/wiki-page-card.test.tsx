import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { WikiListItem } from '../lib/api'
import { filterWikiPages, sortWikiPages, WikiPageCard } from './wiki-page-card'

function page(id: string, updatedAt: string, overrides: Partial<WikiListItem> = {}): WikiListItem {
  return {
    id,
    slug: `page-${id.toLowerCase()}`,
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

describe('wiki page rail cards', () => {
  it('orders the flat rail newest-first while keeping deprecated pages last', () => {
    const older = page('W0001', '2026-05-04T08:00:00+00:00')
    const newest = page('W0005', '2026-05-06T08:00:00+00:00', { kind: 'note' })
    const deprecated = page('W0007', '2026-05-07T08:00:00+00:00', {
      deprecated: { at: '2026-05-07T09:00:00+00:00', reason: 'superseded' },
    })

    expect(sortWikiPages([older, deprecated, newest]).map((entry) => entry.id)).toEqual([
      'W0005',
      'W0001',
      'W0007',
    ])
  })

  it('filters case-insensitively across title, slug, and tags without reordering', () => {
    const pages = [
      page('W0005', '2026-05-06T08:00:00+00:00', { title: 'Weekly sync' }),
      page('W0002', '2026-05-05T08:00:00+00:00', {
        slug: 'common-path-debt',
        tags: ['Kernel'],
      }),
    ]

    expect(
      filterWikiPages(pages, { kind: 'all', text: 'KERNEL' }).map((entry) => entry.id),
    ).toEqual(['W0002'])
    expect(
      filterWikiPages(pages, { kind: 'finding', text: 'path' }).map((entry) => entry.id),
    ).toEqual(['W0002'])
  })

  it('renders one native-link card with independent status, stale, and review signals', () => {
    const entry = page('W0004', '2026-05-06T08:00:00+00:00', {
      title: 'Inference kernel drift',
      description: 'The generated kernel changed after the verified baseline.',
      slug: 'inference-kernel-drift',
      status: 'VERIFIED',
      stale: true,
      staleSources: ['E0017/V0002'],
      review: {
        state: 'CHANGED_SINCE_VERIFY',
        verifiedThrough: 'a'.repeat(40),
        verifiedAt: '2026-05-05T08:00:00+00:00',
        unverifiedCommits: ['b'.repeat(40)],
        unverifiedRanges: [[12, 18]],
        dirty: false,
      },
    })

    render(<WikiPageCard page={entry} href="/p/project-a/wiki/W0004" active />)

    const link = screen.getByRole('link', { name: /Inference kernel drift/i })
    expect(link).toHaveAttribute('href', '/p/project-a/wiki/W0004')
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(link).toHaveAttribute('data-wiki-card')
    expect(within(link).getByText('finding')).toBeInTheDocument()
    expect(within(link).getByText('VERIFIED')).toBeInTheDocument()
    expect(within(link).getByText('stale')).toBeInTheDocument()
    expect(within(link).getByText('CHANGED_SINCE_VERIFY')).toBeInTheDocument()
    expect(link).toHaveTextContent('W0004')
    expect(link).toHaveTextContent('inference-kernel-drift')
    expect(link).toHaveTextContent('The generated kernel changed after the verified baseline.')
    expect(link.querySelector('[data-slot="wiki-stale-indicator"]')).toHaveAttribute(
      'title',
      expect.stringContaining('E0017/V0002'),
    )
  })
})
