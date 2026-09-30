// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigation = vi.hoisted(() => ({
  pathname: '/p/project-a/e/E0042-routing',
  search: '',
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('./report-pane', () => ({
  ReportPane: ({
    reportId,
    onClose,
    onSwitch,
  }: {
    reportId: string
    onClose: () => void
    onSwitch: (reportId: string) => void
  }) => (
    <div data-testid="report-pane">
      {reportId}
      <button type="button" onClick={() => onSwitch('R0008')}>
        Switch mocked report
      </button>
      <button type="button" onClick={onClose}>
        Close mocked report
      </button>
    </div>
  ),
}))

vi.mock('./wiki-pane', () => ({
  WikiPane: ({
    project,
    wikiId,
    onClose,
    onSwitch,
  }: {
    project: string | { host: string; project: string }
    wikiId: string
    onClose: () => void
    onSwitch: (wikiId: string) => void
  }) => (
    <div
      data-testid="wiki-pane"
      data-project={typeof project === 'string' ? project : `${project.host}/${project.project}`}
    >
      {wikiId}
      <button type="button" onClick={() => onSwitch('W0008')}>
        Switch mocked wiki
      </button>
      <button type="button" onClick={onClose}>
        Close mocked wiki
      </button>
    </div>
  ),
}))

import { useWikiPane, WorkspacePaneProvider, WorkspaceSplitOutlet } from './workspace-pane-provider'

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('767px') ? width < 768 : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function Controls() {
  const wiki = useWikiPane()
  return (
    <main>
      <p>dashboard content</p>
      <button type="button" onClick={() => wiki.openWiki('W0007')}>
        Open wiki test
      </button>
    </main>
  )
}

function renderProvider() {
  return render(
    <WorkspacePaneProvider>
      <header data-testid="shared-header">shared application header</header>
      <WorkspaceSplitOutlet>
        <Controls />
      </WorkspaceSplitOutlet>
    </WorkspacePaneProvider>,
  )
}

describe('WorkspacePaneProvider presentation surfaces', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    navigation.pathname = '/p/project-a/e/E0042-routing'
    navigation.search = ''
    window.history.replaceState({}, '', navigation.pathname)
    localStorage.clear()
    setViewport(1440)
  })

  it('restores a Report split from URL state below the shared header', () => {
    navigation.search = 'run=sample&report=R0007&reportSurface=split'
    renderProvider()

    const panel = screen.getByLabelText('Report split panel')
    expect(panel).toHaveAttribute('data-panel-kind', 'report')
    expect(screen.getByTestId('report-pane')).toHaveTextContent('R0007')
    expect(panel.closest('[data-slot="workspace-split-outlet"]')).not.toContainElement(
      screen.getByTestId('shared-header'),
    )
  })

  it('restores a Report drawer and closes only its URL state', async () => {
    navigation.search = 'run=sample&report=R0007&reportSurface=drawer'
    window.history.replaceState(
      {},
      '',
      '/p/project-a/e/E0042-routing?run=sample&report=R0007&reportSurface=drawer',
    )
    renderProvider()

    expect(screen.getByLabelText('Report drawer')).toBeInTheDocument()
    const dashboard = screen.getByText('dashboard content')
    await userEvent.click(screen.getByRole('button', { name: 'Close mocked report' }))
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/p/project-a/e/E0042-routing?run=sample',
    )
    expect(screen.getByText('dashboard content')).toBe(dashboard)
    expect(screen.queryByLabelText('Report drawer')).not.toBeInTheDocument()
  })

  it('renders a requested Report split as a drawer on mobile', async () => {
    setViewport(500)
    navigation.search = 'report=R0007&reportSurface=split'
    renderProvider()

    expect(await screen.findByLabelText('Report drawer')).toBeInTheDocument()
    expect(screen.queryByLabelText('Report split panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close mocked report' })).toBeInTheDocument()
  })

  it('switches only the right Report while preserving the left Experiment instance', async () => {
    navigation.search = 'run=sample&report=R0007&reportSurface=split'
    window.history.replaceState(
      {},
      '',
      '/p/project-a/e/E0042-routing?run=sample&report=R0007&reportSurface=split',
    )
    renderProvider()
    const dashboard = screen.getByText('dashboard content')

    await userEvent.click(screen.getByRole('button', { name: 'Switch mocked report' }))

    expect(screen.getByTestId('report-pane')).toHaveTextContent('R0008')
    expect(screen.getByText('dashboard content')).toBe(dashboard)
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/p/project-a/e/E0042-routing?run=sample&report=R0008&reportSurface=split',
    )
  })

  it('opens a wiki page in the shared slot and preserves the mounted left document', async () => {
    navigation.search = 'run=sample&report=R0007&reportSurface=split'
    window.history.replaceState(
      {},
      '',
      '/p/project-a/e/E0042-routing?run=sample&report=R0007&reportSurface=split',
    )
    renderProvider()
    const dashboard = screen.getByText('dashboard content')

    await userEvent.click(screen.getByRole('button', { name: 'Open wiki test' }))

    expect(await screen.findByLabelText('Wiki split panel')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-pane')).toHaveTextContent('W0007')
    expect(screen.getByText('dashboard content')).toBe(dashboard)
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/p/project-a/e/E0042-routing?run=sample&wiki=W0007&wikiSurface=split',
    )
    expect(screen.queryByLabelText('Report drawer')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Report split panel')).not.toBeInTheDocument()
  })

  it('gives wiki precedence and normalizes a stale URL containing both identities', async () => {
    navigation.search = 'run=sample&report=R0007&reportSurface=split&wiki=W0004&wikiSurface=drawer'
    window.history.replaceState({}, '', `/p/project-a/e/E0042-routing?${navigation.search}`)

    renderProvider()

    expect(screen.getByLabelText('Wiki drawer')).toBeInTheDocument()
    expect(screen.queryByLabelText('Report split panel')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        '/p/project-a/e/E0042-routing?run=sample&wiki=W0004&wikiSurface=drawer',
      )
    })
  })

  it('restores a Host-qualified wiki split without dropping Host identity', () => {
    navigation.pathname = '/h/host-a/p/project-a/e/E0042-routing'
    navigation.search = 'wiki=W0007&wikiSurface=split'
    window.history.replaceState({}, '', `${navigation.pathname}?${navigation.search}`)

    renderProvider()

    expect(screen.getByLabelText('Wiki split panel')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-pane')).toHaveAttribute('data-project', 'host-a/project-a')
  })

  it('switches only the side wiki identity and retains unrelated left-page state', async () => {
    navigation.search = 'run=sample&wiki=W0007&wikiSurface=split'
    window.history.replaceState(
      {},
      '',
      '/p/project-a/e/E0042-routing?run=sample&wiki=W0007&wikiSurface=split',
    )
    renderProvider()
    const dashboard = screen.getByText('dashboard content')

    await userEvent.click(screen.getByRole('button', { name: 'Switch mocked wiki' }))

    expect(screen.getByTestId('wiki-pane')).toHaveTextContent('W0008')
    expect(screen.getByText('dashboard content')).toBe(dashboard)
    expect(`${window.location.pathname}${window.location.search}`).toBe(
      '/p/project-a/e/E0042-routing?run=sample&wiki=W0008&wikiSurface=split',
    )
  })
})
