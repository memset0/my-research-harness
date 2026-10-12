import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchExperimentResearch, mutateExperimentResearch } from '../lib/api'
import { resultsDocument, variant } from '../lib/experiment-results/fixtures.test-helpers'
import { renderWithHeartbeat } from '../test/utils'
import { ExperimentResearchControls } from './experiment-research-controls'

vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  fetchExperimentResearch: vi.fn(),
  mutateExperimentResearch: vi.fn(),
}))
const research = {
  current_version: 2,
  selected_version: 2,
  versions: [
    { version: 1, started_at: '2026-10-01T09:00:00+08:00', reason: 'Initial' },
    { version: 2, started_at: '2026-10-02T09:00:00+08:00', reason: 'Corrected' },
  ],
  run_versions: {},
}
const summary = { ...resultsDocument([variant('V0001')]), research }
beforeEach(() => {
  vi.mocked(fetchExperimentResearch)
    .mockReset()
    .mockResolvedValue({ mtime: 1, hash: 'old', research })
  vi.mocked(mutateExperimentResearch).mockReset()
})
describe('research controls', () => {
  it('keeps the reason on conflict and refreshes the lock only on an explicit retry', async () => {
    vi.mocked(mutateExperimentResearch)
      .mockRejectedValueOnce(new Error('Conflict: refresh before retrying'))
      .mockResolvedValue(undefined)
    renderWithHeartbeat(
      <ExperimentResearchControls
        project="project-a"
        experimentId="E0001-a"
        summary={summary}
        onVersion={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Manage research' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled())
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct measurement' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Reason')).toHaveValue('Correct measurement')
    expect(mutateExperimentResearch).toHaveBeenCalledTimes(1)
    vi.mocked(fetchExperimentResearch).mockResolvedValue({ mtime: 2, hash: 'new', research })
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest state' }))
    await waitFor(() => expect(fetchExperimentResearch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(mutateExperimentResearch).toHaveBeenLastCalledWith(
        'project-a',
        'E0001-a',
        expect.objectContaining({
          expectedMtime: 2,
          expectedHash: 'new',
          reason: 'Correct measurement',
          expectedVersion: 2,
        }),
      ),
    )
  })
})
