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
    readGitSubmodules: vi.fn(),
  }
})

import { readGitSubmodules } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { GET } from './route'

const PAYLOAD = {
  enabled: true as const,
  submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/submodules`, {
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
  vi.mocked(readGitSubmodules).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/submodules', () => {
  it('200 for owner with payload', async () => {
    const res = await GET(req('project-a', { 'x-memon-role': 'owner' }), paramsFor('project-a'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(readGitSubmodules).toHaveBeenCalledWith('/tmp/a', { exec: undefined })
  })

  it('200 for viewer in scope', async () => {
    const res = await GET(
      req('project-a', { 'x-memon-role': 'viewer', 'x-memon-scope': 'project-a' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
  })

  it('403 for viewer out of scope', async () => {
    const res = await GET(
      req('project-b', { 'x-memon-role': 'viewer', 'x-memon-scope': 'project-a' }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
    expect(readGitSubmodules).not.toHaveBeenCalled()
  })

  it('404 unknown project', async () => {
    const res = await GET(req('nope', { 'x-memon-role': 'owner' }), paramsFor('nope'))
    expect(res.status).toBe(404)
  })
})
