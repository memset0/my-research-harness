import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { fetchExperimentDocs } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { ExperimentCardGrid } from './experiment-card-grid'

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  fetchExperimentDocs: vi.fn(),
}))
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

it('filters by projected status while keeping lifecycle warnings and retired visibility', async () => {
  const row = (id: string, status: string, displayStatus: string, runningRunCount: number) => ({
    id,
    project: 'project-a',
    readmeMtime: 1,
    displayStatus,
    runningRunCount,
    frontMatter: {
      id,
      slug: id,
      title: id,
      status,
      archived: false,
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
    runCount: 2,
    hypothesisCount: 0,
    openWarningCount: 0,
    parseErrors: [],
    parseWarnings: [],
    effectiveCreatedAt: '',
    effectiveUpdatedAt: '',
  })
  vi.mocked(fetchExperimentDocs).mockResolvedValue({
    experiments: [
      row('E0001-active', 'ACTIVE', 'RUNNING', 1),
      row('E0002-paused', 'PAUSED', 'PAUSED', 2),
      row('E0003-retired', 'RETIRED', 'RETIRED', 0),
    ],
  } as never)
  renderWithQuery(<ExperimentCardGrid project="project-a" />)
  await screen.findByText('RUNNING')
  expect(screen.getByText('2 Runs still running')).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'E0003-retired (retired)' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('combobox', { name: 'Filter experiment status' }))
  await userEvent.click(screen.getByRole('option', { name: 'RETIRED' }))
  await waitFor(() =>
    expect(screen.getByRole('article', { name: 'E0003-retired (retired)' })).toBeInTheDocument(),
  )
  expect(screen.queryByRole('article', { name: 'E0001-active' })).not.toBeInTheDocument()
})
