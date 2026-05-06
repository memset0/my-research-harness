// v3-spec-sync task 2.3.3 — project list grid renders v3 exp docs
//
// Decision: vitest + RTL. The component reads `fetchExperimentDocs` via
// useQuery; we mock the fetcher and assert the rendered DOM contains
// one Card per exp doc.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../utils'
import { ExperimentCardGrid } from '../../components/experiment-card-grid'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchExperimentDocs: vi.fn(),
    fetchAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }),
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
      frontMatter: {
        id: 'E0001-fsdp',
        slug: 'fsdp',
        title: 'FSDP collective overlap study',
        runs: ['fsdp-260501-100000', 'fsdp-260502-150000'],
        hypotheses: ['H0007'],
        tags: ['moe'],
        createdAt: '2026-05-01T08:00:00+08:00',
        updatedAt: '2026-05-02T18:00:00+08:00',
      },
      sections: { motivation: null, method: null, conclusion: null, caveats: null },
      warningsRaw: null,
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-05-01T08:00:00+08:00',
      effectiveUpdatedAt: '2026-05-02T18:00:00+08:00',
      memberRuns: [
        {
          id: 'fsdp-260501-100000',
          status: 'FINISHED',
          createdAt: '2026-05-01T10:00:00+08:00',
          updatedAt: '2026-05-01T11:30:00+08:00',
          finishedAt: '2026-05-01T11:30:00+08:00',
          host: 'gpu-04',
          gpus: [0, 1, 2, 3],
        },
        {
          id: 'fsdp-260502-150000',
          status: 'RUNNING',
          createdAt: '2026-05-02T15:00:00+08:00',
          updatedAt: '2026-05-02T18:00:00+08:00',
          finishedAt: null,
          host: 'gpu-04',
          gpus: [0],
        },
      ],
    },
    {
      id: 'E0002-attention',
      project: 'project-a',
      path: '/p/a/docs/experiments/E0002-attention.md',
      mtime: 2000,
      frontMatter: {
        id: 'E0002-attention',
        slug: 'attention',
        title: 'Attention cache study',
        runs: [],
        hypotheses: [],
        tags: [],
        createdAt: '2026-05-03T08:00:00+08:00',
        updatedAt: '2026-05-03T08:00:00+08:00',
      },
      sections: { motivation: null, method: null, conclusion: null, caveats: null },
      warningsRaw: null,
      parseErrors: [],
      parseWarnings: [],
      effectiveCreatedAt: '2026-05-03T08:00:00+08:00',
      effectiveUpdatedAt: '2026-05-03T08:00:00+08:00',
      memberRuns: [],
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

  it('renders both exps even when one has zero runs', async () => {
    renderWithQuery(<ExperimentCardGrid project="project-a" />)
    await waitFor(() => {
      expect(screen.getByText('E0001-fsdp')).toBeInTheDocument()
    })
    // E0002 has 0 runs — UI must not crash on the empty case.
    expect(screen.getByText('E0002-attention')).toBeInTheDocument()
  })
})
