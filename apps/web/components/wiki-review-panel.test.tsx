import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'
import { WikiReviewPanel } from './wiki-review-panel'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchGitCommit: vi.fn(),
    fetchWikiReview: vi.fn(),
    markWikiReview: vi.fn(),
    unmarkWikiReview: vi.fn(),
  }
})
vi.mock('./file-row', () => ({
  FileRow: ({ entry }: { entry: { path: string } }) => <div data-testid="review-file">{entry.path}</div>,
}))

import {
  fetchGitCommit,
  fetchWikiReview,
  markWikiReview,
  unmarkWikiReview,
  type WikiReviewResponse,
} from '../lib/api'

const C1 = '1'.repeat(40)
const C2 = '2'.repeat(40)
const C3 = '3'.repeat(40)

function reviewResponse(verified: string[]): WikiReviewResponse {
  return {
    verifiedThrough: verified.at(-1) ?? null,
    commits: [C1, C2, C3].map((sha, index) => ({
      sha,
      authoredAt: `2026-05-0${index + 1}T08:00:00+00:00`,
      subject: `wiki change ${index + 1}`,
      pages: [`W000${index + 1}`],
      verified: verified.includes(sha),
      verifiedAt: verified.includes(sha) ? `2026-05-0${index + 1}T09:00:00+00:00` : null,
      note: null,
    })),
  }
}

describe('WikiReviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchGitCommit).mockResolvedValue({
      enabled: true,
      sha: C2,
      shortSha: C2.slice(0, 8),
      subject: 'change',
      body: '',
      authorName: 'Researcher',
      authorEmail: 'researcher@example.test',
      authorDate: '2026-05-02T08:00:00+00:00',
      parents: [],
      files: [
        { path: 'docs/wiki/finding/W0002-change.md', status: 'modified' },
        { path: 'src/unrelated.ts', status: 'modified' },
      ],
    })
  })

  it('previews and verifies only the oldest unverified wiki commit', async () => {
    vi.mocked(fetchWikiReview).mockResolvedValue(reviewResponse([C1]))
    vi.mocked(markWikiReview).mockResolvedValue(reviewResponse([C1, C2]))

    renderWithQuery(<WikiReviewPanel project="project-a" open onOpenChange={() => {}} />)

    const verifyNext = await screen.findByRole('button', { name: `Verify next (${C2.slice(0, 8)})` })
    await userEvent.click(verifyNext)
    expect(await screen.findByText('docs/wiki/finding/W0002-change.md')).toBeInTheDocument()
    expect(screen.queryByText('src/unrelated.ts')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm verify' }))
    await waitFor(() => expect(markWikiReview).toHaveBeenCalledWith('project-a', C2))
  })

  it('names cascading newer marks before unverifying', async () => {
    vi.mocked(fetchWikiReview).mockResolvedValue(reviewResponse([C1, C2]))
    vi.mocked(unmarkWikiReview).mockResolvedValue(reviewResponse([]))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderWithQuery(<WikiReviewPanel project="project-a" open onOpenChange={() => {}} />)

    const buttons = await screen.findAllByRole('button', { name: 'Unverify' })
    await userEvent.click(buttons[0]!)

    expect(confirm).toHaveBeenCalledWith(
      `Unverifying ${C1.slice(0, 8)} also removes 1 newer mark(s). Continue?`,
    )
    await waitFor(() => expect(unmarkWikiReview).toHaveBeenCalledWith('project-a', C1))
  })
})
