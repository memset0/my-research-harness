// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendCodeReviewResponseSchema: { parse: (value: unknown) => value },
  BackendCodeReviewPatchResponseSchema: { parse: (value: unknown) => value },
}))

import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneServices } from '../../../../lib/server/standalone-services'
import { GET, PATCH } from './route'

const getCodeReview = vi.fn()
const patchCodeReview = vi.fn()
const context = { params: Promise.resolve({ id: ['code-review', '2026-05-24-review'] }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: 'p', root: '/root' }] },
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({
    documents: { getCodeReview, patchCodeReview },
  } as never)
  getCodeReview.mockResolvedValue({ id: 'code-review/2026-05-24-review', project: 'p' })
  patchCodeReview.mockResolvedValue({
    ok: true,
    mtime: 2,
    hash: 'a'.repeat(40),
    completion: {
      totalCommits: 1,
      reviewedCommits: 1,
      totalTodos: 0,
      doneTodos: 0,
      isComplete: true,
    },
  })
})

describe('/api/code-reviews/[...id] shared adapter', () => {
  it('reads an exact shared resource', async () => {
    const response = await GET(new NextRequest('http://x/api/code-reviews/x?project=p'), context)
    expect(response.status).toBe(200)
    expect(getCodeReview).toHaveBeenCalledWith('p', 'code-review/2026-05-24-review')
  })

  it('patches through the shared optimistic-lock service', async () => {
    const input = {
      op: 'commit',
      sha: 'abc123',
      reviewed: true,
      expectedMtime: 1,
      expectedHash: 'a'.repeat(40),
    }
    const response = await PATCH(
      new NextRequest('http://x/api/code-reviews/x?project=p', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
      context,
    )
    expect(response.status).toBe(200)
    expect(patchCodeReview).toHaveBeenCalledWith('p', 'code-review/2026-05-24-review', input)
  })
})
