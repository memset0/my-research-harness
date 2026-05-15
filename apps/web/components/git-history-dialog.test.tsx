import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../test/utils'

vi.mock('../lib/api', () => ({
  fetchGitBranches: vi.fn(),
  fetchGitLog: vi.fn(),
  fetchGitCommit: vi.fn(),
  fetchGitDiff: vi.fn(),
}))

import {
  fetchGitBranches,
  fetchGitCommit,
  fetchGitDiff,
  fetchGitLog,
  type GitBranches,
  type GitCommitDetail,
  type GitDiffResponse,
  type GitLog,
} from '../lib/api'
import { GitHistoryDialog } from './git-history-dialog'

const BRANCHES: GitBranches = {
  enabled: true,
  current: 'main',
  detached: false,
  sha: 'abcdef0',
  branches: [
    { name: 'main', sha: 'abcdef0', isCurrent: true },
    { name: 'feature/x', sha: '1234567', isCurrent: false },
  ],
}

const LOG: GitLog = {
  enabled: true,
  commits: [
    {
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      subject: 'fix the bug',
      authorName: 'Hao',
      authorEmail: 'hao@example.com',
      authorDate: '2026-05-15T12:00:00+08:00',
      parents: ['b'.repeat(40)],
    },
    {
      sha: 'b'.repeat(40),
      shortSha: 'bbbbbbb',
      subject: 'add feature',
      authorName: 'Hao',
      authorEmail: 'hao@example.com',
      authorDate: '2026-05-14T11:00:00+08:00',
      parents: ['c'.repeat(40)],
    },
  ],
}

const COMMIT_A: Extract<GitCommitDetail, { enabled: true }> = {
  enabled: true,
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  subject: 'fix the bug',
  body: 'longer description',
  authorName: 'Hao',
  authorEmail: 'hao@example.com',
  authorDate: '2026-05-15T12:00:00+08:00',
  parents: ['b'.repeat(40)],
  files: [
    { path: 'app/page.tsx', status: 'modified' },
    { path: 'lib/util.ts', status: 'added' },
  ],
}

const DIFF: GitDiffResponse = {
  ok: true,
  filename: 'app/page.tsx',
  status: 'modified',
  oldContent: 'old\n',
  newContent: 'new\n',
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  vi.mocked(fetchGitBranches).mockResolvedValue(BRANCHES)
  vi.mocked(fetchGitLog).mockResolvedValue(LOG)
  vi.mocked(fetchGitCommit).mockResolvedValue(COMMIT_A)
  vi.mocked(fetchGitDiff).mockResolvedValue(DIFF)
})
afterEach(() => {
  window.localStorage.clear()
})

describe('GitHistoryDialog', () => {
  it('does not fetch anything while open=false', () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open={false} onOpenChange={() => {}} />,
    )
    expect(fetchGitBranches).not.toHaveBeenCalled()
    expect(fetchGitLog).not.toHaveBeenCalled()
  })

  it('opens with the shell classes spec demands', async () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() => {
      const content = document.body.querySelector('[data-slot="git-history-dialog"]')
      expect(content).not.toBeNull()
      const cls = content!.className
      expect(cls).toMatch(/w-\[min\(90vw,1600px\)\]/)
      expect(cls).toMatch(/max-w-none/)
      expect(cls).toMatch(/sm:max-w-none/)
      expect(cls).toMatch(/max-h-\[90vh\]/)
    })
  })

  it('renders commit list after branches + log resolve', async () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('fix the bug')).toBeInTheDocument(),
    )
    expect(screen.getByText('add feature')).toBeInTheDocument()
    expect(fetchGitBranches).toHaveBeenCalledWith('project-a')
    expect(fetchGitLog).toHaveBeenCalledWith('project-a', 'main', 100)
  })

  it('right pane shows placeholder until a commit is clicked', async () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('fix the bug')).toBeInTheDocument(),
    )
    expect(screen.getByText(/Select a commit/i)).toBeInTheDocument()
    expect(fetchGitCommit).not.toHaveBeenCalled()
  })

  it('clicking a commit fetches its detail and renders file rows', async () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('fix the bug')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() => {
      expect(fetchGitCommit).toHaveBeenCalledWith('project-a', 'a'.repeat(40))
    })
    expect(screen.getByText('app/page.tsx')).toBeInTheDocument()
    expect(screen.getByText('lib/util.ts')).toBeInTheDocument()
  })

  it('expanding a file row fetches the commit-side diff', async () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('fix the bug')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() =>
      expect(screen.getByText('app/page.tsx')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('app/page.tsx'))
    await waitFor(() => {
      expect(fetchGitDiff).toHaveBeenCalledWith(
        'project-a',
        'app/page.tsx',
        'commit',
        'a'.repeat(40),
      )
    })
  })

  it('refresh invalidates branches + log but not the cached commit', async () => {
    renderWithQuery(
      <GitHistoryDialog project="project-a" open onOpenChange={() => {}} />,
    )
    await waitFor(() =>
      expect(screen.getByText('fix the bug')).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() => expect(fetchGitCommit).toHaveBeenCalledTimes(1))
    // Baselines after the initial open + commit click:
    expect(fetchGitBranches).toHaveBeenCalledTimes(1)
    expect(fetchGitLog).toHaveBeenCalledTimes(1)

    const refresh = document.body.querySelector('[data-slot="git-history-refresh"]') as HTMLElement
    expect(refresh).not.toBeNull()
    await userEvent.click(refresh)

    await waitFor(() => expect(fetchGitBranches).toHaveBeenCalledTimes(2))
    expect(fetchGitLog).toHaveBeenCalledTimes(2)
    // The previously-fetched commit detail MUST stay cached (refresh does
    // not invalidate `['git-commit', ...]`).
    expect(fetchGitCommit).toHaveBeenCalledTimes(1)
  })
})
