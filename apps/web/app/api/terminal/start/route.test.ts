// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/terminal/manager', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/terminal/manager')>(
    '../../../../lib/terminal/manager',
  )
  return {
    ...actual,
    startSession: vi.fn(),
  }
})

vi.mock('../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { getRuntime } from '../../../../lib/runtime'
import { startSession, TerminalManagerError } from '../../../../lib/terminal/manager'
import { POST } from './route'

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/terminal/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

interface FakeRuntimeOpts {
  projects?: { name: string; root: string }[]
  runs?: { id: string; project: string; path: string }[]
  experiments?: { id: string; project: string }[]
  ttydMaxConcurrent?: number
  ttydIdleTtlMinutes?: number
  tmuxEnabled?: boolean
}

function fakeRuntime(opts: FakeRuntimeOpts = {}) {
  const runs = opts.runs ?? []
  const experiments = opts.experiments ?? []
  return {
    config: {
      projects: opts.projects ?? [{ name: 'project-a', root: '/repo/project-a' }],
      terminal: {
        tmuxEnabled: opts.tmuxEnabled ?? true,
        ttydMaxConcurrent: opts.ttydMaxConcurrent ?? 16,
        ttydIdleTtlMinutes: opts.ttydIdleTtlMinutes ?? 30,
      },
    },
    index: {
      list: ({ project }: { project: string }) => runs.filter((r) => r.project === project),
    },
    experiments: new Map(experiments.map((e) => [e.id, e])),
    // biome-ignore lint/suspicious/noExplicitAny: shrunken Runtime stub
  } as any
}

describe('POST /api/terminal/start (tmux-session-rework)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('200 with new sessionName format on a matched run', async () => {
    vi.mocked(getRuntime).mockResolvedValue(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [
          {
            id: 'foo-260507-103000',
            project: 'project-a',
            path: '/repo/project-a/runs/foo-260507-103000',
          },
        ],
      }),
    )
    vi.mocked(startSession).mockResolvedValue({
      sessionName: 'memon-claude-project-a--run--foo-260507-103000',
      port: 7683,
      startedAt: '2026-05-07T10:00:00+08:00',
      lastActiveAt: '2026-05-07T10:00:00+08:00',
      agent: 'claude',
      project: 'project-a',
      scope: 'run',
      slug: 'foo-260507-103000',
      warnings: [],
    })
    const res = await POST(
      postReq({ project: 'project-a', scope: 'run', slug: 'foo-260507-103000', agent: 'claude' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      sessionName: 'memon-claude-project-a--run--foo-260507-103000',
      url: '/api/terminal/proxy/memon-claude-project-a--run--foo-260507-103000/',
      port: 7683,
      warnings: [],
    })
    // The startSession call carries the resolved cwd of the run dir.
    expect(vi.mocked(startSession)).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/project-a/runs/foo-260507-103000' }),
    )
  })

  it('exp scope passes project root as cwd', async () => {
    vi.mocked(getRuntime).mockResolvedValue(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        experiments: [{ id: 'E0042-bar', project: 'project-a' }],
      }),
    )
    vi.mocked(startSession).mockResolvedValue({
      sessionName: 'memon-claude-project-a--exp--E0042-bar',
      port: 7684,
      startedAt: 't',
      lastActiveAt: 't',
      agent: 'claude',
      project: 'project-a',
      scope: 'exp',
      slug: 'E0042-bar',
      warnings: [],
    })
    const res = await POST(
      postReq({ project: 'project-a', scope: 'exp', slug: 'E0042-bar', agent: 'claude' }),
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(startSession)).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/project-a', scope: 'exp' }),
    )
  })

  it('project scope passes project root as cwd with no slug-existence warning', async () => {
    vi.mocked(getRuntime).mockResolvedValue(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
      }),
    )
    vi.mocked(startSession).mockResolvedValue({
      sessionName: 'memon-claude-project-a--project--root',
      port: 7687,
      startedAt: 't',
      lastActiveAt: 't',
      agent: 'claude',
      project: 'project-a',
      scope: 'project',
      slug: 'root',
      warnings: [],
    })
    const res = await POST(
      postReq({ project: 'project-a', scope: 'project', slug: 'root', agent: 'claude' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      sessionName: 'memon-claude-project-a--project--root',
      warnings: [],
    })
    expect(vi.mocked(startSession)).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/project-a', scope: 'project', slug: 'root' }),
    )
  })

  it('warns when run slug not found, falls back to project root', async () => {
    vi.mocked(getRuntime).mockResolvedValue(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
        runs: [],
      }),
    )
    vi.mocked(startSession).mockResolvedValue({
      sessionName: 'memon-claude-project-a--run--missing',
      port: 7685,
      startedAt: 't',
      lastActiveAt: 't',
      agent: 'claude',
      project: 'project-a',
      scope: 'run',
      slug: 'missing',
      warnings: [],
    })
    const res = await POST(
      postReq({ project: 'project-a', scope: 'run', slug: 'missing', agent: 'claude' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings.some((w: string) => w.includes('not found'))).toBe(true)
    expect(vi.mocked(startSession)).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/project-a' }),
    )
  })

  it('warns when project not in config, falls back to HOME', async () => {
    vi.mocked(getRuntime).mockResolvedValue(
      fakeRuntime({
        projects: [{ name: 'project-a', root: '/repo/project-a' }],
      }),
    )
    vi.mocked(startSession).mockResolvedValue({
      sessionName: 'memon-claude-fakeproj--run--anything',
      port: 7686,
      startedAt: 't',
      lastActiveAt: 't',
      agent: 'claude',
      project: 'fakeproj',
      scope: 'run',
      slug: 'anything',
      warnings: [],
    })
    const res = await POST(
      postReq({ project: 'fakeproj', scope: 'run', slug: 'anything', agent: 'claude' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warnings.some((w: string) => w.includes('not in config'))).toBe(true)
  })

  it('400 BAD_REQUEST when slug contains --', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime())
    const res = await POST(postReq({ project: 'project-a', scope: 'run', slug: 'foo--bar' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toMatch(/--/)
    expect(startSession).not.toHaveBeenCalled()
  })

  it('404 without invoking tmux manager when integration is disabled', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime({ tmuxEnabled: false }))
    const res = await POST(postReq({ project: 'project-a', scope: 'project', slug: 'root' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('INTEGRATION_DISABLED')
    expect(startSession).not.toHaveBeenCalled()
  })

  it('400 BAD_REQUEST when project has disallowed character', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime())
    const res = await POST(postReq({ project: 'bad name', scope: 'run', slug: 'foo' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('BAD_REQUEST')
    expect(startSession).not.toHaveBeenCalled()
  })

  it('400 BAD_REQUEST when scope is invalid', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime())
    const res = await POST(postReq({ project: 'project-a', scope: 'invalid', slug: 'foo' }))
    expect(res.status).toBe(400)
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

  it('503 TTYD_UNAVAILABLE bubbles from manager', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime())
    vi.mocked(startSession).mockRejectedValue(
      new TerminalManagerError('TTYD_UNAVAILABLE', 'POST /api/terminal/install first'),
    )
    const res = await POST(postReq({ project: 'project-a', scope: 'run', slug: 'foo' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('TTYD_UNAVAILABLE')
  })

  it('400 when manager rejects on its own (e.g., slug contains --)', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime())
    vi.mocked(startSession).mockRejectedValue(
      new TerminalManagerError('BAD_REQUEST', "slug must not contain '--'"),
    )
    const res = await POST(postReq({ project: 'project-a', scope: 'run', slug: 'foo' }))
    expect(res.status).toBe(400)
  })
})
