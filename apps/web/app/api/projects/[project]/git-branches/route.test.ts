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
    readGitBranches: vi.fn(),
  }
})

import { readGitBranches } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { GET } from './route'

const PAYLOAD = {
  enabled: true as const,
  current: 'main',
  detached: false,
  sha: 'abcdef0',
  branches: [
    { name: 'main', sha: 'abcdef0', isCurrent: true },
    { name: 'feature/x', sha: '1234567', isCurrent: false },
  ],
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/git-branches`, {
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
  vi.mocked(readGitBranches).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/git-branches', () => {
  it('200 with payload for owner', async () => {
    const res = await GET(req('project-a', { 'x-memon-role': 'owner' }), paramsFor('project-a'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(readGitBranches).toHaveBeenCalledWith('/tmp/a', { exec: undefined })
  })

  it('404 unknown project', async () => {
    const res = await GET(req('nope', { 'x-memon-role': 'owner' }), paramsFor('nope'))
    expect(res.status).toBe(404)
    expect(readGitBranches).not.toHaveBeenCalled()
  })

  it('403 viewer out of scope', async () => {
    const res = await GET(
      req('project-b', { 'x-memon-role': 'viewer', 'x-memon-scope': 'project-a' }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
    expect(readGitBranches).not.toHaveBeenCalled()
  })
})
