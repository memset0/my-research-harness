import { screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'
import { ExperimentCardGrid } from './experiment-card-grid'
import { InboxShell } from './inbox-shell'
import { TabBadge } from './tab-badge'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchExperimentDocs: vi.fn(),
    fetchAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }),
    fetchReports: vi.fn(),
    fetchWiki: vi.fn(),
  }
})

vi.mock('./markdown', () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
  MarkdownArtifactLinkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { fetchExperimentDocs, fetchReports, fetchWiki } from '../lib/api'

describe('TabBadge shared experiment cache', () => {
  it('selects a numeric count without replacing the grid DTO in React Query', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [
        {
          id: 'E0001-shared-cache',
          project: 'project-a',
          resource: 'docs/experiments/E0001-shared-cache/README.md',
          mtime: 1,
          readmeMtime: 1,
          frontMatter: {
            id: 'E0001-shared-cache',
            slug: 'shared-cache',
            title: 'Shared cache experiment',
            status: 'OPEN',
            archived: false,
            runs: [],
            hypotheses: [],
            tags: [],
            createdAt: '2026-08-26T00:00:00.000Z',
            updatedAt: '2026-08-26T00:00:00.000Z',
          },
          sections: {
            motivation: null,
            method: null,
            plan: null,
            conclusion: null,
            caveats: null,
          },
          warningsRaw: null,
          parseErrors: [],
          parseWarnings: [],
          effectiveCreatedAt: '2026-08-26T00:00:00.000Z',
          effectiveUpdatedAt: '2026-08-26T00:00:00.000Z',
          memberRuns: [],
        },
      ],
    })

    renderWithQuery(
      <>
        <ExperimentCardGrid project="project-a" />
        <span data-testid="experiment-count">
          <TabBadge kind="experiments" project="project-a" />
        </span>
      </>,
    )

    expect(await screen.findByText('Shared cache experiment')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(screen.getByTestId('experiment-count')).getByText('1')).toBeInTheDocument()
    })
    expect(fetchExperimentDocs).toHaveBeenCalledTimes(1)
  })
})

describe('TabBadge shared reports cache', () => {
  it('leaves the reports list DTO intact for the rail that shares its key', async () => {
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [
        {
          id: 'R0001',
          slug: 'zero-snr-brightness',
          resource: 'docs/reports/R0001-zero-snr-brightness.md',
          title: 'Zero SNR brightness',
          mtime: 1,
          format: 'markdown',
        },
      ],
    })

    // Mount order matters and is the whole point: the badge lives in the
    // AppBar, which mounts before the page body, so ITS queryFn is the one
    // that populates the shared cache entry. React Query dedupes by key, so
    // the rail's queryFn never runs — it can only read whatever the badge
    // cached. If the badge caches a bare count, the rail reads `data.reports`
    // off a number, gets undefined, and silently renders "no reports yet" on
    // a perfectly healthy response.
    renderWithQuery(
      <>
        <span data-testid="reports-count">
          <TabBadge kind="reports" project="project-a" />
        </span>
        <InboxShell kind="reports" project="project-a" selectedId={null} />
      </>,
    )

    expect(await screen.findByText('Zero SNR brightness')).toBeInTheDocument()
    await waitFor(() => {
      expect(within(screen.getByTestId('reports-count')).getByText('1')).toBeInTheDocument()
    })
    expect(screen.queryByText('no reports yet')).not.toBeInTheDocument()
    expect(fetchReports).toHaveBeenCalledTimes(1)
  })
})

describe('TabBadge wiki count', () => {
  it('counts wiki pages from the shared list projection', async () => {
    vi.mocked(fetchWiki).mockResolvedValue({
      pages: [{ id: 'W0001' }, { id: 'W0002' }] as never,
    })

    renderWithQuery(
      <span data-testid="wiki-count">
        <TabBadge kind="wiki" project="project-a" />
      </span>,
    )

    await waitFor(() => {
      expect(within(screen.getByTestId('wiki-count')).getByText('2')).toBeInTheDocument()
    })
    expect(fetchWiki).toHaveBeenCalledTimes(1)
  })
})
