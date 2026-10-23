// v3-spec-sync task 2.3.3 — project list grid renders v3 exp docs
//
// Decision: vitest + RTL. The component reads `fetchExperimentDocs` via
// useQuery; we mock the fetcher and assert the rendered DOM contains
// one Card per exp doc.

import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExperimentCardGrid } from '../../components/experiment-card-grid'
import { renderWithQuery } from '../utils'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchExperimentDocs: vi.fn(),
  }
})

import { type ExperimentDocsResponse, fetchExperimentDocs } from '../../lib/api'

const SAMPLE_DOCS = {
  experiments: [
    {
      id: 'E0001-fsdp',
      project: 'project-a',
      path: '/p/a/docs/experiments/E0001-fsdp.md',
      readmeMtime: 1000,
      runCount: 2,
      hypothesisCount: 1,
      openWarningCount: 0,
      frontMatter: {
        id: 'E0001-fsdp',
        slug: 'fsdp',
        title: 'FSDP collective overlap study',
        status: 'OPEN' as const,
        archived: false,
        tags: ['moe'],
        createdAt: '2026-05-01T08:00:00+08:00',
        updatedAt: '2026-05-02T18:00:00+08:00',
      },
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-05-01T08:00:00+08:00',
      effectiveUpdatedAt: '2026-05-02T18:00:00+08:00',
    },
    {
      id: 'E0002-attention',
      project: 'project-a',
      path: '/p/a/docs/experiments/E0002-attention.md',
      readmeMtime: 2000,
      runCount: 0,
      hypothesisCount: 0,
      openWarningCount: 0,
      frontMatter: {
        id: 'E0002-attention',
        slug: 'attention',
        title: 'Attention cache study',
        status: 'OPEN' as const,
        archived: false,
        tags: [],
        createdAt: '2026-05-03T08:00:00+08:00',
        updatedAt: '2026-05-03T08:00:00+08:00',
      },
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-05-03T08:00:00+08:00',
      effectiveUpdatedAt: '2026-05-03T08:00:00+08:00',
    },
  ],
} satisfies ExperimentDocsResponse

const PROJECT = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })

describe('ExperimentCardGrid — list grid renders v3 exp docs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchExperimentDocs).mockResolvedValue(SAMPLE_DOCS)
  })

  it('renders one card per exp doc with id + title visible', async () => {
    renderWithQuery(<ExperimentCardGrid project={PROJECT} />)

    // Cards show the short ID; the full ID is the card's accessible name.
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'E0001-fsdp' })).toBeInTheDocument()
      expect(screen.getByRole('article', { name: 'E0002-attention' })).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: 'E0001' })).toHaveAttribute('title', 'E0001-fsdp')
    expect(screen.getByText('FSDP collective overlap study')).toBeInTheDocument()
    expect(screen.getByText('Attention cache study')).toBeInTheDocument()
  })

  it('renders no Run counts, Run ids, or roster rows', async () => {
    renderWithQuery(<ExperimentCardGrid project={PROJECT} />)
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'E0001-fsdp' })).toBeInTheDocument()
    })
    // The list contract carries no member runs: frontmatter run ids must not
    // leak into the card, and no per-run link may exist on the list page.
    expect(screen.queryByText('fsdp-260501-100000')).toBeNull()
    expect(screen.queryByText('fsdp-260502-150000')).toBeNull()
    expect(document.querySelectorAll('a[href*="?run="]').length).toBe(0)
    expect(screen.queryByText(/no runs yet/)).toBeNull()
    expect(screen.queryByText(/\d+ running/)).toBeNull()
  })

  it('uses Host-qualified queries, links, and persistence for a central Project', async () => {
    renderWithQuery(<ExperimentCardGrid project={PROJECT} />)
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'E0001-fsdp' })).toBeInTheDocument(),
    )

    expect(fetchExperimentDocs).toHaveBeenCalledWith(PROJECT)
    const links = screen.getAllByRole('link', { name: /^E0001$|FSDP collective overlap study/ })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', '/host-a/project-a/e/1')
  })
})

// ---------- v4 lifecycle-frontmatter additions (task 10.8) ----------

const RESOLVED_DOC = {
  ...SAMPLE_DOCS.experiments[0]!,
  id: 'E0050-resolved',
  frontMatter: {
    ...SAMPLE_DOCS.experiments[0]!.frontMatter,
    id: 'E0050-resolved',
    slug: 'resolved',
    title: 'resolved investigation',
    status: 'RESOLVED' as const,
    archived: false,
  },
  effectiveUpdatedAt: '2026-05-04T00:00:00+08:00',
}

describe('ExperimentCardGrid — v4 manual status pill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('card pill renders the manual ExperimentStatus from frontmatter (OPEN, RESOLVED)', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [SAMPLE_DOCS.experiments[0]!, RESOLVED_DOC],
    } as never)
    renderWithQuery(<ExperimentCardGrid project={PROJECT} />)
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'E0001-fsdp' })).toBeInTheDocument(),
    )

    // Pill text mirrors the enum values; both are exposed.
    expect(screen.getAllByText('OPEN').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('RESOLVED').length).toBeGreaterThanOrEqual(1)
  })
})
