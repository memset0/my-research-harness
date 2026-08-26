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

const start = vi.fn()
const service = { start, target: () => 'http://127.0.0.1:7683' }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/terminal/start', {
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
  start.mockResolvedValue({
    host: 'standalone',
    backend: 'tmux',
    sessionName: 'memon-codex-project-a--run--run-a',
    url: '/api/terminal/proxy/standalone/memon-codex-project-a--run--run-a/',
    startedAt: '2026-08-26T00:00:00Z',
    lastActiveAt: '2026-08-26T00:00:00Z',
    agent: 'codex',
    project: 'project-a',
    scope: 'run',
    slug: 'run-a',
    warnings: ['fallback warning'],
  })
})

describe('POST /api/terminal/start shared adapter', () => {
  it('preserves the standalone URL/port contract', async () => {
    const input = { project: 'project-a', scope: 'run', slug: 'run-a', agent: 'codex' }
    const response = await POST(request(input))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sessionName: 'memon-codex-project-a--run--run-a',
      url: '/api/terminal/proxy/memon-codex-project-a--run--run-a/',
      port: 7683,
      warnings: ['fallback warning'],
    })
    expect(start).toHaveBeenCalledWith(input)
  })

  it('rejects invalid target shapes before invoking the service', async () => {
    expect(
      (await POST(request({ project: 'bad project', scope: 'run', slug: '../bad' }))).status,
    ).toBe(400)
    expect(start).not.toHaveBeenCalled()
  })

  it('preserves the standalone integration-disabled response', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { terminal: { tmuxEnabled: false } },
    } as never)
    expect(
      (await POST(request({ project: 'project-a', scope: 'project', slug: 'root' }))).status,
    ).toBe(404)
  })
})
