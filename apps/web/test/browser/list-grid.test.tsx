// v3-spec-sync task 2.3.3 — project list grid renders v3 exp docs
//
// Decision: vitest + RTL. The component reads `fetchExperimentDocs` via
// useQuery; we mock the fetcher and assert the rendered DOM contains
// one Card per exp doc.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectRefSchema } from '@memon/core'
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

import { fetchExperimentDocs } from '../../lib/api'

const SAMPLE_DOCS = {
  experiments: [
    {
      id: 'E0001-fsdp',
      project: 'project-a',
      path: '/p/a/docs/experiments/E0001-fsdp.md',
      mtime: 1000,
      readmeMtime: 1000,
      frontMatter: {
        id: 'E0001-fsdp',
        slug: 'fsdp',
        title: 'FSDP collective overlap study',
        status: 'OPEN' as const,
        archived: false,
        runs: ['fsdp-260501-100000', 'fsdp-260502-150000'],
        hypotheses: ['H0007'],
        tags: ['moe'],
        createdAt: '2026-05-01T08:00:00+08:00',
        updatedAt: '2026-05-02T18:00:00+08:00',
      },
      sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
      warningsRaw: null,
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-05-01T08:00:00+08:00',
      effectiveUpdatedAt: '2026-05-02T18:00:00+08:00',
    },
    {
      id: 'E0002-attention',
      project: 'project-a',
      path: '/p/a/docs/experiments/E0002-attention.md',
      mtime: 2000,
      readmeMtime: 2000,
      frontMatter: {
        id: 'E0002-attention',
        slug: 'attention',
        title: 'Attention cache study',
        status: 'OPEN' as const,
        archived: false,
        runs: [],
        hypotheses: [],
        tags: [],
        createdAt: '2026-05-03T08:00:00+08:00',
        updatedAt: '2026-05-03T08:00:00+08:00',
      },
      sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
      warningsRaw: null,
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-05-03T08:00:00+08:00',
      effectiveUpdatedAt: '2026-05-03T08:00:00+08:00',
    },
  ],
}

describe('ExperimentCardGrid — list grid renders v3 exp docs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchExperimentDocs).mockResolvedValue(SAMPLE_DOCS)
  })

  it('renders one card per exp doc with id + title visible', async () => {
    renderWithQuery(<ExperimentCardGrid project="project-a" />)

    await waitFor(() => {
      expect(screen.getByText('E0001-fsdp')).toBeInTheDocument()
      expect(screen.getByText('E0002-attention')).toBeInTheDocument()
    })
    expect(screen.getByText('FSDP collective overlap study')).toBeInTheDocument()
    expect(screen.getByText('Attention cache study')).toBeInTheDocument()
  })

  it('renders no Run counts, Run ids, or roster rows', async () => {
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    await waitFor(() => {
      expect(screen.getByText('E0001-fsdp')).toBeInTheDocument()
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
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    renderWithQuery(<ExperimentCardGrid project={project} />)
    await waitFor(() => expect(screen.getByText('E0001-fsdp')).toBeInTheDocument())

    expect(fetchExperimentDocs).toHaveBeenCalledWith(project)
    const links = screen.getAllByRole('link', { name: /E0001-fsdp|FSDP collective overlap study/ })
    expect(links[0]).toHaveAttribute('href', '/h/host-a/p/project-a/e/E0001-fsdp')
    expect(localStorage.getItem('memon:list:host-a:project-a:show-archived')).toBe('0')
  })
})

// ---------- v4 lifecycle-frontmatter additions (task 10.8) ----------

const ARCHIVED_DOC = {
  id: 'E0099-old-thing',
  project: 'project-a',
  path: '/p/a/docs/experiments/E0099-old-thing.md',
  mtime: 99,
  readmeMtime: 99,
  frontMatter: {
    id: 'E0099-old-thing',
    slug: 'old-thing',
    title: 'old archived investigation',
    status: 'ABANDONED' as const,
    archived: true,
    runs: [],
    hypotheses: [],
    tags: [],
    createdAt: '2026-04-01T00:00:00+08:00',
    updatedAt: '2026-04-15T00:00:00+08:00',
  },
  sections: { motivation: null, method: null, plan: null, conclusion: null, caveats: null },
  warningsRaw: null,
  parseErrors: [],
  parseWarnings: [],
  effectiveCreatedAt: '2026-04-01T00:00:00+08:00',
  effectiveUpdatedAt: '2026-04-15T00:00:00+08:00',
}

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
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    await waitFor(() => expect(screen.getByText('E0001-fsdp')).toBeInTheDocument())

    // Pill text mirrors the enum values; both are exposed.
    expect(screen.getAllByText('OPEN').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('RESOLVED').length).toBeGreaterThanOrEqual(1)
  })
})

describe('ExperimentCardGrid — v4 archived overlay + listing modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset localStorage so each test starts with the unchecked default.
    localStorage.clear()
  })

  it('default unchecked: archived items hidden from active section, "Show N archived" affordance shown', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [...SAMPLE_DOCS.experiments, ARCHIVED_DOC],
    } as never)
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    await waitFor(() => expect(screen.getByText('E0001-fsdp')).toBeInTheDocument())

    // Active items present
    expect(screen.getByText('E0001-fsdp')).toBeInTheDocument()
    expect(screen.getByText('E0002-attention')).toBeInTheDocument()
    // Archived item NOT in the active section.
    expect(screen.queryByText('old archived investigation')).not.toBeInTheDocument()
    // Affordance present (singular).
    expect(screen.getByText(/Show 1 archived experiment/)).toBeInTheDocument()
  })

  it('clicking the affordance reveals the archived bucket below', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [...SAMPLE_DOCS.experiments, ARCHIVED_DOC],
    } as never)
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    await waitFor(() => expect(screen.getByText('E0001-fsdp')).toBeInTheDocument())

    const reveal = screen.getByText(/Show 1 archived experiment/)
    await userEvent.click(reveal)

    // Now the archived item is rendered.
    expect(screen.getByText('old archived investigation')).toBeInTheDocument()
    // Affordance flips to "Hide".
    expect(screen.getByText(/Hide 1 archived experiment/)).toBeInTheDocument()
  })

  it('checkbox checked: archived + active interleaved, no bottom-of-list affordance', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [...SAMPLE_DOCS.experiments, ARCHIVED_DOC],
    } as never)
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    await waitFor(() => expect(screen.getByText('E0001-fsdp')).toBeInTheDocument())

    const checkbox = screen.getByRole('checkbox', { name: /Show archived/i })
    await userEvent.click(checkbox)

    // All three rendered.
    expect(screen.getByText('E0001-fsdp')).toBeInTheDocument()
    expect(screen.getByText('E0002-attention')).toBeInTheDocument()
    expect(screen.getByText('old archived investigation')).toBeInTheDocument()
    // Bottom affordance hidden.
    expect(screen.queryByText(/Show 1 archived experiment/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Hide 1 archived experiment/)).not.toBeInTheDocument()
  })

  it('archived card has the desaturated overlay (opacity-60 + aria-label "archived")', async () => {
    vi.mocked(fetchExperimentDocs).mockResolvedValue({
      experiments: [ARCHIVED_DOC],
    } as never)
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    // First reveal the bucket (default checkbox is unchecked).
    await waitFor(() => expect(screen.getByText(/Show 1 archived experiment/)).toBeInTheDocument())
    await userEvent.click(screen.getByText(/Show 1 archived experiment/))

    const card = screen.getByLabelText(/E0099-old-thing.*archived/)
    expect(card.className).toMatch(/opacity-60/)
  })
})
