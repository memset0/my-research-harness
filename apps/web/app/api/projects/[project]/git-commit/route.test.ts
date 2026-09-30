// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitCommit: vi.fn(),
  }
})

import { readGitCommit } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { GET } from './route'

const PAYLOAD = {
  enabled: true as const,
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  subject: 'fix bug',
  body: 'long\ndescription',
  authorName: 'Test',
  authorEmail: 'test@example.com',
  authorDate: '2026-05-15T12:00:00+08:00',
  parents: ['b'.repeat(40)],
  files: [{ path: 'app.ts', status: 'modified' as const }],
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/git-commit?${query}`, {
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
  vi.mocked(readGitCommit).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/git-commit', () => {
  it('200 with payload for owner', async () => {
    const res = await GET(
      req('project-a', 'sha=abc1234', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(readGitCommit).toHaveBeenCalledWith('/tmp/a', 'abc1234', { exec: undefined })
  })

  it('400 missing sha', async () => {
    const res = await GET(req('project-a', '', { 'x-memon-role': 'owner' }), paramsFor('project-a'))
    expect(res.status).toBe(400)
    expect(readGitCommit).not.toHaveBeenCalled()
  })

  it('400 invalid sha', async () => {
    const res = await GET(
      req('project-a', 'sha=foo%3Brm', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
    expect(readGitCommit).not.toHaveBeenCalled()
  })

  it('passes through enabled=false reason=not-found from the reader', async () => {
    vi.mocked(readGitCommit).mockResolvedValueOnce({
      enabled: false,
      reason: 'not-found',
    })
    const res = await GET(
      req('project-a', 'sha=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', {
        'x-memon-role': 'owner',
      }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false, reason: 'not-found' })
  })

  it('404 unknown project', async () => {
    const res = await GET(
      req('nope', 'sha=abc1234', { 'x-memon-role': 'owner' }),
      paramsFor('nope'),
    )
    expect(res.status).toBe(404)
  })

  it('403 viewer out of scope', async () => {
    const res = await GET(
      req('project-b', 'sha=abc1234', {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'project-a',
      }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
  })
})
