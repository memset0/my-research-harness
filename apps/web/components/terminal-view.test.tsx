import { ProjectRefSchema } from '@memon/core'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../test/utils'

// `lib/api` is mocked at the module boundary so we control whether
// start/attach resolves or rejects per test. The mocks must be defined
// BEFORE the component import so vi.mock hoists correctly.
const startTerminalMock = vi.fn()
const startHerdrTerminalMock = vi.fn()
const attachTerminalMock = vi.fn()
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    startTerminal: (...args: unknown[]) => startTerminalMock(...args),
    startHerdrTerminal: (...args: unknown[]) => startHerdrTerminalMock(...args),
    attachTerminal: (...args: unknown[]) => attachTerminalMock(...args),
  }
})

import { TerminalView } from './terminal-view'

type PostedMsg = { host: string | null; sessionName: string; source: string; attachedAt: number }

interface ChannelInstance {
  name: string
  posts: PostedMsg[]
  closed: boolean
}

function installBroadcastChannelMock(): {
  channels: ChannelInstance[]
  restore: () => void
} {
  const channels: ChannelInstance[] = []
  const orig = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
  class FakeChannel {
    name: string
    private inst: ChannelInstance
    constructor(name: string) {
      this.name = name
      this.inst = { name, posts: [], closed: false }
      channels.push(this.inst)
    }
    postMessage(msg: PostedMsg) {
      this.inst.posts.push(msg)
    }
    close() {
      this.inst.closed = true
    }
    addEventListener() {}
    removeEventListener() {}
    onmessage: ((e: MessageEvent) => void) | null = null
  }
  ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = FakeChannel
  return {
    channels,
    restore: () => {
      ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = orig
    },
  }
}

beforeEach(() => {
  startTerminalMock.mockReset()
  startHerdrTerminalMock.mockReset()
  attachTerminalMock.mockReset()
})

