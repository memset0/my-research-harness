// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../utils'

const navigation = vi.hoisted(() => ({ search: 'host=host-a', replace: vi.fn() }))
const api = vi.hoisted(() => ({
  fetchHosts: vi.fn(),
  listTmuxSessions: vi.fn(),
  killTmuxSession: vi.fn(),
  createTmuxSession: vi.fn(),
  renameTmuxSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, ...api }
})

vi.mock('../../components/terminal-view', () => ({
  TerminalView: ({ host, sessionName }: { host?: string; sessionName?: string }) => (
    <div data-testid="terminal-view">{`${host ?? 'standalone'}:${sessionName ?? 'standard'}`}</div>
  ),
}))

import { TmuxManagePageClient } from '../../app/manage/tmux/tmux-page.client'
import { SessionProvider } from '../../components/session-provider'
import { __resetRuntimeConfigForTests } from '../../lib/runtime-config'

function host(host: string, state: 'online' | 'offline' = 'online') {
  return {
    host,
    state,
    diagnostic: state === 'offline' ? 'Backend tunnel is unavailable' : null,
    lastSuccessfulCheckAt: state === 'online' ? '2026-08-26T19:00:00.000Z' : null,
    centralRelease: '6.0.0',
    backendRelease: state === 'online' ? '6.0.0' : null,
    backendRevision: state === 'online' ? '0123456789abcdef' : null,
    capabilities:
      state === 'online'
        ? {
            projects: true,
            mutations: true,
            events: true,
            logStreaming: true,
            reportAssets: true,
            wikiAssets: true,
            git: true,
            shares: true,
            tmux: true,
            terminal: true,
            slurm: false,
            herdr: false,
          }
        : null,
  }
}

function row(hostId = 'host-a') {
  return {
    host: hostId,
    sessionName: 'memon-manual-same',
    parsed: {
      raw: 'memon-manual-same',
      agent: null,
      project: null,
      scope: null,
      slug: null,
      legacy: false,
    },
    liveEntry: { lastActiveAt: '2026-08-26T19:00:00.000Z' },
    tmuxCreatedAt: '2026-08-26T18:00:00.000Z',
    tmuxLastActivity: '2026-08-26T19:00:00.000Z',
    matchable: false,
    staleReason: null,
    pane: { title: 'idle', currentCommand: 'bash', currentPath: null },
    state: 'idle',
    lastStateChangeAt: null,
  }
}

function injectCentralRole() {
  document.getElementById('memon-runtime-config')?.remove()
  const script = document.createElement('script')
  script.id = 'memon-runtime-config'
  script.type = 'application/json'
  script.textContent = JSON.stringify({
    role: 'central',
    gitStatus: { intervalMs: 10_000 },
    terminal: { tmuxEnabled: true, herdrEnabled: false },
  })
  document.head.appendChild(script)
  __resetRuntimeConfigForTests()
}

function renderPage() {
  return renderWithQuery(
    <SessionProvider value={{ role: 'owner', scopeProjects: [] }}>
      <TmuxManagePageClient />
    </SessionProvider>,
  )
}

describe('central tmux Host isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigation.search = 'host=host-a'
    injectCentralRole()
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '(min-width: 768px)',
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    api.fetchHosts.mockResolvedValue({ hosts: [host('host-a'), host('host-b')] })
    api.listTmuxSessions.mockResolvedValue({ sessions: [row()] })
    api.killTmuxSession.mockResolvedValue({
      ok: true,
      host: 'host-a',
      sessionName: 'memon-manual-same',
    })
  })

  it('queries and mutates only the selected Host without rendering a private port', async () => {
    renderPage()
    const sessionTitle = await screen.findByTitle('memon-manual-same')
    expect(api.listTmuxSessions).toHaveBeenCalledWith({ host: 'host-a' })
    expect(screen.queryByText(/port\s+\d+/i)).toBeNull()

    await userEvent.click(sessionTitle)
    expect(navigation.replace).toHaveBeenCalledWith(
      '/manage/tmux?host=host-a&session=memon-manual-same',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Kill session' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Kill session' }))
    await waitFor(() =>
      expect(api.killTmuxSession).toHaveBeenCalledWith('memon-manual-same', {
        host: 'host-a',
      }),
    )
  })

  it('contacts no Backend until an exact usable Host is selected', async () => {
    navigation.search = ''
    renderPage()
    expect(
      await screen.findByText('Select one configured Host to manage tmux sessions.'),
    ).toBeInTheDocument()
    expect(api.listTmuxSessions).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: 'host-b' })
    await userEvent.selectOptions(screen.getByLabelText('Host'), 'host-b')
    expect(navigation.replace).toHaveBeenCalledWith('/manage/tmux?host=host-b')
  })

  it('capability-gates an offline Host without falling back to another Host', async () => {
    api.fetchHosts.mockResolvedValue({ hosts: [host('host-a', 'offline'), host('host-b')] })
    renderPage()
    expect(await screen.findByText('Backend tunnel is unavailable')).toBeInTheDocument()
    expect(api.listTmuxSessions).not.toHaveBeenCalled()
  })
})
