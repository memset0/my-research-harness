// @vitest-environment node
import { BackendTerminalServiceError } from '@memon/backend'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../../lib/server/standalone-terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../lib/server/standalone-terminal')>()),
  standaloneTerminal: vi.fn(),
}))

import { getRuntime } from '../../../../../lib/runtime'
import { standaloneTerminal } from '../../../../../lib/server/standalone-terminal'
import { POST } from './route'

const renameTmux = vi.fn()
const context = (name: string) => ({ params: Promise.resolve({ name }) })
const request = (body: unknown) =>
  new Request('http://localhost/api/tmux-sessions/x/rename', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { terminal: { tmuxEnabled: true } },
  } as never)
  vi.mocked(standaloneTerminal).mockReturnValue({ renameTmux } as never)
  renameTmux.mockResolvedValue({
    ok: true,
    host: 'standalone',
    sessionName: 'memon-manual-new',
  })
})

describe('POST /api/tmux-sessions/[name]/rename shared adapter', () => {
  it('renames and strips Backend Host metadata', async () => {
    const response = await POST(
      request({ newName: 'memon-manual-new' }) as never,
      context('memon-manual-old'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, sessionName: 'memon-manual-new' })
    expect(renameTmux).toHaveBeenCalledWith('memon-manual-old', {
      newName: 'memon-manual-new',
    })
  })

  it('rejects invalid names and maps missing/conflict errors', async () => {
    expect(
      (await POST(request({ newName: 'bad' }) as never, context('memon-manual-old'))).status,
    ).toBe(400)
    renameTmux.mockRejectedValueOnce(
      new BackendTerminalServiceError('PROJECT_NOT_FOUND', 'tmux session not found'),
    )
    expect(
      (await POST(request({ newName: 'memon-manual-new' }) as never, context('memon-manual-old')))
        .status,
    ).toBe(404)
    renameTmux.mockRejectedValueOnce(
      new BackendTerminalServiceError('CONFLICT', 'target already exists'),
    )
    expect(
      (await POST(request({ newName: 'memon-manual-new' }) as never, context('memon-manual-old')))
        .status,
    ).toBe(409)
  })
})
