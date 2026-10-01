// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../../../lib/server/runtime', () => ({
  getRuntime: vi.fn(),
}))

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitStatusFiles: vi.fn(),
    readGitSubmodules: vi.fn(),
  }
})

import { readGitStatusFiles, readGitSubmodules } from '@memon/core'
import { getRuntime } from '../../../../../../lib/server/runtime'
import { GET } from './route'

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
  return new NextRequest(`http://localhost/api/projects/${name}/git-status/files`, {
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
  vi.mocked(readGitStatusFiles).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/git-status/files', () => {
  it('200 with bucketed payload for owner request', async () => {
    const res = await GET(req('project-a', { 'x-memon-role': 'owner' }), paramsFor('project-a'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(readGitStatusFiles).toHaveBeenCalledWith('/tmp/a', { exec: undefined })
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
    expect(readGitStatusFiles).toHaveBeenCalledWith('/tmp/a', { exec: undefined })
  })

  describe('?submodule=<name>', () => {
    it('resolves to the submodule cwd and calls readGitStatusFiles there', async () => {
      vi.mocked(readGitSubmodules).mockResolvedValue({
        enabled: true,
        submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
      })
      const r = new NextRequest(
        'http://localhost/api/projects/project-a/git-status/files?submodule=vendor%2Ffoo',
        { method: 'GET', headers: { 'x-memon-role': 'owner' } },
      )
      const res = await GET(r, paramsFor('project-a'))
      expect(res.status).toBe(200)
      expect(readGitStatusFiles).toHaveBeenCalledWith('/tmp/a/vendor/foo', { exec: undefined })
    })

    it('400 for an unknown submodule name', async () => {
      vi.mocked(readGitSubmodules).mockResolvedValue({
        enabled: true,
        submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
      })
      const r = new NextRequest(
        'http://localhost/api/projects/project-a/git-status/files?submodule=does-not-exist',
        { method: 'GET', headers: { 'x-memon-role': 'owner' } },
      )
      const res = await GET(r, paramsFor('project-a'))
      expect(res.status).toBe(400)
      expect(readGitStatusFiles).not.toHaveBeenCalled()
    })
  })
})
