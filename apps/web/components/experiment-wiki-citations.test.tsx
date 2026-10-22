import type { WikiBacklink } from '@memon/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type * as Api from '../lib/api'
import { projectQueryKey } from '../lib/api'
import { ExperimentWikiCitations } from './experiment-wiki-citations'

const { fetchWikiBacklinks } = vi.hoisted(() => ({ fetchWikiBacklinks: vi.fn() }))

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  fetchWikiBacklinks,
}))

const CITATION: WikiBacklink = {
  id: 'W0004',
  slug: 'kernel-drift',
  kind: 'finding',
  title: 'Kernel drift',
  status: 'VERIFIED',
  stale: true,
  deprecated: false,
  updatedAt: '2026-05-06T08:00:00+00:00',
}

function renderCitations(pages?: WikiBacklink[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  if (pages) {
    client.setQueryData(['wiki-backlinks', ...projectQueryKey('project-a'), 'E0017-kernels'], {
      artifact: 'E0017-kernels',
      pages,
    })
  }
  const result = render(
    <QueryClientProvider client={client}>
      <ExperimentWikiCitations project="project-a" experimentId="E0017-kernels" />
    </QueryClientProvider>,
  )
  return { ...result, client }
}

describe('ExperimentWikiCitations', () => {
  it('reads evidence only after expansion and stops automatic checks when collapsed', async () => {
    fetchWikiBacklinks.mockResolvedValue({ artifact: 'E0017-kernels', pages: [] })
    const { client } = renderCitations()
    await client.refetchQueries({ type: 'active' })
    expect(fetchWikiBacklinks).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Cited by wiki/i }))
    expect(await screen.findByText('No wiki citations.')).toBeInTheDocument()
    expect(fetchWikiBacklinks).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('button', { name: /Cited by wiki/i }))
    await client.refetchQueries({ type: 'active' })
    expect(fetchWikiBacklinks).toHaveBeenCalledOnce()
  })

  it('renders trust signals and links the cited wiki page', async () => {
    renderCitations([CITATION])
    await userEvent.click(screen.getByRole('button', { name: /Cited by wiki/i }))

    const link = screen.getByRole('link', { name: /W0004.*Kernel drift/i })
    expect(link).toHaveAttribute('href', '/p/project-a/wiki/W0004')
    expect(within(link).getByText('finding')).toBeInTheDocument()
    expect(within(link).getByText('VERIFIED')).toBeInTheDocument()
    expect(within(link).getByText('stale')).toBeInTheDocument()
    expect(link.querySelector('[data-slot="wiki-review-badge"]')).toBeNull()
  })
})
