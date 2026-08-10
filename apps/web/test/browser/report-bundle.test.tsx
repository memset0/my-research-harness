import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxShell } from '../../components/inbox-shell'
import { renderWithQuery } from '../utils'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    fetchReport: vi.fn(),
    fetchDigests: vi.fn(),
    fetchDigest: vi.fn(),
  }
})

import { fetchReport, fetchReports } from '../../lib/api'

describe('directory Report inbox rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchReports).mockResolvedValue({
      reports: [
        {
          id: 'R0002',
          slug: 'rich',
          path: '/project/docs/reports/R0002-rich/README.md',
          mtime: 1,
          title: 'Rich report',
          format: 'bundle',
        },
      ],
    })
    vi.mocked(fetchReport).mockResolvedValue({
      id: 'R0002',
      slug: 'rich',
      path: '/project/docs/reports/R0002-rich/README.md',
      mtime: 1,
      hash: 'abc',
      content: '# Rich report\n\n![Interactive chart](./chart.html)\n',
      format: 'bundle',
    })
  })

  it('threads FullReport.format into the Markdown resource base', async () => {
    const { container } = renderWithQuery(
      <InboxShell kind="reports" project="research" selectedId="R0002" />,
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Rich report' })).toBeInTheDocument(),
    )
    const iframe = container.querySelector('iframe[data-report-html]')
    expect(iframe?.getAttribute('src')).toBe('/api/report-assets/research/R0002/chart.html')
    expect(iframe?.hasAttribute('sandbox')).toBe(false)
  })
})
