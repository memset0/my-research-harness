// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../../lib/path-safety', () => ({
  assertWithinProjectRoots: vi.fn(),
  PathSafetyError: class PathSafetyError extends Error {},
}))

import { GET, PATCH } from './route'
import { getRuntime } from '../../../../lib/runtime'

const DOC = `---
title: bf16 fix
description: fixes NaN
experiment: E0042-attn
created_at: 2026-05-24T15:30:00+08:00
updated_at: 2026-05-24T15:30:00+08:00
commits:
  - repo: .
    sha: aaa111
    url: https://github.com/o/r/commit/aaa111
    reviewed: false
review_todolist:
  - item: check short seq
    done: false
---

# bf16 fix
body line with a literal --- mid text
`

function makeRt() {
  return {
    config: { projects: [{ name: 'p', root: '/proj/p' }] },
    codeReviewPath: (project: string, id: string) =>
      project === 'p' ? `/proj/p/docs/${id}.md` : null,
    codeReviewsCache: { getContent: vi.fn(), putContent: vi.fn() },
  }
}

const P = (parts: string[]) => ({ params: Promise.resolve({ id: parts }) })
const patchReq = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body) })

describe('GET /api/code-reviews/[...id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a parsed experiment-scoped review with completion', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue({ content: DOC, mtime: 10, hash: 'h1' })
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await GET(
      new NextRequest(
        'http://x/api/code-reviews/experiments/E0042-attn/code-review/2026-05-24-bf16-fix?project=p',
      ),
      P(['experiments', 'E0042-attn', 'code-review', '2026-05-24-bf16-fix']),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.scope).toBe('experiment')
    expect(j.experiment).toBe('E0042-attn')
    expect(j.frontmatter.title).toBe('bf16 fix')
    expect(j.body).toContain('literal --- mid text')
    expect(j.completion).toEqual({
      totalCommits: 1,
      reviewedCommits: 0,
      totalTodos: 1,
      doneTodos: 0,
      isComplete: false,
    })
  })

  it('400 on a bad id shape (traversal attempt)', async () => {
    const rt = makeRt()
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await GET(
      new NextRequest('http://x/api/code-reviews/../../etc/passwd?project=p'),
      P(['..', '..', 'etc', 'passwd']),
    )
    expect(res.status).toBe(400)
  })

  it('404 when the file is missing', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue(null)
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await GET(
      new NextRequest('http://x/api/code-reviews/code-review/2026-05-24-x?project=p'),
      P(['code-review', '2026-05-24-x']),
    )
    expect(res.status).toBe(404)
  })

  it('400 when project is missing', async () => {
    const rt = makeRt()
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await GET(
      new NextRequest('http://x/api/code-reviews/code-review/2026-05-24-x'),
      P(['code-review', '2026-05-24-x']),
    )
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/code-reviews/[...id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('toggles a commit, writes bumped content, returns recomputed completion', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue({ content: DOC, mtime: 10, hash: 'h1' })
    rt.codeReviewsCache.putContent.mockResolvedValue({ ok: true, mtime: 11, hash: 'h2' })
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await PATCH(
      patchReq('http://x/api/code-reviews/code-review/2026-05-24-bf16-fix?project=p', {
        op: 'commit',
        sha: 'aaa111',
        reviewed: true,
        expectedMtime: 10,
        expectedHash: 'h1',
      }),
      P(['code-review', '2026-05-24-bf16-fix']),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ok).toBe(true)
    expect(j.mtime).toBe(11)
    expect(j.completion.reviewedCommits).toBe(1)
    expect(j.completion.isComplete).toBe(false) // the todo is still undone
    const written = rt.codeReviewsCache.putContent.mock.calls[0]![1] as string
    expect(written).toContain('reviewed: true')
  })

  it('409 on a stale mtime/hash', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue({ content: DOC, mtime: 99, hash: 'hX' })
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await PATCH(
      patchReq('http://x/api/code-reviews/code-review/2026-05-24-bf16-fix?project=p', {
        op: 'commit',
        sha: 'aaa111',
        reviewed: true,
        expectedMtime: 10,
        expectedHash: 'h1',
      }),
      P(['code-review', '2026-05-24-bf16-fix']),
    )
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.currentMtime).toBe(99)
    expect(rt.codeReviewsCache.putContent).not.toHaveBeenCalled()
  })

  it('400 on an unknown commit sha', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue({ content: DOC, mtime: 10, hash: 'h1' })
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await PATCH(
      patchReq('http://x/api/code-reviews/code-review/2026-05-24-bf16-fix?project=p', {
        op: 'commit',
        sha: 'nope',
        reviewed: true,
        expectedMtime: 10,
        expectedHash: 'h1',
      }),
      P(['code-review', '2026-05-24-bf16-fix']),
    )
    expect(res.status).toBe(400)
  })

  it('toggles a todo by index', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue({ content: DOC, mtime: 10, hash: 'h1' })
    rt.codeReviewsCache.putContent.mockResolvedValue({ ok: true, mtime: 11, hash: 'h2' })
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await PATCH(
      patchReq('http://x/api/code-reviews/code-review/2026-05-24-bf16-fix?project=p', {
        op: 'todo',
        index: 0,
        done: true,
        expectedMtime: 10,
        expectedHash: 'h1',
      }),
      P(['code-review', '2026-05-24-bf16-fix']),
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.completion.doneTodos).toBe(1)
    const written = rt.codeReviewsCache.putContent.mock.calls[0]![1] as string
    expect(written).toContain('done: true')
  })

  it('400 on an out-of-range todo index', async () => {
    const rt = makeRt()
    rt.codeReviewsCache.getContent.mockResolvedValue({ content: DOC, mtime: 10, hash: 'h1' })
    vi.mocked(getRuntime).mockResolvedValue(rt as never)
    const res = await PATCH(
      patchReq('http://x/api/code-reviews/code-review/2026-05-24-bf16-fix?project=p', {
        op: 'todo',
        index: 9,
        done: true,
        expectedMtime: 10,
        expectedHash: 'h1',
      }),
      P(['code-review', '2026-05-24-bf16-fix']),
    )
    expect(res.status).toBe(400)
  })
})
