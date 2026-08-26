import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'
import { ExperimentCardGrid } from './experiment-card-grid'
import { TabBadge } from './tab-badge'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchExperimentDocs: vi.fn(),
    fetchAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }),
  }
})

import { fetchExperimentDocs } from '../lib/api'

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
