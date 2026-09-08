// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitStatus: vi.fn(),
  }
})

import { readGitStatus } from '@memon/core'
import { GET, __resetGitStatusCacheForTests } from './route'
import { getRuntime } from '../../../../../lib/runtime'

const CLEAN_STATUS = {
  enabled: true as const,
  branch: 'main',
  detached: false,
  sha: 'abcdef0',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  dirty: false,
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/git-status`, {
    method: 'GET',
    headers,
  })
}

beforeEach(() => {
  __resetGitStatusCacheForTests()
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [
        { name: 'project-a', root: '/tmp/a', exclude: [], execution: { kind: 'local' } },
        { name: 'project-b', root: '/tmp/b', exclude: [], execution: { kind: 'local' } },
      ],
      gitStatus: { intervalMs: 10_000 },
    },
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
  vi.mocked(readGitStatus).mockResolvedValue(CLEAN_STATUS)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/projects/[project]/git-status', () => {
  it('200 with body for an owner request to a known project', async () => {
    const res = await GET(
      req('project-a', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(CLEAN_STATUS)
    expect(readGitStatus).toHaveBeenCalledTimes(1)
    expect(readGitStatus).toHaveBeenCalledWith('/tmp/a', { exec: undefined })
  })

  it('404 for an unknown project', async () => {
    const res = await GET(
      req('does-not-exist', { 'x-memon-role': 'owner' }),
      paramsFor('does-not-exist'),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { message: 'project not found' } })
    expect(readGitStatus).not.toHaveBeenCalled()
  })

  it('403 when viewer requests a project outside scope', async () => {
    const res = await GET(
      req('project-b', { 'x-memon-role': 'viewer', 'x-memon-scope': 'project-a' }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
    expect(readGitStatus).not.toHaveBeenCalled()
  })

  it('200 when viewer requests a project in scope', async () => {
    const res = await GET(
      req('project-a', { 'x-memon-role': 'viewer', 'x-memon-scope': 'project-a' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(readGitStatus).toHaveBeenCalledTimes(1)
    expect(readGitStatus).toHaveBeenCalledWith('/tmp/a', { exec: undefined })
  })

  it('two requests within intervalMs use the throttle cache (single reader call)', async () => {
    const r1 = await GET(
      req('project-a', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(r1.status).toBe(200)
    const r2 = await GET(
      req('project-a', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(r2.status).toBe(200)
    expect(await r2.json()).toEqual(CLEAN_STATUS)
    // Critical: the reader is invoked exactly once across both requests.
    expect(readGitStatus).toHaveBeenCalledTimes(1)
  })

  it('throttle expires after configured intervalMs (second call hits the reader again)', async () => {
    // Pin Date.now() to step through the throttle window. Default
    // intervalMs is 10_000 (from the beforeEach mock); a 12s gap must
    // bust the cache.
    const dateNowSpy = vi.spyOn(Date, 'now')
    try {
      dateNowSpy.mockReturnValue(0)
      await GET(
        req('project-a', { 'x-memon-role': 'owner' }),
        paramsFor('project-a'),
      )
      dateNowSpy.mockReturnValue(12_000)
      await GET(
        req('project-a', { 'x-memon-role': 'owner' }),
        paramsFor('project-a'),
      )
      expect(readGitStatus).toHaveBeenCalledTimes(2)
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  it('throttle window tracks runtime.config.gitStatus.intervalMs', async () => {
    // Override the default mock to use a much shorter interval, then prove
    // a 2s gap is enough to bust the cache.
    vi.mocked(getRuntime).mockResolvedValueOnce({
      config: {
        projects: [{ name: 'project-a', root: '/tmp/a', exclude: [], execution: { kind: 'local' } }],
        gitStatus: { intervalMs: 1_000 },
      },
    } as unknown as Awaited<ReturnType<typeof getRuntime>>)
    vi.mocked(getRuntime).mockResolvedValueOnce({
      config: {
        projects: [{ name: 'project-a', root: '/tmp/a', exclude: [], execution: { kind: 'local' } }],
        gitStatus: { intervalMs: 1_000 },
      },
    } as unknown as Awaited<ReturnType<typeof getRuntime>>)
    const dateNowSpy = vi.spyOn(Date, 'now')
    try {
      dateNowSpy.mockReturnValue(0)
      await GET(
        req('project-a', { 'x-memon-role': 'owner' }),
        paramsFor('project-a'),
      )
      dateNowSpy.mockReturnValue(2_000)
      await GET(
        req('project-a', { 'x-memon-role': 'owner' }),
        paramsFor('project-a'),
      )
      expect(readGitStatus).toHaveBeenCalledTimes(2)
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  it('passes through enabled=false responses verbatim', async () => {
    vi.mocked(readGitStatus).mockResolvedValueOnce({
      enabled: false,
      reason: 'not-a-repo',
    })
    const res = await GET(
      req('project-a', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false, reason: 'not-a-repo' })
  })
})
