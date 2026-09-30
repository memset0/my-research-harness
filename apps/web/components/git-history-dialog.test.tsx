import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  fetchGitBranches: vi.fn(),
  fetchGitLog: vi.fn(),
  fetchGitCommit: vi.fn(),
  fetchGitDiff: vi.fn(),
  fetchCommitMarks: vi.fn(),
  fetchSubmodules: vi.fn(),
  setCommitMark: vi.fn(),
  deleteCommitMark: vi.fn(),
}))

import {
  fetchCommitMarks,
  fetchGitBranches,
  fetchGitCommit,
  fetchGitDiff,
  fetchGitLog,
  fetchSubmodules,
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
  vi.mocked(fetchCommitMarks).mockResolvedValue({ marks: [], parseWarnings: [] })
  vi.mocked(fetchSubmodules).mockResolvedValue({ enabled: true, submodules: [] })
})
afterEach(() => {
  window.localStorage.clear()
})

describe('GitHistoryDialog', () => {
  it('does not fetch anything while open=false', () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open={false} onOpenChange={() => {}} />)
    expect(fetchGitBranches).not.toHaveBeenCalled()
    expect(fetchGitLog).not.toHaveBeenCalled()
  })

  it('opens with the shell classes spec demands', async () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
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
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    expect(screen.getByText('add feature')).toBeInTheDocument()
    expect(fetchGitBranches).toHaveBeenCalledWith('project-a', undefined)
    expect(fetchGitLog).toHaveBeenCalledWith('project-a', 'main', 100, undefined)
  })

  it('right pane shows placeholder until a commit is clicked', async () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    expect(screen.getByText(/Select a commit/i)).toBeInTheDocument()
    expect(fetchGitCommit).not.toHaveBeenCalled()
  })

  it('clicking a commit fetches its detail and renders file rows', async () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() => {
      expect(fetchGitCommit).toHaveBeenCalledWith('project-a', 'a'.repeat(40), undefined)
    })
    expect(screen.getByText('app/page.tsx')).toBeInTheDocument()
    expect(screen.getByText('lib/util.ts')).toBeInTheDocument()
  })

  it('expanding a file row fetches the commit-side diff', async () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() => expect(screen.getByText('app/page.tsx')).toBeInTheDocument())
    await userEvent.click(screen.getByText('app/page.tsx'))
    await waitFor(() => {
      expect(fetchGitDiff).toHaveBeenCalledWith('project-a', 'app/page.tsx', 'commit', {
        sha: 'a'.repeat(40),
        submodule: undefined,
        from: undefined,
        to: undefined,
      })
    })
  })

  it('refresh invalidates branches + log but not the cached commit', async () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
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

  it('every commit row has a commit-mark-badge (verified for marked, none otherwise)', async () => {
    vi.mocked(fetchCommitMarks).mockResolvedValue({
      marks: [
        {
          sha: 'a'.repeat(40),
          status: 'verified',
          note: '',
          updatedAt: '2026-05-15T12:00:00+08:00',
          submodule: '',
        },
      ],
      parseWarnings: [],
    })
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    const badges = document.body.querySelectorAll('[data-slot="commit-mark-badge"]')
    expect(badges.length).toBe(2)
    const statuses = Array.from(badges).map((b) => b.getAttribute('data-status'))
    expect(statuses).toContain('verified')
    expect(statuses).toContain('none')
  })

  it('selecting a commit renders a commit-mark-editor in the detail pane', async () => {
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() => {
      const editor = document.body.querySelector('[data-slot="commit-mark-editor"]')
      expect(editor).not.toBeNull()
      expect(editor!.getAttribute('data-sha')).toBe('a'.repeat(40))
    })
  })

  it('switching to a different commit with a dirty note prompts confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
      await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
      // Select the first commit so an editor is mounted.
      await userEvent.click(screen.getByText('fix the bug'))
      const note = await waitFor(() => {
        const el = document.body.querySelector(
          '[data-slot="commit-mark-note"]',
        ) as HTMLTextAreaElement | null
        expect(el).not.toBeNull()
        return el!
      })
      // Dirty the note (no save).
      await userEvent.type(note, 'unsaved draft')
      // Now click the OTHER commit row.
      await userEvent.click(screen.getByText('add feature'))
      expect(confirmSpy).toHaveBeenCalledTimes(1)
      expect(confirmSpy.mock.calls[0]![0]).toMatch(/unsaved/i)
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('cancelling the confirm keeps the current selection', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
      await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
      await userEvent.click(screen.getByText('fix the bug'))
      const note = await waitFor(() => {
        const el = document.body.querySelector(
          '[data-slot="commit-mark-note"]',
        ) as HTMLTextAreaElement | null
        expect(el).not.toBeNull()
        return el!
      })
      await userEvent.type(note, 'unsaved')
      const fetchCallsBefore = vi.mocked(fetchGitCommit).mock.calls.length
      await userEvent.click(screen.getByText('add feature'))
      // No NEW git-commit fetch fired (user cancelled).
      expect(vi.mocked(fetchGitCommit).mock.calls.length).toBe(fetchCallsBefore)
    } finally {
      confirmSpy.mockRestore()
    }
  })

  it('renders <SubmoduleBumpRow /> for submoduleBump entries matching a known submodule path', async () => {
    vi.mocked(fetchSubmodules).mockResolvedValue({
      enabled: true,
      submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
    })
    vi.mocked(fetchGitCommit).mockResolvedValue({
      ...COMMIT_A,
      files: [
        { path: 'app/page.tsx', status: 'modified' },
        {
          path: 'vendor/foo',
          status: 'modified',
          submoduleBump: { fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) },
        },
      ],
    })
    renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
    await userEvent.click(screen.getByText('fix the bug'))
    await waitFor(() =>
      expect(document.body.querySelector('[data-slot="submodule-bump-row"]')).not.toBeNull(),
    )
    // The submodule-bump row replaces the FileRow for that entry.
    const fileRowTriggers = document.body.querySelectorAll('[data-slot="file-row-trigger"]')
    // The non-submodule file STILL renders as a FileRow.
    expect(fileRowTriggers.length).toBe(1)
    // The header carries both short SHAs.
    const bumpRow = document.body.querySelector('[data-slot="submodule-bump-row"]')!
    expect(bumpRow.textContent).toMatch(/aaaaaaa → bbbbbbb/)
  })

  it('switching without a dirty note does NOT prompt', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    try {
      renderWithQuery(<GitHistoryDialog project="project-a" open onOpenChange={() => {}} />)
      await waitFor(() => expect(screen.getByText('fix the bug')).toBeInTheDocument())
      await userEvent.click(screen.getByText('fix the bug'))
      // Wait for editor to mount but DO NOT type into the note.
      await waitFor(() =>
        expect(document.body.querySelector('[data-slot="commit-mark-editor"]')).not.toBeNull(),
      )
      await userEvent.click(screen.getByText('add feature'))
      expect(confirmSpy).not.toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
