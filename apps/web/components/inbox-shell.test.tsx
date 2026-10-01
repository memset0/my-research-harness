import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from '../lib/api'
import { renderWithQuery } from '../test/utils'

// Only the reports list call is stubbed; everything else in lib/api (project
// helpers, query-key builders) keeps its real behaviour.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, fetchReports: vi.fn(), fetchReport: vi.fn(), putReport: vi.fn() }
})

// Monaco cannot run in jsdom; a plain textarea keeps the editor contract.
vi.mock('./readme-monaco', () => ({
  ReadmeMonaco: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="Report source" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

// Rendered-markdown surface is irrelevant to the rail contract and drags in
// react-markdown + katex; keep it inert.
vi.mock('./markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

import { ProjectRefSchema } from '@memon/core'
import { fetchReport, fetchReports, putReport } from '../lib/api'
import { queryKeys } from '../lib/query-keys'
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

describe('InboxShell report editor — list invalidation', () => {
  it('refetches the Report list of a Host-qualified Project after a save', async () => {
    const hosted = ProjectRefSchema.parse({ host: 'host-a', project: PROJECT })
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [{ id: 'R0001', slug: 'first-report', title: 'First report', mtime: 1000 }] as never,
    })
    vi.mocked(fetchReport).mockResolvedValue({
      id: 'R0001',
      slug: 'first-report',
      mtime: 1000,
      hash: 'h1',
      content: '# First',
      format: 'markdown',
    })
    vi.mocked(putReport).mockResolvedValue({ mtime: 2000, hash: 'h2' } as never)

    const { queryClient } = renderWithQuery(
      <InboxShell kind="reports" project={hosted} selectedId="R0001" />,
    )
    await waitFor(() => expect(vi.mocked(fetchReports)).toHaveBeenCalledTimes(1))
    // The list read is keyed by the factory constructor the editor invalidates.
    expect(queryClient.getQueryState(queryKeys.reports(hosted))).toBeDefined()

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const [source] = screen.getAllByLabelText('Report source')
    fireEvent.change(source!, { target: { value: '# First, edited' } })
    // Desktop and mobile editors both mount; the open mobile Sheet blocks
    // pointer events, so activate the first Save directly.
    const [save] = screen.getAllByRole('button', { name: 'Save', hidden: true })
    fireEvent.click(save!)

    await waitFor(() => expect(vi.mocked(putReport)).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(vi.mocked(fetchReports)).toHaveBeenCalledTimes(2))
  })
})
