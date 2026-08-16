// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/terminal/manager', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/terminal/manager')>(
    '../../../../lib/terminal/manager',
  )
  return {
    ...actual,
    attachExistingSession: vi.fn(),
  }
})

vi.mock('../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { getRuntime } from '../../../../lib/runtime'
import { attachExistingSession, TerminalManagerError } from '../../../../lib/terminal/manager'
import { POST } from './route'

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/terminal/attach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const fakeRuntime = {
  config: {
    terminal: { tmuxEnabled: true, ttydMaxConcurrent: 16, ttydIdleTtlMinutes: 30 },
  },
  // biome-ignore lint/suspicious/noExplicitAny: shrunken Runtime stub
} as any

describe('POST /api/terminal/attach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime)
  })

  it('200 returns sessionName + url + port for a valid name', async () => {
    vi.mocked(attachExistingSession).mockResolvedValue({
      sessionName: 'memon-manual-foo',
      port: 7685,
      startedAt: '2026-05-08T20:00:00.000Z',
      lastActiveAt: '2026-05-08T20:00:00.000Z',
      agent: 'none',
      project: '',
      scope: 'run',
      slug: '',
      warnings: [],
    })
    const res = await POST(postReq({ sessionName: 'memon-manual-foo' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      sessionName: 'memon-manual-foo',
      url: '/api/terminal/proxy/memon-manual-foo/',
      port: 7685,
      warnings: [],
    })
  })

  it('400 BAD_REQUEST when sessionName missing', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(attachExistingSession).not.toHaveBeenCalled()
  })

  it('404 without invoking attach when tmux is disabled', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: {
        terminal: {
          tmuxEnabled: false,
          ttydMaxConcurrent: 16,
          ttydIdleTtlMinutes: 30,
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: shrunken Runtime stub
    } as any)
    const res = await POST(postReq({ sessionName: 'memon-manual-foo' }))
    expect(res.status).toBe(404)
    expect(attachExistingSession).not.toHaveBeenCalled()
  })

  it('400 BAD_REQUEST when sessionName does not start with memon-', async () => {
    const res = await POST(postReq({ sessionName: 'not-memon' }))
    expect(res.status).toBe(400)
    expect(attachExistingSession).not.toHaveBeenCalled()
  })

  it('400 BAD_REQUEST when sessionName has disallowed character', async () => {
    const res = await POST(postReq({ sessionName: 'memon- foo' }))
    expect(res.status).toBe(400)
  })

  it('400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/terminal/attach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('503 TTYD_UNAVAILABLE bubbles from manager', async () => {
    vi.mocked(attachExistingSession).mockRejectedValue(
      new TerminalManagerError('TTYD_UNAVAILABLE', 'POST /api/terminal/install first'),
    )
    const res = await POST(postReq({ sessionName: 'memon-manual-foo' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('TTYD_UNAVAILABLE')
  })

  it('400 when manager throws BAD_REQUEST (e.g. internal validation)', async () => {
    vi.mocked(attachExistingSession).mockRejectedValue(
      new TerminalManagerError('BAD_REQUEST', 'sessionName must match ...'),
    )
    const res = await POST(postReq({ sessionName: 'memon-foo' }))
    expect(res.status).toBe(400)
  })
})
