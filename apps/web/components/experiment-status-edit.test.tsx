import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('../lib/api', () => ({
  ApiError: class extends Error {},
  patchExperimentStatusV4: vi.fn(),
}))

import { patchExperimentStatusV4 } from '../lib/api'
import { ExperimentStatusEdit } from './experiment-status-edit'
import { toast } from 'sonner'

describe('ExperimentStatusEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PATCH success → success toast + invalidate', async () => {
    vi.mocked(patchExperimentStatusV4).mockResolvedValue({ mtime: 2000 } as never)
    renderWithQuery(
      <ExperimentStatusEdit expId="E0001-foo" status="OPEN" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const opt = await screen.findByRole('option', { name: 'RESOLVED' })
    await userEvent.click(opt)
    await waitFor(() => {
      expect(patchExperimentStatusV4).toHaveBeenCalledWith({
        id: 'E0001-foo',
        status: 'RESOLVED',
        expectedMtime: 1000,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/OPEN.*RESOLVED/))
  })

  it('PATCH 200 with warning="archived" → success + warning toast', async () => {
    vi.mocked(patchExperimentStatusV4).mockResolvedValue({
      mtime: 2000,
      warning: 'archived',
    } as never)
    renderWithQuery(
      <ExperimentStatusEdit expId="E0001-foo" status="OPEN" archived={true} expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const opt = await screen.findByRole('option', { name: 'ABANDONED' })
    await userEvent.click(opt)
    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringMatching(/E0001-foo.*archived; modifying anyway/),
      )
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('PATCH 409 CONFLICT → error toast with reload action', async () => {
    vi.mocked(patchExperimentStatusV4).mockResolvedValue({
      error: { code: 'CONFLICT', message: 'mtime mismatch' },
    } as never)
    renderWithQuery(
      <ExperimentStatusEdit expId="E0001-foo" status="OPEN" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const opt = await screen.findByRole('option', { name: 'RESOLVED' })
    await userEvent.click(opt)
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    const callArgs = vi.mocked(toast.error).mock.calls[0]
    expect(callArgs?.[0]).toMatch(/conflict/i)
    expect(callArgs?.[1]).toMatchObject({ action: { label: 'Reload' } })
  })

  it('selecting same status is a noop (no API call)', async () => {
    renderWithQuery(
      <ExperimentStatusEdit expId="E0001-foo" status="OPEN" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const opt = await screen.findByRole('option', { name: 'OPEN' })
    await userEvent.click(opt)
    // Give it a tick to ensure no async work fires.
    await new Promise((r) => setTimeout(r, 50))
    expect(patchExperimentStatusV4).not.toHaveBeenCalled()
  })
})
