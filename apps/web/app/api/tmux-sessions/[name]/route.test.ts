// @vitest-environment node
import { BackendTerminalServiceError } from '@memon/backend'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/server/standalone-terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/server/standalone-terminal')>()),
  standaloneTerminal: vi.fn(),
}))

import { getRuntime } from '../../../../lib/runtime'
import { standaloneTerminal } from '../../../../lib/server/standalone-terminal'
import { DELETE, GET } from './route'

const getTmux = vi.fn()
const killTmux = vi.fn()
const service = { getTmux, killTmux }
const context = (name: string) => ({ params: Promise.resolve({ name }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { terminal: { tmuxEnabled: true } },
  } as never)
  vi.mocked(standaloneTerminal).mockReturnValue(service as never)
  getTmux.mockResolvedValue({
    row: {
      host: 'standalone',
      sessionName: 'memon-manual-foo',
      parsed: {
        raw: 'memon-manual-foo',
        agent: null,
        project: null,
        scope: null,
        slug: null,
        legacy: false,
      },
      liveEntry: null,
      tmuxCreatedAt: '2026-05-13T00:00:00.000Z',
      tmuxLastActivity: '2026-05-13T00:01:00.000Z',
      matchable: false,
      staleReason: null,
      pane: { title: 'hello', currentCommand: 'bash', currentPath: null },
      state: 'idle',
      lastStateChangeAt: null,
    },
  })
  killTmux.mockResolvedValue({ ok: true, host: 'standalone', sessionName: 'memon-manual-foo' })
})

describe('/api/tmux-sessions/[name] shared adapter', () => {
  it('returns a host-free enriched row', async () => {
    const response = await GET({} as never, context('memon-manual-foo'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.row.sessionName).toBe('memon-manual-foo')
    expect(body.row).not.toHaveProperty('host')
  })

  it('maps missing and malformed sessions safely', async () => {
    getTmux
      .mockRejectedValueOnce(
        new BackendTerminalServiceError('PROJECT_NOT_FOUND', 'tmux session not found'),
      )
      .mockRejectedValueOnce(new BackendTerminalServiceError('BAD_REQUEST', 'invalid name'))
    expect((await GET({} as never, context('memon-missing'))).status).toBe(404)
    expect((await GET({} as never, context('../bad'))).status).toBe(400)
  })

  it('kills an exact shared tmux session and preserves disabled behavior', async () => {
    const response = await DELETE({} as never, context('memon-manual-foo'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(killTmux).toHaveBeenCalledWith('memon-manual-foo')
    vi.mocked(getRuntime).mockResolvedValue({
      config: { terminal: { tmuxEnabled: false } },
    } as never)
    expect((await DELETE({} as never, context('memon-manual-foo'))).status).toBe(404)
  })
})
