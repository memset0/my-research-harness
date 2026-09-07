import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '../lib/api'
import { renderWithQuery } from '../test/utils'

// Only the reports list call is stubbed; everything else in lib/api (project
// helpers, query-key builders) keeps its real behaviour.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, fetchReports: vi.fn() }
})

// Rendered-markdown surface is irrelevant to the rail contract and drags in
// react-markdown + katex; keep it inert.
vi.mock('./markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

import { fetchReports } from '../lib/api'
import { InboxShell } from './inbox-shell'

const PROJECT = 'project-a'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('InboxShell reports rail — failed list is distinguishable from empty', () => {
  it('shows a retry affordance instead of the empty copy, and recovers on retry', async () => {
    vi.mocked(fetchReports).mockRejectedValueOnce(new Error('upstream 502'))

    renderWithQuery(<InboxShell kind="reports" project={PROJECT} selectedId={null} />)

    // Failure is surfaced, not disguised as an empty project.
    expect(await screen.findByText('failed to load reports')).toBeInTheDocument()
    expect(screen.getByText('upstream 502')).toBeInTheDocument()
    expect(screen.queryByText('no reports yet')).not.toBeInTheDocument()

    const retry = screen.getByRole('button', { name: 'Retry' })

    vi.mocked(fetchReports).mockResolvedValueOnce({
      reports: [
        {
          id: 'R0001',
          slug: 'first-report',
          title: 'First report',
          mtime: 1000,
          path: '/tmp/project-a/docs/reports/R0001-first-report.md',
        },
      ] as never,
    })

    await userEvent.click(retry)

    // Retry re-invokes the fetch and the recovered rows render.
    await waitFor(() => expect(vi.mocked(fetchReports)).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('First report')).toBeInTheDocument()
    expect(screen.queryByText('failed to load reports')).not.toBeInTheDocument()
  })

  it('shows the empty copy (no retry) when the list loads and is genuinely empty', async () => {
    vi.mocked(fetchReports).mockResolvedValue({ reports: [] })

    renderWithQuery(<InboxShell kind="reports" project={PROJECT} selectedId={null} />)

    expect(await screen.findByText('no reports yet')).toBeInTheDocument()
    expect(screen.queryByText('failed to load reports')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
