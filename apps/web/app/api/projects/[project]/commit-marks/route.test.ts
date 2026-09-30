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
    readCommitMarks: vi.fn(),
  }
})

import { readCommitMarks } from '@memon/core'
import { getRuntime } from '../../../../../lib/runtime'
import { GET } from './route'

const PAYLOAD = {
  marks: [
    {
      sha: 'abc1234',
      status: 'verified' as const,
      note: '',
      updatedAt: '2026-05-15T12:00:00+08:00',
      submodule: '',
    },
  ],
  parseWarnings: [],
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/commit-marks`, {
    method: 'GET',
    headers,
  })
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
  vi.mocked(readCommitMarks).mockResolvedValue(PAYLOAD)
})

describe('GET /api/projects/[project]/commit-marks', () => {
  it('200 for owner', async () => {
    const res = await GET(req('project-a', { 'x-memon-role': 'owner' }), paramsFor('project-a'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAYLOAD)
    expect(readCommitMarks).toHaveBeenCalledWith('/tmp/a')
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
    expect(readCommitMarks).not.toHaveBeenCalled()
  })

  it('404 for unknown project', async () => {
    const res = await GET(req('nope', { 'x-memon-role': 'owner' }), paramsFor('nope'))
    expect(res.status).toBe(404)
  })
})
