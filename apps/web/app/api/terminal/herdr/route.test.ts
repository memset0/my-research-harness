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

const startHerdr = vi.fn()
const service = { startHerdr, target: () => 'http://127.0.0.1:7684' }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/terminal/herdr', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { terminal: { herdr: { cli: ['herdr'] } } },
  } as never)
  vi.mocked(standaloneTerminal).mockReturnValue(service as never)
  startHerdr.mockResolvedValue({
    host: 'standalone',
    backend: 'herdr',
    sessionName: 'memon-herdr',
    url: '/api/terminal/proxy/standalone/memon-herdr/',
    startedAt: '2026-08-26T00:00:00Z',
    lastActiveAt: '2026-08-26T00:00:00Z',
    agent: 'none',
    project: 'project-a',
    scope: 'project',
    slug: 'root',
    warnings: [],
  })
})

describe('POST /api/terminal/herdr shared adapter', () => {
  it('maps the shared Herdr session to standalone proxy routing', async () => {
    const input = { project: 'project-a', scope: 'project', slug: 'root' }
    const response = await POST(request(input))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      backend: 'herdr',
      url: '/api/terminal/proxy/memon-herdr/',
      port: 7684,
    })
    expect(startHerdr).toHaveBeenCalledWith(input)
  })

  it('accepts an empty target and rejects partial target tuples', async () => {
    expect((await POST(request({}))).status).toBe(200)
    expect((await POST(request({ project: 'project-a' }))).status).toBe(400)
  })

  it('returns 404 when Herdr is not configured', async () => {
    vi.mocked(getRuntime).mockResolvedValue({ config: { terminal: {} } } as never)
    expect((await POST(request({}))).status).toBe(404)
  })
})
