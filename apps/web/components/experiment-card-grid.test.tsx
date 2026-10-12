import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { type ExperimentListRow, fetchExperimentDocs } from '../lib/api'
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

function row(
  id: string,
  status: ExperimentListRow['frontMatter']['status'],
  displayStatus: ExperimentListRow['displayStatus'],
  runningRunCount = 0,
): ExperimentListRow {
  return {
    id,
    project: 'project-a',
    readmeMtime: 1,
    displayStatus,
    runningRunCount,
    frontMatter: {
      id,
      slug: id,
      title: `Research ${id}`,
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
  }
}

it('groups completed and running within ACTIVE, keeps paused warnings and reveals retired filters', async () => {
  vi.mocked(fetchExperimentDocs).mockResolvedValue({
    experiments: [
      row('E0001-active', 'ACTIVE', 'RUNNING', 1),
      row('E0002-paused', 'PAUSED', 'PAUSED', 2),
      row('E0003-retired', 'RETIRED', 'RETIRED'),
      row('E0004-done', 'ACTIVE', 'COMPLETED'),
    ],
  })
  const { container } = renderWithQuery(<ExperimentCardGrid project="project-a" />)
  await screen.findByText('RUNNING')
  const active = container.querySelector('[data-experiment-group="ACTIVE"]') as HTMLElement
  expect(within(active).getByText('COMPLETED')).toBeInTheDocument()
  expect(
    within(active)
      .getAllByRole('article')
      .map((e) => e.getAttribute('aria-label')),
  ).toEqual(['E0001-active', 'E0004-done'])
  expect(screen.getByText('2 Runs still running')).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'E0003-retired' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retired 1' }))
  expect(screen.getByRole('article', { name: 'E0003-retired' })).toBeInTheDocument()
  expect(screen.queryByRole('article', { name: 'E0001-active' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Active 2' }))
  expect(screen.getAllByRole('article')).toHaveLength(2)
  await userEvent.click(screen.getByRole('combobox', { name: 'Filter experiment status' }))
  await userEvent.click(screen.getByRole('option', { name: 'COMPLETED' }))
  expect(screen.getAllByRole('article')).toHaveLength(1)
})

it('search reaches distinct historical groups without mapping legacy RESOLVED to a modern lifecycle', async () => {
  const legacy = row('E0003-old', 'RESOLVED', 'RESOLVED')
  legacy.frontMatter.archived = true
  vi.mocked(fetchExperimentDocs).mockResolvedValue({
    experiments: [
      row('E0001-a', 'ARCHIVED', 'ARCHIVED'),
      row('E0002-b', 'RETIRED', 'RETIRED'),
      legacy,
    ],
  })
  renderWithQuery(<ExperimentCardGrid project="project-a" />)
  await screen.findByRole('button', { name: 'Archived experiments (1)' })
  expect(screen.queryAllByRole('article')).toHaveLength(0)
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search experiments' }), 'Research')
  expect(screen.getAllByRole('article')).toHaveLength(3)
  expect(screen.getByText('RESOLVED')).toBeInTheDocument()
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search experiments' }), ' missing')
  expect(screen.getByText('No experiments match these filters.')).toBeInTheDocument()
})

it('does not report a failed request as an empty project', async () => {
  vi.mocked(fetchExperimentDocs).mockRejectedValue(new Error('Unavailable'))
  renderWithQuery(<ExperimentCardGrid project="project-a" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load experiments')
  expect(screen.queryByText('No experiments yet.')).not.toBeInTheDocument()
})
