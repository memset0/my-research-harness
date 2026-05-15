import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('../lib/api', () => ({
  fetchGitStatus: vi.fn(),
  fetchGitStatusFiles: vi.fn(),
  fetchGitDiff: vi.fn(),
}))

import {
  fetchGitDiff,
  fetchGitStatus,
  fetchGitStatusFiles,
  type GitDiffResponse,
  type GitStatusFiles,
} from '../lib/api'
import { GitDiffDialog } from './git-diff-dialog'

const STATUS = {
  enabled: true as const,
  branch: 'main',
  detached: false,
  sha: 'abcdef0',
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  staged: 1,
  unstaged: 2,
  untracked: 1,
  dirty: true,
}

const FILES: GitStatusFiles = {
  enabled: true,
  branch: 'main',
  detached: false,
  sha: 'abcdef0',
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  staged: [{ path: 'staged.txt', status: 'modified' }],
  unstaged: [
    { path: 'unstaged-a.txt', status: 'modified' },
    { path: 'unstaged-b.txt', status: 'modified' },
  ],
  untracked: [{ path: 'new.txt', status: 'untracked' }],
}

const DIFF: GitDiffResponse = {
  ok: true,
  filename: 'unstaged-a.txt',
  status: 'modified',
  oldContent: 'old\n',
  newContent: 'new\n',
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(fetchGitStatus).mockResolvedValue(STATUS)
  vi.mocked(fetchGitStatusFiles).mockResolvedValue(FILES)
  vi.mocked(fetchGitDiff).mockResolvedValue(DIFF)
})
afterEach(() => {
  window.localStorage.clear()
})

describe('GitDiffDialog', () => {
  it('renders sections + counts when open=true', async () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() => {
      expect(screen.getByText(/Staged \(1\)/)).toBeInTheDocument()
      expect(screen.getByText(/Unstaged \(2\)/)).toBeInTheDocument()
      expect(screen.getByText(/Untracked \(1\)/)).toBeInTheDocument()
    })
    expect(fetchGitStatusFiles).toHaveBeenCalledTimes(1)
    expect(fetchGitStatusFiles).toHaveBeenCalledWith('project-a')
  })

  it('does not fetch the file list while open=false', () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open={false} onOpenChange={() => {}} />,
    )
    expect(fetchGitStatusFiles).not.toHaveBeenCalled()
    expect(fetchGitDiff).not.toHaveBeenCalled()
  })

  it('file rows are collapsed by default (no diff request fired)', async () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Staged \(1\)/)).toBeInTheDocument(),
    )
    // Dialog renders via Radix Portal — query `document.body`, not container.
    expect(document.body.querySelectorAll('[data-slot="file-diff"]').length).toBe(0)
    expect(
      document.body.querySelectorAll('[data-slot="file-diff-loading"]').length,
    ).toBe(0)
    expect(fetchGitDiff).not.toHaveBeenCalled()
  })

  it('expanding a row fires fetchGitDiff exactly once', async () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('unstaged-a.txt')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('unstaged-a.txt'))
    await waitFor(() => {
      expect(fetchGitDiff).toHaveBeenCalledWith(
        'project-a',
        'unstaged-a.txt',
        'unstaged',
        undefined,
      )
    })
  })

  it('collapsing and re-expanding does NOT re-fetch within a single session', async () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('unstaged-a.txt')).toBeInTheDocument(),
    )
    const row = screen.getByText('unstaged-a.txt')
    await userEvent.click(row) // expand
    await waitFor(() => expect(fetchGitDiff).toHaveBeenCalledTimes(1))
    await userEvent.click(row) // collapse
    await userEvent.click(row) // re-expand
    // Same query key → cache hit → still 1.
    expect(fetchGitDiff).toHaveBeenCalledTimes(1)
  })

  it('renders an empty section with "(none)" when its array is empty', async () => {
    vi.mocked(fetchGitStatusFiles).mockResolvedValue({
      ...FILES,
      untracked: [],
    })
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Untracked \(0\)/)).toBeInTheDocument(),
    )
    expect(screen.getByText('(none)')).toBeInTheDocument()
  })

  it('view-mode toggle persists across instances via the shared hook', async () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('unstaged-a.txt')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('unstaged-a.txt'))
    await waitFor(() =>
      expect(document.body.querySelector('[data-slot="file-diff"]')).not.toBeNull(),
    )
    expect(
      document.body.querySelector('[data-slot="file-diff"]')!.getAttribute('data-view-mode'),
    ).toBe('split')
    await userEvent.click(screen.getByRole('button', { name: 'inline' }))
    await waitFor(() => {
      expect(
        document.body.querySelector('[data-slot="file-diff"]')!.getAttribute('data-view-mode'),
      ).toBe('inline')
    })
  })

  it('renders the "View history" link when onOpenHistory is provided', async () => {
    const onOpenHistory = vi.fn()
    renderWithQuery(
      <GitDiffDialog
        project="project-a"
        open
        onOpenChange={() => {}}
        onOpenHistory={onOpenHistory}
      />,
    )
    await waitFor(() =>
      expect(
        document.body.querySelector('[data-slot="git-diff-dialog-history-link"]'),
      ).not.toBeNull(),
    )
    await userEvent.click(
      document.body.querySelector(
        '[data-slot="git-diff-dialog-history-link"]',
      ) as HTMLElement,
    )
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('omits the "View history" link when no onOpenHistory prop given', async () => {
    renderWithQuery(
      <GitDiffDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText(/Staged \(1\)/)).toBeInTheDocument(),
    )
    expect(
      document.body.querySelector('[data-slot="git-diff-dialog-history-link"]'),
    ).toBeNull()
  })
})
