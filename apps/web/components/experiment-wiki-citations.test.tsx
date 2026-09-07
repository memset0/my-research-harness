import type { WikiBacklink } from '@memon/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExperimentWikiCitations } from './experiment-wiki-citations'

const openWiki = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => '/p/project-a/e/E0017-kernels',
  useSearchParams: () => new URLSearchParams('run=sample&report=R0007&reportSurface=drawer'),
}))
vi.mock('./terminal-drawer-provider', () => ({
  useWikiPane: () => ({ openWiki, closeWiki: vi.fn() }),
}))

const CITATION: WikiBacklink = {
  id: 'W0004',
  slug: 'kernel-drift',
  kind: 'finding',
  title: 'Kernel drift',
  status: 'VERIFIED',
  stale: true,
  deprecated: false,
  reviewState: 'CHANGED_SINCE_VERIFY',
  updatedAt: '2026-05-06T08:00:00+00:00',
}

describe('ExperimentWikiCitations', () => {
  it('omits an empty backlink section', () => {
    const { container } = render(<ExperimentWikiCitations citedBy={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders trust signals and opens the cited page in the shared wiki slot', async () => {
    render(<ExperimentWikiCitations citedBy={[CITATION]} />)

    const link = screen.getByRole('link', { name: /W0004.*Kernel drift/i })
    expect(link).toHaveAttribute(
      'href',
      '/p/project-a/e/E0017-kernels?run=sample&wiki=W0004&wikiSurface=split',
    )
    expect(within(link).getByText('finding')).toBeInTheDocument()
    expect(within(link).getByText('VERIFIED')).toBeInTheDocument()
    expect(within(link).getByText('stale')).toBeInTheDocument()
    expect(within(link).getByText('CHANGED_SINCE_VERIFY')).toBeInTheDocument()

    await userEvent.click(link)
    expect(openWiki).toHaveBeenCalledWith('W0004')
  })
})
