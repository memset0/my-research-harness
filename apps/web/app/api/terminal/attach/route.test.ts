// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/server/standalone-terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/server/standalone-terminal')>()),
  standaloneTerminal: vi.fn(),
}))

import { getRuntime } from '../../../../lib/runtime'
import { standaloneTerminal } from '../../../../lib/server/standalone-terminal'
import { POST } from './route'

const attach = vi.fn()
const service = { attach, target: () => 'http://127.0.0.1:7682' }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/terminal/attach', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { terminal: { tmuxEnabled: true } },
  } as never)
  vi.mocked(standaloneTerminal).mockReturnValue(service as never)
  attach.mockResolvedValue({
    host: 'standalone',
    backend: 'tmux',
    sessionName: 'memon-manual-demo',
    url: '/api/terminal/proxy/standalone/memon-manual-demo/',
    startedAt: '2026-08-26T00:00:00Z',
    lastActiveAt: '2026-08-26T00:00:00Z',
    agent: 'none',
    project: null,
    scope: null,
    slug: null,
    warnings: [],
  })
})

describe('POST /api/terminal/attach shared adapter', () => {
  it('maps the shared session to the standalone proxy URL and port', async () => {
    const response = await POST(request({ sessionName: 'memon-manual-demo' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sessionName: 'memon-manual-demo',
      url: '/api/terminal/proxy/memon-manual-demo/',
      port: 7682,
    })
    expect(attach).toHaveBeenCalledWith({ sessionName: 'memon-manual-demo' })
  })

  it('rejects malformed JSON/session names and disabled tmux', async () => {
    expect((await POST(request({ sessionName: '../bad' }))).status).toBe(400)
    vi.mocked(getRuntime).mockResolvedValue({
      config: { terminal: { tmuxEnabled: false } },
    } as never)
    expect((await POST(request({ sessionName: 'memon-manual-demo' }))).status).toBe(404)
  })
})
