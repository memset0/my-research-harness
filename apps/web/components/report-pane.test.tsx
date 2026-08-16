import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchReport, fetchReports } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { ReportPane } from './report-pane'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, fetchReports: vi.fn(), fetchReport: vi.fn() }
})

describe('<ReportPane>', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [
        {
          id: 'R0001',
          slug: 'first-report',
          title: 'First report',
          path: '/repo/docs/reports/R0001-first-report.md',
          mtime: 1,
          format: 'markdown',
        },
        {
          id: 'R0002',
          slug: 'second-report',
          title: 'Second report',
          path: '/repo/docs/reports/R0002-second-report/README.md',
          mtime: 2,
          format: 'bundle',
        },
      ],
    })
    vi.mocked(fetchReport).mockResolvedValue({
      id: 'R0001',
      slug: 'first-report',
      path: '/repo/docs/reports/R0001-first-report.md',
      mtime: 1,
      hash: 'hash',
      content: '# First report\n',
      format: 'markdown',
    })
  })

  it('renders the Report and switches only through the controlled callback', async () => {
    const user = userEvent.setup()
    const onSwitch = vi.fn()
    renderWithQuery(
      <ReportPane
        project="project-a"
        reportId="R0001"
        surface="split"
        onSwitch={onSwitch}
        onSurfaceChange={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await screen.findByRole('heading', { name: 'First report' })
    await user.click(screen.getByRole('button', { name: /Switch report, current R0001/ }))
    const popover = await waitFor(() => {
      const node = document.querySelector('[data-slot="popover-content"]')
      expect(node).not.toBeNull()
      return node as HTMLElement
    })
    await user.click(within(popover).getByRole('button', { name: /R0002.*Second report/s }))
    expect(onSwitch).toHaveBeenCalledWith('R0002')
  })

  it('moves surfaces and closes with accessible controls', async () => {
    const user = userEvent.setup()
    const onSurfaceChange = vi.fn()
    const onClose = vi.fn()
    renderWithQuery(
      <ReportPane
        project="project-a"
        reportId="R0001"
        surface="split"
        onSwitch={vi.fn()}
        onSurfaceChange={onSurfaceChange}
        onClose={onClose}
      />,
    )

    await screen.findByRole('heading', { name: 'First report' })
    await user.click(screen.getByRole('button', { name: 'Move report to drawer' }))
    await user.click(screen.getByRole('button', { name: 'Close report' }))
    expect(onSurfaceChange).toHaveBeenCalledWith('drawer')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: 'Open full report' })).toHaveAttribute(
      'href',
      '/p/project-a/reports/R0001',
    )
  })
})
