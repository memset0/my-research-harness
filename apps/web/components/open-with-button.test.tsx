// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'

const checkTerminalMock = vi.hoisted(() => vi.fn())
const openMock = vi.hoisted(() => vi.fn())
const openHerdrMock = vi.hoisted(() => vi.fn())
const openSplitMock = vi.hoisted(() => vi.fn())
const openHerdrSplitMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    checkTerminal: checkTerminalMock,
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

function injectTerminalConfig(tmuxEnabled: boolean, herdrEnabled: boolean) {
  document.getElementById('memon-runtime-config')?.remove()
  const script = document.createElement('script')
  script.id = 'memon-runtime-config'
  script.type = 'application/json'
  script.textContent = JSON.stringify({
    gitStatus: { intervalMs: 10_000 },
    terminal: { tmuxEnabled, herdrEnabled },
  })
  document.head.appendChild(script)
  __resetRuntimeConfigForTests()
}

function renderButton() {
  return renderWithQuery(
    <SessionProvider value={{ role: 'owner', scopeProjects: [] }}>
      <OpenWithButton project="project-a" scope="exp" slug="E0042-routing" />
    </SessionProvider>,
  )
}

describe('OpenWithButton terminal integrations', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    checkTerminalMock.mockResolvedValue({ available: true })
    injectTerminalConfig(true, false)
  })

  it('preserves the four tmux agent choices and appends Herdr when both are enabled', async () => {
    injectTerminalConfig(true, true)
    renderButton()
    await userEvent.click(screen.getByRole('button', { name: 'Choose agent' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Choose agent' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Choose agent' }))
    await userEvent.click(await screen.findByText('Open in split view'))
    expect(openHerdrSplitMock).toHaveBeenCalledWith({
      project: 'project-a',
      scope: 'exp',
      slug: 'E0042-routing',
    })
  })
})
