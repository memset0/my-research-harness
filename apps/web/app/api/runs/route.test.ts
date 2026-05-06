// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

// `isStaleRunning` from @memon/core is called for each experiment — stub it
// deterministically so test assertions don't depend on real time.
vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memon/core')>()
  return {
    ...actual,
    isStaleRunning: vi.fn(() => false),
  }
})

import { GET } from './route'
import { getRuntime } from '../../../lib/runtime'

const SAMPLE_EXP = {
  id: 'foo-260501-100000',
  path: '/p/a/logs/foo-260501-100000',
  mtime: 1000,
  hasReadme: true,
  frontMatter: {
    name: 'foo',
    project: 'a',
    status: 'FINISHED',
    createdAt: '2026-05-01T10:00:00+08:00',
  },
  parseErrors: [],
  parseWarnings: [],
}

describe('GET /api/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns indexed experiments with stale flag attached', async () => {
    const list = vi.fn(() => [SAMPLE_EXP])
    vi.mocked(getRuntime).mockResolvedValue({ index: { list } } as never)

    const res = await GET(new NextRequest('http://localhost/api/runs'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.experiments).toHaveLength(1)
    expect(body.experiments[0]).toMatchObject({
      id: 'foo-260501-100000',
      stale: false,
      frontMatter: { status: 'FINISHED' },
    })
    expect(list).toHaveBeenCalledWith({ project: undefined })
  })

  it('passes ?project filter through to index.list', async () => {
    const list = vi.fn(() => [])
    vi.mocked(getRuntime).mockResolvedValue({ index: { list } } as never)

    await GET(new NextRequest('http://localhost/api/runs?project=project-a'))
    expect(list).toHaveBeenCalledWith({ project: 'project-a' })
  })
})
