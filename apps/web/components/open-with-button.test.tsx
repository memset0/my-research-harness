// @vitest-environment jsdom

import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'

const checkTerminalMock = vi.hoisted(() => vi.fn())
const fetchHostsMock = vi.hoisted(() => vi.fn())
const openMock = vi.hoisted(() => vi.fn())
const openHerdrMock = vi.hoisted(() => vi.fn())
const openSplitMock = vi.hoisted(() => vi.fn())
const openHerdrSplitMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    checkTerminal: checkTerminalMock,
    fetchHosts: fetchHostsMock,
    installTerminal: vi.fn(),
  }
})

vi.mock('./terminal-drawer-provider', () => ({
  useTerminalDrawer: () => ({
    open: openMock,
    openRaw: vi.fn(),
    openHerdr: openHerdrMock,
    openSplit: openSplitMock,
    openRawSplit: vi.fn(),
    openHerdrSplit: openHerdrSplitMock,
    close: vi.fn(),
  }),
}))

import { __resetRuntimeConfigForTests } from '../lib/runtime-config'
import { OpenWithButton } from './open-with-button'
import { SessionProvider } from './session-provider'

function injectTerminalConfig(
  tmuxEnabled: boolean,
  herdrEnabled: boolean,
  role: 'standalone' | 'central' = 'standalone',
) {
  document.getElementById('memon-runtime-config')?.remove()
  const script = document.createElement('script')
  script.id = 'memon-runtime-config'
  script.type = 'application/json'
  script.textContent = JSON.stringify({
    role,
    gitStatus: { intervalMs: 10_000 },
    terminal: { tmuxEnabled, herdrEnabled },
  })
  document.head.appendChild(script)
  __resetRuntimeConfigForTests()
}

function renderButton(project: Parameters<typeof OpenWithButton>[0]['project'] = 'project-a') {
  return renderWithQuery(
    <SessionProvider value={{ role: 'owner', scopeProjects: [] }}>
      <OpenWithButton project={project} scope="exp" slug="E0042-routing" />
    </SessionProvider>,
  )
}

describe('OpenWithButton terminal integrations', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    checkTerminalMock.mockResolvedValue({ available: true })
    fetchHostsMock.mockResolvedValue({ hosts: [] })
    injectTerminalConfig(true, false)
  })

  it('preserves the four tmux agent choices and appends Herdr when both are enabled', async () => {
    injectTerminalConfig(true, true)
    renderButton()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose agent' }))
    const labels = ['Terminal', 'Claude Code', 'Codex', 'OpenCode', 'Herdr']
    for (const label of labels) expect(await screen.findByText(label)).toBeInTheDocument()
    const herdrItem = screen.getByRole('menuitem', { name: 'Herdr' })
    expect(herdrItem.querySelector('svg')).toBeNull()
  })

  it('falls back to Herdr as the primary action when tmux is disabled', async () => {
    localStorage.setItem('memon:terminal:default-agent', 'claude')
    injectTerminalConfig(false, true)
    renderButton()
    const main = await screen.findByRole('button', { name: 'Open with Herdr' })
    expect(main.querySelector('svg')).toHaveClass('lucide-bot')
    await userEvent.click(main)
    expect(openHerdrMock).toHaveBeenCalledWith({
      project: 'project-a',
      scope: 'exp',
      slug: 'E0042-routing',
    })
    expect(openMock).not.toHaveBeenCalled()
  })

  it('does not render or probe ttyd when every backend is disabled', async () => {
    injectTerminalConfig(false, false)
    const { container } = renderButton()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(checkTerminalMock).not.toHaveBeenCalled()
  })

  it('opens the current tmux default in the right split', async () => {
    localStorage.setItem('memon:terminal:default-agent', 'codex')
    renderButton()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose agent' }))
    await userEvent.click(await screen.findByText('Open in split view'))
    expect(openSplitMock).toHaveBeenCalledWith({
      project: 'project-a',
      scope: 'exp',
      slug: 'E0042-routing',
      agent: 'codex',
    })
  })

  it('opens the current Herdr default in the right split', async () => {
    localStorage.setItem('memon:terminal:default-agent', 'herdr')
    injectTerminalConfig(true, true)
    renderButton()
    await userEvent.click(await screen.findByRole('button', { name: 'Choose agent' }))
    await userEvent.click(await screen.findByText('Open in split view'))
    expect(openHerdrSplitMock).toHaveBeenCalledWith({
      project: 'project-a',
      scope: 'exp',
      slug: 'E0042-routing',
    })
  })

  it('uses Host-qualified probe keys and never strips the central Project target', async () => {
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    renderButton(project)
    await userEvent.click(await screen.findByRole('button', { name: 'Open with Claude Code' }))

    expect(checkTerminalMock).toHaveBeenCalledWith({ host: 'host-a' })
    expect(openMock).toHaveBeenCalledWith({
      project,
      scope: 'exp',
      slug: 'E0042-routing',
      agent: 'claude',
    })
  })

  it('offers Herdr only on the selected Host that advertises the capability', async () => {
    injectTerminalConfig(true, false, 'central')
    fetchHostsMock.mockResolvedValue({
      hosts: [
        {
          host: 'host-a',
          state: 'online',
          capabilities: { tmux: true, herdr: false },
        },
        {
          host: 'host-b',
          state: 'online',
          capabilities: { tmux: true, herdr: true },
        },
      ],
    })
    const hostA = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    const first = renderButton(hostA)
    await userEvent.click(await screen.findByRole('button', { name: 'Choose agent' }))
    expect(screen.queryByRole('menuitem', { name: 'Herdr' })).toBeNull()
    first.unmount()

    const hostB = ProjectRefSchema.parse({ host: 'host-b', project: 'project-a' })
    renderButton(hostB)
    await userEvent.click(await screen.findByRole('button', { name: 'Choose agent' }))
    expect(await screen.findByRole('menuitem', { name: 'Herdr' })).toBeInTheDocument()
    expect(checkTerminalMock).toHaveBeenCalledWith({ host: 'host-b' })
  })
})
