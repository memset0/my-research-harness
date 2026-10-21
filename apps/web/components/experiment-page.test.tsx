import { screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ApiError, fetchExperimentDoc } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { ExperimentPage } from './experiment-page'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchExperimentDoc: vi.fn() }
})

it('says an Experiment missing from the published catalog is not refreshed', async () => {
  vi.mocked(fetchExperimentDoc).mockRejectedValue(
    new ApiError(404, 'Not refreshed', 'NOT_REFRESHED'),
  )
  renderWithQuery(
    <ExperimentPage project="project-a" experimentId="E0002-next" initialOpenRun={null} />,
  )
  expect(await screen.findByText('Not refreshed: E0002-next')).toBeInTheDocument()
  expect(screen.queryByText(/Failed to load experiment/)).not.toBeInTheDocument()
})
