// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    readGitRange: vi.fn(),
    readGitSubmodules: vi.fn(),
  }
})

import { readGitRange, readGitSubmodules } from '@memon/core'
import { GET } from './route'
import { getRuntime } from '../../../../../lib/runtime'

const PAYLOAD = {
  enabled: true as const,
  from: 'aaa',
  to: 'bbb',
  commits: [],
  files: [],
}

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${name}/git-range?${query}`,
    { method: 'GET', headers },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [{ name: 'project-a', root: '/tmp/a', exclude: [], execution: { kind: 'local' } }],
    },
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
  vi.mocked(readGitRange).mockResolvedValue(PAYLOAD)
  vi.mocked(readGitSubmodules).mockResolvedValue({
    enabled: true,
    submodules: [{ name: 'vendor/foo', path: 'vendor/foo' }],
  })
})

describe('GET /api/projects/[project]/git-range', () => {
  it('200 for owner with valid from + to', async () => {
    const res = await GET(
      req('project-a', 'from=aaa&to=bbb', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(readGitRange).toHaveBeenCalledWith('/tmp/a', { from: 'aaa', to: 'bbb' }, { exec: undefined })
    const body = await res.json()
    expect(body).toMatchObject({ enabled: true, submodule: '' })
  })

  it('200 scoped to a submodule', async () => {
    const res = await GET(
      req('project-a', 'from=aaa&to=bbb&submodule=vendor%2Ffoo', {
        'x-memon-role': 'owner',
      }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(readGitRange).toHaveBeenCalledWith(
      '/tmp/a/vendor/foo',
      { from: 'aaa', to: 'bbb' },
      { exec: undefined },
    )
    const body = await res.json()
    expect(body.submodule).toBe('vendor/foo')
  })

  it('400 missing from', async () => {
    const res = await GET(
      req('project-a', 'to=bbb', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
  })

  it('400 missing to', async () => {
    const res = await GET(
      req('project-a', 'from=aaa', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
  })

  it('400 invalid sha', async () => {
    const res = await GET(
      req('project-a', 'from=foo%3Brm&to=bbb', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
    expect(readGitRange).not.toHaveBeenCalled()
  })

  it('400 unknown submodule', async () => {
    const res = await GET(
      req('project-a', 'from=aaa&to=bbb&submodule=does-not-exist', {
        'x-memon-role': 'owner',
      }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
    expect(readGitRange).not.toHaveBeenCalled()
  })
})
