import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxShell, RenderedItem } from '../../components/inbox-shell'
import { renderWithQuery } from '../utils'

vi.mock('../../components/readme-monaco', () => ({
  ReadmeMonaco: () => <div data-testid="readme-monaco">editor</div>,
}))

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return {
    ...actual,
    fetchReports: vi.fn(),
    fetchReport: vi.fn(),
  }
})

import { fetchReport, fetchReports } from '../../lib/api'

const REPORT_PICKER_PREFERENCE_KEY = 'memon:reports:picker-open'

describe('directory Report inbox rendering', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(null, { status: 200, headers: { 'content-type': 'text/html' } }),
        ),
    )
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
        {
          id: 'R0003',
          slug: 'follow-up',
          path: '/project/docs/reports/R0003-follow-up.md',
          mtime: 2,
          title: 'Follow-up report',
          format: 'markdown',
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

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('enables the TOC for Reports', () => {
    render(
      <RenderedItem
        kind="reports"
        content={'# Report title\n\n## Summary\n\n### Metrics'}
        project="research"
        sourceReportId="R0002"
      />,
    )

    const toc = screen.getByRole('navigation', { name: 'Table of contents' })
    expect(
      within(toc)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Summary', 'Metrics'])
    expect(screen.getByRole('heading', { name: 'Summary' })).toHaveAttribute(
      'id',
      'report-r0002-summary',
    )
  })

  it('threads FullReport.format into the Markdown resource base', async () => {
    const { container } = renderWithQuery(
      <InboxShell kind="reports" project="research" selectedId="R0002" />,
    )

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Rich report' })).toBeInTheDocument(),
    )
    await waitFor(() => expect(container.querySelector('iframe[data-report-html]')).not.toBeNull())
    const iframe = container.querySelector('iframe[data-report-html]')
    expect(iframe?.getAttribute('src')).toBe('/api/report-assets/research/R0002/chart.html')
    expect(iframe?.hasAttribute('sandbox')).toBe(false)
  })

  it('uses a card reading surface and compact linked cards for Reports', async () => {
    const { container } = renderWithQuery(
      <InboxShell kind="reports" project="research" selectedId="R0002" />,
    )

    await screen.findByRole('heading', { name: 'Rich report' })

    const surface = container.querySelector('[data-inbox-reading-surface="reports"]')
    expect(surface).toHaveClass('bg-card', 'overflow-y-auto', 'overflow-x-hidden')
    expect(surface).not.toHaveClass('bg-white')

    const picker = screen.getByRole('complementary', { name: 'Report picker' })
    const list = within(picker).getByRole('list')
    expect(list).toHaveClass('gap-1.5', 'p-2')

    const cards = within(picker).getAllByRole('link')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveAttribute('href', '/p/research/reports/R0002')
    expect(cards[0]).toHaveAttribute('aria-current', 'page')
    expect(cards[0]).toHaveClass(
      'rounded-md',
      'border',
      'border-primary',
      'bg-card',
      'hover:bg-accent/40',
      'focus-visible:ring-2',
    )
    expect(cards[0]).toHaveTextContent('R0002')
    expect(cards[0]).toHaveTextContent('Rich report')
    expect(cards[0]).toHaveTextContent('rich')
    expect(screen.queryByRole('button', { name: /Switch report/i })).not.toBeInTheDocument()
  })

  it('hides and restores the desktop Report picker without losing selection or edit state', async () => {
    const user = userEvent.setup()
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })

    await user.click(screen.getByRole('button', { name: 'Hide reports' }))
    expect(localStorage.getItem(REPORT_PICKER_PREFERENCE_KEY)).toBe('false')
    expect(screen.queryByRole('complementary', { name: 'Report picker' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show reports' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Open list' })).toHaveClass('md:hidden')

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getAllByTestId('readme-monaco')).toHaveLength(2)
    expect(document.querySelector('aside[aria-label="Report picker"]')).toBeNull()
    expect(document.querySelector('button[aria-label="Show reports"]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Show reports' }))
    expect(localStorage.getItem(REPORT_PICKER_PREFERENCE_KEY)).toBe('true')
    const picker = screen.getByRole('complementary', { name: 'Report picker' })
    expect(within(picker).getByRole('link', { current: 'page' })).toHaveTextContent('R0002')
  })

  it('restores the hidden Report picker preference across projects and rejects invalid values', async () => {
    localStorage.setItem(REPORT_PICKER_PREFERENCE_KEY, 'false')
    const first = renderWithQuery(
      <InboxShell kind="reports" project="research" selectedId="R0002" />,
    )
    await screen.findByRole('heading', { name: 'Rich report' })
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Report picker' }),
      ).not.toBeInTheDocument(),
    )
    first.unmount()

    renderWithQuery(<InboxShell kind="reports" project="another-project" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Report picker' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('falls back to the open Report picker for a non-boolean saved preference', async () => {
    localStorage.setItem(REPORT_PICKER_PREFERENCE_KEY, '"collapsed"')
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })

    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Report picker' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /Switch report/i })).not.toBeInTheDocument()
  })

  it('opens a collapsed-state Report quick switcher and restores focus on Escape', async () => {
    localStorage.setItem(REPORT_PICKER_PREFERENCE_KEY, 'false')
    const user = userEvent.setup()
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })

    const trigger = await screen.findByRole('button', {
      name: 'Switch report, current R0002 rich',
    })
    expect(trigger).toHaveClass('hidden', 'md:inline-flex')
    expect(document.querySelector('[data-report-identity-mobile]')).toHaveClass('md:hidden')

    await user.click(trigger)
    const switcher = await waitFor(() => {
      const element = document.querySelector(
        '[data-slot="popover-content"][aria-label="Switch report"]',
      )
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const listViewport = switcher.querySelector('[data-report-quick-switch-list]')
    expect(listViewport).toHaveClass('overflow-y-auto')
    expect(listViewport?.className).toContain('max-h-')

    const links = within(switcher).getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', '/p/research/reports/R0002')
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[1]).toHaveAttribute('href', '/p/research/reports/R0003')

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="popover-content"][aria-label="Switch report"]'),
      ).toBeNull(),
    )
    expect(trigger).toHaveFocus()
  })

  it('closes the quick switcher after selecting a native Report link without reopening the rail', async () => {
    localStorage.setItem(REPORT_PICKER_PREFERENCE_KEY, 'false')
    const user = userEvent.setup()
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })

    await user.click(
      await screen.findByRole('button', { name: 'Switch report, current R0002 rich' }),
    )
    const destination = screen.getByRole('link', { name: /R0003.*Follow-up report/s })
    destination.addEventListener('click', (event) => event.preventDefault())
    await user.click(destination)

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="popover-content"][aria-label="Switch report"]'),
      ).toBeNull(),
    )
    expect(screen.queryByRole('complementary', { name: 'Report picker' })).not.toBeInTheDocument()
    expect(localStorage.getItem(REPORT_PICKER_PREFERENCE_KEY)).toBe('false')
  })

  it('shows list skeletons instead of a false empty state while Reports are loading', async () => {
    localStorage.setItem(REPORT_PICKER_PREFERENCE_KEY, 'false')
    let resolveReports!: (value: Awaited<ReturnType<typeof fetchReports>>) => void
    vi.mocked(fetchReports).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReports = resolve
      }),
    )
    const user = userEvent.setup()
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })

    await user.click(
      await screen.findByRole('button', { name: 'Switch report, current R0002 rich' }),
    )
    const switcher = document.querySelector(
      '[data-slot="popover-content"][aria-label="Switch report"]',
    ) as HTMLElement
    expect(switcher.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(24)
    expect(within(switcher).queryByText('no reports yet')).not.toBeInTheDocument()

    resolveReports({ reports: [] })
    await waitFor(() => expect(within(switcher).getByText('no reports yet')).toBeInTheDocument())
  })

  it('keeps the Report picker restorable from an empty detail pane', async () => {
    const user = userEvent.setup()
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId={null} />)

    await user.click(screen.getByRole('button', { name: 'Hide reports' }))
    expect(screen.queryByRole('complementary', { name: 'Report picker' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show reports' }))
    expect(screen.getByRole('complementary', { name: 'Report picker' })).toBeInTheDocument()
  })

  it('reuses Report cards inside the mobile list Sheet', async () => {
    const user = userEvent.setup()
    renderWithQuery(<InboxShell kind="reports" project="research" selectedId="R0002" />)
    await screen.findByRole('heading', { name: 'Rich report' })

    await user.click(screen.getByRole('button', { name: 'Open list' }))
    const drawer = screen.getByRole('dialog', { name: 'Reports · research' })
    const cards = within(drawer).getAllByRole('link')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveAttribute('data-report-card')
    expect(cards[0]).toHaveClass('rounded-md', 'border', 'bg-card')
  })
})
