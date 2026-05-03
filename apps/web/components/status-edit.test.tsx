import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  patchExperimentStatus: vi.fn(),
}))

import { patchExperimentStatus } from '../lib/api'
import { StatusEdit } from './status-edit'
import { toast } from 'sonner'

describe('StatusEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PATCH success → success toast + invalidate', async () => {
    vi.mocked(patchExperimentStatus).mockResolvedValue({ mtime: 2000 } as never)
    renderWithQuery(
      <StatusEdit id="exp-1" status="RUNNING" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const opt = await screen.findByRole('option', { name: 'FINISHED' })
    await userEvent.click(opt)
    await waitFor(() => {
      expect(patchExperimentStatus).toHaveBeenCalledWith({
        id: 'exp-1',
        status: 'FINISHED',
        expectedMtime: 1000,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/RUNNING.*FINISHED/))
  })

  it('PATCH 409 → error toast with reload action', async () => {
    vi.mocked(patchExperimentStatus).mockResolvedValue({
      error: { code: 'CONFLICT', message: 'mtime mismatch' },
    } as never)
    renderWithQuery(
      <StatusEdit id="exp-1" status="RUNNING" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const opt = await screen.findByRole('option', { name: 'FINISHED' })
    await userEvent.click(opt)
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    const callArgs = vi.mocked(toast.error).mock.calls[0]
    expect(callArgs?.[0]).toMatch(/conflict/i)
    // toast.error called with an options object that includes an `action`
    expect(callArgs?.[1]).toMatchObject({ action: { label: 'Reload' } })
  })
})
