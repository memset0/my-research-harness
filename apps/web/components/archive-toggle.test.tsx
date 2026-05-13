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
  patchRunArchived: vi.fn(),
  patchExperimentArchived: vi.fn(),
}))

import { patchExperimentArchived, patchRunArchived } from '../lib/api'
import { ArchiveToggle } from './archive-toggle'
import { toast } from 'sonner'

describe('ArchiveToggle — disabled state (run hard rule)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('button is disabled when kind=run + archived=false + runStatus=RUNNING', () => {
    renderWithQuery(
      <ArchiveToggle kind="run" id="foo-1" archived={false} runStatus="RUNNING" />,
    )
    const btn = screen.getByRole('button', { name: 'Archive' })
    expect(btn).toBeDisabled()
  })

  it('button is enabled when kind=run + archived=false + runStatus=FINISHED', () => {
    renderWithQuery(
      <ArchiveToggle kind="run" id="foo-1" archived={false} runStatus="FINISHED" />,
    )
    expect(screen.getByRole('button', { name: 'Archive' })).not.toBeDisabled()
  })

  it('Unarchive is always enabled (even when status is RUNNING)', () => {
    renderWithQuery(
      <ArchiveToggle kind="run" id="foo-1" archived={true} runStatus="RUNNING" />,
    )
    expect(screen.getByRole('button', { name: 'Unarchive' })).not.toBeDisabled()
  })

  it('exp-side has no hard rule (button always enabled regardless of runStatus)', () => {
    renderWithQuery(
      <ArchiveToggle kind="exp" id="E0001-foo" archived={false} />,
    )
    expect(screen.getByRole('button', { name: 'Archive' })).not.toBeDisabled()
  })
})

describe('ArchiveToggle — success / error toasts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('success: archive run -> success toast + invalidate', async () => {
    vi.mocked(patchRunArchived).mockResolvedValue({
      ok: true,
      archived: true,
      mtime: 2000,
    } as never)
    renderWithQuery(
      <ArchiveToggle kind="run" id="foo-1" archived={false} runStatus="FINISHED" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => {
      expect(patchRunArchived).toHaveBeenCalledWith({
        id: 'foo-1',
        archived: true,
        expectedMtime: 1000,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Archived foo-1/))
  })

  it('success: unarchive exp -> success toast', async () => {
    vi.mocked(patchExperimentArchived).mockResolvedValue({
      ok: true,
      archived: false,
      mtime: 2000,
    } as never)
    renderWithQuery(
      <ArchiveToggle kind="exp" id="E0001-foo" archived={true} expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    await waitFor(() => {
      expect(patchExperimentArchived).toHaveBeenCalledWith({
        id: 'E0001-foo',
        archived: false,
        expectedMtime: 1000,
      })
    })
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/Unarchived E0001-foo/))
  })

  it('422 ARCHIVE_RUNNING_FORBIDDEN -> error toast', async () => {
    vi.mocked(patchRunArchived).mockResolvedValue({
      error: { code: 'ARCHIVE_RUNNING_FORBIDDEN', message: 'cannot archive a RUNNING run' },
    } as never)
    // Render with RUNNING but archived=true so unarchive is enabled and we
    // can simulate a write that races: client thinks it can archive but
    // server now says no. Easier: render a non-RUNNING run (button enabled)
    // and have the server return the 422 error anyway.
    renderWithQuery(
      <ArchiveToggle kind="run" id="foo-1" archived={false} runStatus="FINISHED" expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    const callArgs = vi.mocked(toast.error).mock.calls[0]
    expect(callArgs?.[0]).toMatch(/cannot archive a RUNNING run/i)
  })

  it('409 CONFLICT -> error toast with reload action', async () => {
    vi.mocked(patchExperimentArchived).mockResolvedValue({
      error: { code: 'CONFLICT', message: 'mtime mismatch' },
    } as never)
    renderWithQuery(
      <ArchiveToggle kind="exp" id="E0001-foo" archived={false} expectedMtime={1000} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled()
    })
    const callArgs = vi.mocked(toast.error).mock.calls[0]
    expect(callArgs?.[0]).toMatch(/conflict/i)
    expect(callArgs?.[1]).toMatchObject({ action: { label: 'Reload' } })
  })
})
