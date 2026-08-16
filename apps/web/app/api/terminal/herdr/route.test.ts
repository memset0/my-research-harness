// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/terminal/manager', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/terminal/manager')>(
    '../../../../lib/terminal/manager',
  )
  return { ...actual, startHerdrSession: vi.fn() }
})

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../lib/runtime'
import { startHerdrSession, TerminalManagerError } from '../../../../lib/terminal/manager'
import { POST } from './route'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/terminal/herdr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function runtime(options: { enabled?: boolean } = {}) {
  return {
    config: {
      projects: [{ name: 'project-a', root: '/repo/project-a' }],
      terminal: {
        ...(options.enabled === false ? {} : { herdr: { cli: ['/opt/herdr/bin/herdr'] } }),
        ttydMaxConcurrent: 16,
        ttydIdleTtlMinutes: 30,
      },
    },
    index: {
      list: () => [
        {
          id: 'run-a-260814-120000',
          project: 'project-a',
          path: '/repo/project-a/runs/run-a-260814-120000',
        },
      ],
    },
    experiments: new Map([['E0042-routing', { id: 'E0042-routing', project: 'project-a' }]]),
    // biome-ignore lint/suspicious/noExplicitAny: focused Runtime stub
  } as any
}

const SESSION = {
  backend: 'herdr' as const,
  sessionName: 'memon-herdr',
  port: 7682,
  startedAt: '2026-08-14T00:00:00.000Z',
  lastActiveAt: '2026-08-14T00:00:00.000Z',
  agent: 'none' as const,
  project: '',
  scope: 'project' as const,
  slug: 'herdr',
  warnings: [],
}

describe('POST /api/terminal/herdr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRuntime).mockResolvedValue(runtime())
    vi.mocked(startHerdrSession).mockResolvedValue(SESSION)
  })

  it('opens the global Herdr TUI without creating a target', async () => {
    const response = await POST(request({}))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sessionName: 'memon-herdr',
      url: '/api/terminal/proxy/memon-herdr/',
      port: 7682,
    })
    expect(startHerdrSession).toHaveBeenCalledWith(
      expect.not.objectContaining({ target: expect.anything() }),
    )
  })

  it('maps a project target to the project label and root cwd', async () => {
    const response = await POST(request({ project: 'project-a', scope: 'project', slug: 'root' }))
    expect(response.status).toBe(200)
    expect(startHerdrSession).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/project-a',
        target: { label: 'project-a', cwd: '/repo/project-a' },
      }),
    )
  })

  it('maps a run target to its run directory', async () => {
    const response = await POST(
      request({
        project: 'project-a',
        scope: 'run',
        slug: 'run-a-260814-120000',
      }),
    )
    expect(response.status).toBe(200)
    expect(startHerdrSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          label: 'run-a-260814-120000',
          cwd: '/repo/project-a/runs/run-a-260814-120000',
        },
      }),
    )
  })

  it('returns 404 without invoking the manager when Herdr is disabled', async () => {
    vi.mocked(getRuntime).mockResolvedValue(runtime({ enabled: false }))
    const response = await POST(request({}))
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('INTEGRATION_DISABLED')
    expect(startHerdrSession).not.toHaveBeenCalled()
  })

  it('rejects a partial target tuple', async () => {
    const response = await POST(request({ project: 'project-a' }))
    expect(response.status).toBe(400)
    expect(startHerdrSession).not.toHaveBeenCalled()
  })

  it('maps Herdr manager failures to 503', async () => {
    vi.mocked(startHerdrSession).mockRejectedValue(
      new TerminalManagerError('HERDR_UNAVAILABLE', 'socket unavailable'),
    )
    const response = await POST(request({}))
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('HERDR_UNAVAILABLE')
  })
})
