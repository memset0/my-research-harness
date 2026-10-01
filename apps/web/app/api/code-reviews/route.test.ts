// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('../../../lib/server/standalone-dto', () => ({
  standaloneCodeReview: vi.fn((_config, review) => ({ ...review, path: `/root/${review.id}.md` })),
}))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendCodeReviewsResponseSchema: { parse: (value: unknown) => value },
}))

import { getRuntime } from '../../../lib/server/runtime'
import { standaloneServices } from '../../../lib/server/standalone-services'
import { GET } from './route'

const listCodeReviews = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: 'p', root: '/root', include: [], exclude: [] }] },
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({ documents: { listCodeReviews } } as never)
  listCodeReviews.mockResolvedValue({
    codeReviews: [
      { id: 'code-review/review', project: 'p', resource: 'docs/code-review/review.md' },
    ],
  })
})

describe('GET /api/code-reviews shared adapter', () => {
  it('returns shared records with legacy paths', async () => {
    const response = await GET(new NextRequest('http://x/api/code-reviews?project=p'))
    expect(response.status).toBe(200)
    expect((await response.json()).codeReviews[0].path).toBe('/root/code-review/review.md')
  })

  it('rejects missing and unknown Projects', async () => {
    expect((await GET(new NextRequest('http://x/api/code-reviews'))).status).toBe(400)
    expect((await GET(new NextRequest('http://x/api/code-reviews?project=ghost'))).status).toBe(404)
  })
})
