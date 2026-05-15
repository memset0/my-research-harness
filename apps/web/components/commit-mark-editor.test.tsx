import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('../lib/api', () => ({
  setCommitMark: vi.fn(),
  deleteCommitMark: vi.fn(),
}))

import {
  deleteCommitMark,
  setCommitMark,
  type CommitMark,
} from '../lib/api'
import { CommitMarkEditor } from './commit-mark-editor'

const EXISTING: CommitMark = {
  sha: 'abc1234',
  status: 'verified',
  note: 'looked good',
  updatedAt: '2026-05-15T12:00:00+08:00',
  submodule: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(setCommitMark).mockResolvedValue({ mark: EXISTING })
  vi.mocked(deleteCommitMark).mockResolvedValue({ deleted: true })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('CommitMarkEditor', () => {
  // ---- Status toggle auto-save ----
  it('clicking a status toggle auto-fires setCommitMark with the current note', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const suspiciousBtn = document.body.querySelector(
      '[data-slot="commit-mark-option-suspicious"]',
    ) as HTMLButtonElement
    await userEvent.click(suspiciousBtn)
    await waitFor(() => {
      expect(setCommitMark).toHaveBeenCalledWith(
        'project-a',
        'abc1234',
        { status: 'suspicious', note: 'looked good' },
        undefined,
      )
    })
  })

  it('status toggle also persists the current note draft', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={null} />,
    )
    const note = document.body.querySelector(
      '[data-slot="commit-mark-note"]',
    ) as HTMLTextAreaElement
    await userEvent.type(note, 'needs review')
    const verifiedBtn = document.body.querySelector(
      '[data-slot="commit-mark-option-verified"]',
    ) as HTMLButtonElement
    await userEvent.click(verifiedBtn)
    await waitFor(() => {
      expect(setCommitMark).toHaveBeenCalledWith(
        'project-a',
        'abc1234',
        { status: 'verified', note: 'needs review' },
        undefined,
      )
    })
  })

  // ---- Save button (manual save for note-only edits) ----
  it('Save is disabled while form is pristine (existing mark, no edits)', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const save = document.body.querySelector(
      '[data-slot="commit-mark-save"]',
    ) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('typing in the note alone does NOT fire setCommitMark but enables Save', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const note = document.body.querySelector(
      '[data-slot="commit-mark-note"]',
    ) as HTMLTextAreaElement
    await userEvent.type(note, ' more')
    expect(setCommitMark).not.toHaveBeenCalled()
    const save = document.body.querySelector(
      '[data-slot="commit-mark-save"]',
    ) as HTMLButtonElement
    expect(save.disabled).toBe(false)
  })

  it('Save fires setCommitMark with the current status + note', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const note = document.body.querySelector(
      '[data-slot="commit-mark-note"]',
    ) as HTMLTextAreaElement
    await userEvent.clear(note)
    await userEvent.type(note, 'still good')
    const save = document.body.querySelector(
      '[data-slot="commit-mark-save"]',
    ) as HTMLButtonElement
    await userEvent.click(save)
    await waitFor(() => {
      expect(setCommitMark).toHaveBeenCalledWith(
        'project-a',
        'abc1234',
        { status: 'verified', note: 'still good' },
        undefined,
      )
    })
  })

  // ---- Ctrl+S in textarea ----
  it('Ctrl+S in the textarea fires save when the form is dirty', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const note = document.body.querySelector(
      '[data-slot="commit-mark-note"]',
    ) as HTMLTextAreaElement
    await userEvent.type(note, ' more')
    // Focus + press Ctrl+S
    note.focus()
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => {
      expect(setCommitMark).toHaveBeenCalledWith(
        'project-a',
        'abc1234',
        { status: 'verified', note: 'looked good more' },
        undefined,
      )
    })
  })

  it('Ctrl+S is a no-op when the form is clean', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const note = document.body.querySelector(
      '[data-slot="commit-mark-note"]',
    ) as HTMLTextAreaElement
    note.focus()
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(setCommitMark).not.toHaveBeenCalled()
  })

  // ---- Clear ----
  it('Clear button only renders when a mark exists', () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={null} />,
    )
    expect(
      document.body.querySelector('[data-slot="commit-mark-clear"]'),
    ).toBeNull()
  })

  it('Clear fires deleteCommitMark', async () => {
    renderWithQuery(
      <CommitMarkEditor project="project-a" sha="abc1234" mark={EXISTING} />,
    )
    const clearBtn = document.body.querySelector(
      '[data-slot="commit-mark-clear"]',
    ) as HTMLButtonElement
    await userEvent.click(clearBtn)
    await waitFor(() => {
      expect(deleteCommitMark).toHaveBeenCalledWith(
        'project-a',
        'abc1234',
        undefined,
      )
    })
  })

  // ---- onDirtyChange ----
  it('onDirtyChange tracks note-draft divergence + convergence', async () => {
    const onDirtyChange = vi.fn()
    renderWithQuery(
      <CommitMarkEditor
        project="project-a"
        sha="abc1234"
        mark={EXISTING}
        onDirtyChange={onDirtyChange}
      />,
    )
    // Initial render: dirty=false
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalled())
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)

    const note = document.body.querySelector(
      '[data-slot="commit-mark-note"]',
    ) as HTMLTextAreaElement
    await userEvent.type(note, '!')
    await waitFor(() =>
      expect(onDirtyChange).toHaveBeenLastCalledWith(true),
    )

    // Backspace back to original
    await userEvent.type(note, '{Backspace}')
    await waitFor(() =>
      expect(onDirtyChange).toHaveBeenLastCalledWith(false),
    )
  })

  // ---- Optional onMutated callback ----
  it('invokes onMutated after a successful save', async () => {
    const onMutated = vi.fn()
    renderWithQuery(
      <CommitMarkEditor
        project="project-a"
        sha="abc1234"
        mark={null}
        onMutated={onMutated}
      />,
    )
    const verifiedBtn = document.body.querySelector(
      '[data-slot="commit-mark-option-verified"]',
    ) as HTMLButtonElement
    // Status click already auto-saves, so onMutated fires on its success.
    await userEvent.click(verifiedBtn)
    await waitFor(() => expect(onMutated).toHaveBeenCalledTimes(1))
  })
})