describe('TerminalView broadcast on ready', () => {
  let bc: ReturnType<typeof installBroadcastChannelMock>
  beforeEach(() => {
    bc = installBroadcastChannelMock()
  })
  afterEach(() => {
    bc.restore()
  })

  it('successful standard mount fires exactly one broadcast with source from prop', async () => {
    startTerminalMock.mockResolvedValue({
      sessionName: 'memon-claude-project-a--run--foo-260507-103000',
      url: '/api/terminal/proxy/memon-claude-project-a--run--foo-260507-103000/',
      port: 7683,
      startedAt: '2026-05-15T00:00:00+08:00',
      warnings: [],
    })
    renderWithQuery(
      <TerminalView
        mode="standard"
        project="project-a"
        scope="run"
        slug="foo-260507-103000"
        agent="claude"
        source="drawer"
      />,
    )
    await waitFor(() => {
      const posts = bc.channels.flatMap((c) => c.posts)
      expect(posts.length).toBe(1)
    })
    const all = bc.channels.flatMap((c) => c.posts)
    expect(all[0]).toEqual({
      host: null,
      sessionName: 'memon-claude-project-a--run--foo-260507-103000',
      source: 'drawer',
      attachedAt: expect.any(Number),
    })
    // Channel was created on the canonical name and closed after the post
    // (per-broadcast-create-then-close pattern).
    const used = bc.channels.find((c) => c.posts.length > 0)
    expect(used?.name).toBe('memon:terminal-attached')
    expect(used?.closed).toBe(true)
  })

  it('successful raw-mode mount broadcasts source="popup"', async () => {
    attachTerminalMock.mockResolvedValue({
      sessionName: 'memon-manual-foo',
      url: '/api/terminal/proxy/memon-manual-foo/',
      port: 7684,
      startedAt: '2026-05-15T00:00:00+08:00',
      warnings: [],
    })
    renderWithQuery(<TerminalView mode="raw" sessionName="memon-manual-foo" source="popup" />)
    await waitFor(() => {
      const posts = bc.channels.flatMap((c) => c.posts)
      expect(posts.length).toBe(1)
      expect(posts[0]?.sessionName).toBe('memon-manual-foo')
      expect(posts[0]?.host).toBeNull()
      expect(posts[0]?.source).toBe('popup')
    })
  })

  it('binds central iframe and broadcast state to the selected Host', async () => {
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    startTerminalMock.mockResolvedValue({
      host: 'host-a',
      sessionName: 'memon-codex-project-a--project--root',
      url: '/api/terminal/proxy/host-a/memon-codex-project-a--project--root/',
      startedAt: '2026-08-26T19:00:00Z',
      warnings: [],
    })
    renderWithQuery(
      <TerminalView
        mode="standard"
        project={project}
        scope="project"
        slug="root"
        agent="codex"
        source="drawer"
      />,
    )

    expect(await screen.findByTitle('host-a · codex terminal')).toHaveAttribute(
      'src',
      '/api/terminal/proxy/host-a/memon-codex-project-a--project--root/',
    )
    expect(startTerminalMock).toHaveBeenCalledWith({
      project,
      scope: 'project',
      slug: 'root',
      agent: 'codex',
    })
    expect(bc.channels.flatMap((channel) => channel.posts)[0]).toMatchObject({
      host: 'host-a',
      sessionName: 'memon-codex-project-a--project--root',
    })
  })

  it('fails closed when a response attempts to retarget another Host', async () => {
    const project = ProjectRefSchema.parse({ host: 'host-a', project: 'project-a' })
    startTerminalMock.mockResolvedValue({
      host: 'host-b',
      sessionName: 'memon-codex-project-a--project--root',
      url: '/api/terminal/proxy/host-b/memon-codex-project-a--project--root/',
      startedAt: '2026-08-26T19:00:00Z',
      warnings: [],
    })
    renderWithQuery(
      <TerminalView
        mode="standard"
        project={project}
        scope="project"
        slug="root"
        agent="codex"
        source="drawer"
      />,
    )

    expect(
      await screen.findByText('Terminal response Host does not match the selected Host'),
    ).toBeInTheDocument()
    expect(screen.queryByTitle('host-a · codex terminal')).not.toBeInTheDocument()
    expect(bc.channels.flatMap((channel) => channel.posts)).toEqual([])
  })

  it('Herdr mode starts the target workspace and renders its shared proxy', async () => {
    startHerdrTerminalMock.mockResolvedValue({
      sessionName: 'memon-herdr',
      url: '/api/terminal/proxy/memon-herdr/',
      port: 7685,
      startedAt: '2026-08-14T00:00:00Z',
      warnings: [],
    })
    const { getByTitle } = renderWithQuery(
      <TerminalView
        mode="herdr"
        project="project-a"
        scope="exp"
        slug="E0042-routing"
        source="drawer"
      />,
    )
    await waitFor(() => {
      expect(startHerdrTerminalMock).toHaveBeenCalledWith({
        project: 'project-a',
        scope: 'exp',
        slug: 'E0042-routing',
      })
      expect(getByTitle('Herdr terminal')).toHaveAttribute(
        'src',
        '/api/terminal/proxy/memon-herdr/',
      )
      expect(getByTitle('Herdr terminal')).toHaveAttribute(
        'allow',
        'clipboard-read; clipboard-write',
      )
    })
  })

  it('source defaults to "unknown" when prop is omitted', async () => {
    attachTerminalMock.mockResolvedValue({
      sessionName: 'memon-manual-bar',
      url: '/api/terminal/proxy/memon-manual-bar/',
      port: 7685,
      startedAt: '2026-05-15T00:00:00+08:00',
      warnings: [],
    })
    renderWithQuery(<TerminalView mode="raw" sessionName="memon-manual-bar" />)
    await waitFor(() => {
      const posts = bc.channels.flatMap((c) => c.posts)
      expect(posts.length).toBe(1)
    })
    const all = bc.channels.flatMap((c) => c.posts)
    expect(all[0]?.source).toBe('unknown')
  })

  it('failed start does not broadcast', async () => {
    startTerminalMock.mockRejectedValue(new Error('ttyd unavailable'))
    renderWithQuery(
      <TerminalView
        mode="standard"
        project="project-a"
        scope="run"
        slug="foo-260507-103000"
        agent="claude"
        source="manage"
      />,
    )
    // Wait long enough for the rejected promise to settle.
    await new Promise((r) => setTimeout(r, 30))
    const posts = bc.channels.flatMap((c) => c.posts)
    expect(posts).toEqual([])
  })
})

describe('TerminalView broadcast when BroadcastChannel is unavailable', () => {
  let originalBC: unknown
  beforeEach(() => {
    originalBC = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel
  })
  afterEach(() => {
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = originalBC
  })

  it('does not throw when BroadcastChannel is undefined and ready fires', async () => {
    attachTerminalMock.mockResolvedValue({
      sessionName: 'memon-manual-baz',
      url: '/api/terminal/proxy/memon-manual-baz/',
      port: 7686,
      startedAt: '2026-05-15T00:00:00+08:00',
      warnings: [],
    })
    expect(() => {
      renderWithQuery(<TerminalView mode="raw" sessionName="memon-manual-baz" source="popup" />)
    }).not.toThrow()
    // Allow the start/attach promise to settle so the would-be-broadcast
    // path runs and the no-op guard exercises.
    await new Promise((r) => setTimeout(r, 30))
    // Sanity: BroadcastChannel really is undefined right now.
    expect(typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel).toBe('undefined')
  })
})
