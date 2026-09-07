// @vitest-environment jsdom

import { ProjectRefSchema } from '@memon/core'
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

vi.mock('./terminal-view', () => ({
  TerminalView: ({ mode }: { mode: string }) => <div data-testid="terminal-view">{mode}</div>,
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

import {
  TerminalDrawerProvider,
  useTerminalDrawer,
  useWikiPane,
  WorkspaceSplitOutlet,
} from './terminal-drawer-provider'

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
  const terminal = useTerminalDrawer()
  const wiki = useWikiPane()
  const target = {
    project: 'project-a',
    scope: 'exp' as const,
    slug: 'E0042-routing',
    agent: 'codex' as const,
  }
  const centralTarget = {
    ...target,
    project: ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' }),
  }
  return (
    <main>
      <p>dashboard content</p>
      <button type="button" onClick={() => terminal.open(target)}>
        Open drawer test
      </button>
      <button type="button" onClick={() => terminal.openSplit(target)}>
        Open split test
      </button>
      <button type="button" onClick={() => terminal.openSplit(centralTarget)}>
        Open central split test
      </button>
      <button
        type="button"
        onClick={() =>
          terminal.openHerdrSplit({
            project: 'project-a',
            scope: 'exp',
            slug: 'E0042-routing',
          })
        }
      >
        Open Herdr split test
      </button>
      <button type="button" onClick={() => wiki.openWiki('W0007')}>
        Open wiki test
      </button>
    </main>
  )
}

function renderProvider() {
  return render(
    <TerminalDrawerProvider>
      <header data-testid="shared-header">shared application header</header>
      <WorkspaceSplitOutlet>
        <Controls />
      </WorkspaceSplitOutlet>
    </TerminalDrawerProvider>,
  )
}

describe('TerminalDrawerProvider presentation surfaces', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    navigation.pathname = '/p/project-a/e/E0042-routing'
    navigation.search = ''
    window.history.replaceState({}, '', navigation.pathname)
    localStorage.clear()
    setViewport(1440)
  })

  it('moves an active drawer target into the right split and back', async () => {
    renderProvider()
    const dashboard = screen.getByText('dashboard content')
    await userEvent.click(screen.getByRole('button', { name: 'Open drawer test' }))
    expect(await screen.findByLabelText('Terminal drawer')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-view')).toHaveTextContent('standard')

    await userEvent.click(screen.getByRole('button', { name: 'Split right' }))
    expect(await screen.findByLabelText('Terminal split panel')).toBeInTheDocument()
    expect(screen.getByText('dashboard content')).toBe(dashboard)
    expect(screen.queryByLabelText('Terminal drawer')).not.toBeInTheDocument()

    const outlet = screen
      .getByText('dashboard content')
      .closest('[data-slot="workspace-split-outlet"]')
    const sharedHeader = screen.getByTestId('shared-header')
    expect(outlet).toHaveAttribute('data-surface', 'split')
    expect(outlet).not.toContainElement(sharedHeader)
    expect(sharedHeader.closest('[data-slot="workspace-main-region"]')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Drawer' }))
    expect(await screen.findByLabelText('Terminal drawer')).toBeInTheDocument()
    expect(screen.queryByLabelText('Terminal split panel')).not.toBeInTheDocument()
  })

  it('keeps the shared header outside the split and the left subtree mounted', async () => {
    renderProvider()
    const header = screen.getByTestId('shared-header')
    const dashboard = screen.getByText('dashboard content')

    await userEvent.click(screen.getByRole('button', { name: 'Open split test' }))

    const panel = await screen.findByLabelText('Terminal split panel')
    const outlet = panel.closest('[data-slot="workspace-split-outlet"]')
    expect(outlet).toContainElement(dashboard)
    expect(outlet).not.toContainElement(header)
    expect(screen.getByText('dashboard content')).toBe(dashboard)
  })

  it('opens Herdr directly in the split', async () => {
    renderProvider()
    await userEvent.click(screen.getByRole('button', { name: 'Open Herdr split test' }))
    expect(await screen.findByLabelText('Terminal split panel')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-view')).toHaveTextContent('herdr')
    expect(screen.getByText(/Herdr · E0042-routing/)).toBeInTheDocument()
  })

  it('pops the same target out and closes its in-page surface', async () => {
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderProvider()
    await userEvent.click(screen.getByRole('button', { name: 'Open split test' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Pop out' }))

    expect(openWindow).toHaveBeenCalledWith(
      '/terminal-popup?project=project-a&scope=exp&slug=E0042-routing&agent=codex',
      'memon-popup-memon-codex-project-a--exp--E0042-routing',
      'popup,width=1200,height=800',
    )
    expect(screen.queryByLabelText('Terminal split panel')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Terminal drawer')).not.toBeInTheDocument()
  })

  it('keeps Host identity in central popup URLs and window cache names', async () => {
    const openWindow = vi.spyOn(window, 'open').mockImplementation(() => null)
    const view = renderProvider()
    await userEvent.click(screen.getByRole('button', { name: 'Open central split test' }))
    navigation.pathname = '/h/host-b/p/project-a/e/E0043-other'
    view.rerender(
      <TerminalDrawerProvider>
        <header data-testid="shared-header">shared application header</header>
        <WorkspaceSplitOutlet>
          <Controls />
        </WorkspaceSplitOutlet>
      </TerminalDrawerProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Pop out' }))

    expect(openWindow).toHaveBeenCalledWith(
      '/terminal-popup?project=project-a&scope=exp&slug=E0042-routing&agent=codex&host=host-a',
      'memon-popup-host-a-memon-codex-project-a--exp--E0042-routing',
      'popup,width=1200,height=800',
    )
  })

  it('falls back to the drawer when split is requested on mobile', async () => {
    setViewport(500)
    renderProvider()
    await waitFor(() => expect(window.matchMedia).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Open split test' }))
    expect(await screen.findByLabelText('Terminal drawer')).toBeInTheDocument()
    expect(screen.queryByLabelText('Terminal split panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split right' })).toHaveClass('hidden')
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

  it('lets URL-driven Report state replace a visible terminal in the shared slot', async () => {
    const view = renderProvider()
    await userEvent.click(screen.getByRole('button', { name: 'Open split test' }))
    expect(await screen.findByLabelText('Terminal split panel')).toBeInTheDocument()

    navigation.search = 'report=R0007&reportSurface=split'
    view.rerender(
      <TerminalDrawerProvider>
        <header data-testid="shared-header">shared application header</header>
        <WorkspaceSplitOutlet>
          <Controls />
        </WorkspaceSplitOutlet>
      </TerminalDrawerProvider>,
    )

    expect(await screen.findByLabelText('Report split panel')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByLabelText('Terminal split panel')).not.toBeInTheDocument(),
    )
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
    navigation.search =
      'run=sample&report=R0007&reportSurface=split&wiki=W0004&wikiSurface=drawer'
    window.history.replaceState(
      {},
      '',
      `/p/project-a/e/E0042-routing?${navigation.search}`,
    )

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
