// @vitest-environment node

import { paramsFor } from '@memon/test-utils'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/server/runtime', () => ({
  getRuntime: vi.fn(),
}))

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitLog: vi.fn(),
  }
})

import { readGitLog } from '@memon/core'
import { getRuntime } from '../../../../../lib/server/runtime'
import { GET } from './route'

const PAYLOAD = {
  enabled: true as const,
  commits: [
    {
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      subject: 'newest',
      authorName: 'Test',
      authorEmail: 'test@example.com',
      authorDate: '2026-05-15T12:00:00+08:00',
      parents: ['b'.repeat(40)],
    },
  ],
}

function req(name: string, query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/git-log?${query}`, {
    method: 'GET',
    headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [
        { name: 'project-a', root: '/tmp/a', exclude: [], execution: { kind: 'local' } },
        { name: 'project-b', root: '/tmp/b', exclude: [], execution: { kind: 'local' } },
      ],
    },
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
  vi.mocked(readGitLog).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/git-log', () => {
  it('200 for owner with default limit 100', async () => {
    const res = await GET(
      req('project-a', 'ref=main', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(readGitLog).toHaveBeenCalledWith(
      '/tmp/a',
      { ref: 'main', limit: 100 },
      { exec: undefined },
    )
  })

  it('200 with custom limit', async () => {
    const res = await GET(
      req('project-a', 'ref=main&limit=25', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(readGitLog).toHaveBeenCalledWith(
      '/tmp/a',
      { ref: 'main', limit: 25 },
      { exec: undefined },
    )
  })

  it('400 missing ref', async () => {
    const res = await GET(
      req('project-a', 'limit=50', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
    expect(readGitLog).not.toHaveBeenCalled()
  })

  it('400 invalid ref', async () => {
    const res = await GET(
      req('project-a', 'ref=foo%3Brm', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
    expect(readGitLog).not.toHaveBeenCalled()
  })

  it('400 limit out of range', async () => {
    const res = await GET(
      req('project-a', 'ref=main&limit=99999', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
  })

  it('400 non-integer limit', async () => {
    const res = await GET(
      req('project-a', 'ref=main&limit=abc', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
  })

  it('404 unknown project', async () => {
    const res = await GET(req('nope', 'ref=main', { 'x-memon-role': 'owner' }), paramsFor('nope'))
    expect(res.status).toBe(404)
  })

  it('403 viewer out of scope', async () => {
    const res = await GET(
      req('project-b', 'ref=main', {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'project-a',
      }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
  })
})
