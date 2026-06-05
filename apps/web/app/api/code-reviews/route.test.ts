// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { GET } from './route'
import { getRuntime } from '../../../lib/runtime'

describe('GET /api/code-reviews', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the aggregated list for a known project', async () => {
    const rt = {
      config: { projects: [{ name: 'p', root: '/proj/p' }] },
      getCodeReviewsList: vi.fn(() => [
        { id: 'code-review/2026-05-24-x', scope: 'project', experiment: null },
        { id: 'experiments/E0001-a/code-review/2026-05-20-y', scope: 'experiment', experiment: 'E0001-a' },
      ]),
    }
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await GET(new NextRequest('http://x/api/code-reviews?project=p'))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.codeReviews).toHaveLength(2)
    expect(rt.getCodeReviewsList).toHaveBeenCalledWith('p')
  })

  it('400 without a project query param', async () => {
    vi.mocked(getRuntime).mockResolvedValue({ config: { projects: [] } } as never)
    const res = await GET(new NextRequest('http://x/api/code-reviews'))
    expect(res.status).toBe(400)
  })

  it('404 for an unknown project', async () => {
    const rt = { config: { projects: [{ name: 'p', root: '/x' }] }, getCodeReviewsList: vi.fn(() => []) }
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await GET(new NextRequest('http://x/api/code-reviews?project=zzz'))
    expect(res.status).toBe(404)
  })
})
