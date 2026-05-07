// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../../lib/terminal/manager', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/terminal/manager')>(
    '../../../../lib/terminal/manager',
  )
  return {
    ...actual,
    startSession: vi.fn(),
  }
})

import { POST } from './route'
import { TerminalManagerError, startSession } from '../../../../lib/terminal/manager'

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/terminal/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/terminal/start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('200 returns sessionName + url + port', async () => {
    vi.mocked(startSession).mockResolvedValue({
      sessionName: 'memon-claude-foo',
      port: 7682,
      startedAt: '2026-05-04T10:00:00+08:00',
      runId: 'foo',
      projectName: 'a',
      agent: 'claude',
      warnings: [],
    })
    const res = await POST(postReq({ runId: 'foo', projectName: 'a' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      sessionName: 'memon-claude-foo',
      url: '/api/terminal/proxy/memon-claude-foo/',
      port: 7682,
    })
  })

  it('400 BAD_REQUEST on missing fields', async () => {
    const res = await POST(postReq({ runId: 'foo' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(startSession).not.toHaveBeenCalled()
  })

  it('400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/terminal/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('400 BAD_REQUEST when manager rejects runId', async () => {
    vi.mocked(startSession).mockRejectedValue(
      new TerminalManagerError('BAD_REQUEST', 'runId malformed'),
    )
    const res = await POST(postReq({ runId: 'bad space', projectName: 'a' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
  })

  it('503 TTYD_UNAVAILABLE when ttyd missing', async () => {
    vi.mocked(startSession).mockRejectedValue(
      new TerminalManagerError('TTYD_UNAVAILABLE', 'POST /api/terminal/install first'),
    )
    const res = await POST(postReq({ runId: 'foo', projectName: 'a' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('TTYD_UNAVAILABLE')
  })
})
