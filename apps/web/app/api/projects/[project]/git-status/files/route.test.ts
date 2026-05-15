// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitStatusFiles: vi.fn(),
  }
})

import { readGitStatusFiles } from '@memon/core'
import { GET } from './route'
import { getRuntime } from '../../../../../../lib/runtime'

const PAYLOAD = {
  enabled: true as const,
  branch: 'main',
  detached: false,
  sha: 'abcdef0',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  staged: [{ path: 'a.txt', status: 'modified' as const }],
  unstaged: [{ path: 'b.txt', status: 'modified' as const }],
  untracked: [{ path: 'c.txt', status: 'untracked' as const }],
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${name}/git-status/files`,
    { method: 'GET', headers },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [
        { name: 'project-a', root: '/tmp/a', exclude: [] },
        { name: 'project-b', root: '/tmp/b', exclude: [] },
      ],
    },
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
  vi.mocked(readGitStatusFiles).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/git-status/files', () => {
  it('200 with bucketed payload for owner request', async () => {
    const res = await GET(
      req('project-a', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(readGitStatusFiles).toHaveBeenCalledWith('/tmp/a')
  })

  it('404 for unknown project', async () => {
    const res = await GET(
      req('does-not-exist', { 'x-memon-role': 'owner' }),
      paramsFor('does-not-exist'),
    )
    expect(res.status).toBe(404)
    expect(readGitStatusFiles).not.toHaveBeenCalled()
  })

  it('403 for viewer out-of-scope', async () => {
    const res = await GET(
      req('project-b', {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'project-a',
      }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
    expect(readGitStatusFiles).not.toHaveBeenCalled()
  })

  it('200 for viewer in-scope', async () => {
    const res = await GET(
      req('project-a', {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'project-a',
      }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(readGitStatusFiles).toHaveBeenCalledWith('/tmp/a')
  })
})
