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
    readGitFileContents: vi.fn(),
  }
})

import { readGitFileContents } from '@memon/core'
import { GET } from './route'
import { getRuntime } from '../../../../../lib/runtime'

function paramsFor(name: string) {
  return { params: Promise.resolve({ project: name }) }
}

function req(name: string, query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    `http://localhost/api/projects/${name}/git-diff?${query}`,
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
})

describe('GET /api/projects/[project]/git-diff', () => {
  it('200 ok=true for an unstaged text file', async () => {
    vi.mocked(readGitFileContents)
      .mockResolvedValueOnce({ ok: true, content: 'old\n' })
      .mockResolvedValueOnce({ ok: true, content: 'new\n' })
    const res = await GET(
      req('project-a', 'path=app.ts&side=unstaged', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      filename: 'app.ts',
      status: 'modified',
      oldContent: 'old\n',
      newContent: 'new\n',
    })
    expect(readGitFileContents).toHaveBeenNthCalledWith(1, '/tmp/a', 'index', 'app.ts')
    expect(readGitFileContents).toHaveBeenNthCalledWith(2, '/tmp/a', 'working', 'app.ts')
  })

  it('untracked: oldContent=null, newContent from working', async () => {
    vi.mocked(readGitFileContents).mockResolvedValueOnce({
      ok: true,
      content: 'fresh\n',
    })
    const res = await GET(
      req('project-a', 'path=notes.md&side=untracked', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      filename: 'notes.md',
      status: 'untracked',
      oldContent: null,
      newContent: 'fresh\n',
    })
  })

  it('staged-add: HEAD has no blob → oldContent="", status=added', async () => {
    vi.mocked(readGitFileContents)
      .mockResolvedValueOnce({ ok: false, reason: 'not-found' })
      .mockResolvedValueOnce({ ok: true, content: 'newly-tracked\n' })
    const res = await GET(
      req('project-a', 'path=new.ts&side=staged', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 'added',
      oldContent: '',
      newContent: 'newly-tracked\n',
    })
  })

  it('unstaged-delete: working missing → newContent="", status=deleted', async () => {
    vi.mocked(readGitFileContents)
      .mockResolvedValueOnce({ ok: true, content: 'was-here\n' })
      .mockResolvedValueOnce({ ok: false, reason: 'not-found' })
    const res = await GET(
      req('project-a', 'path=gone.ts&side=unstaged', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 'deleted',
      oldContent: 'was-here\n',
      newContent: '',
    })
  })

  it('forwards too-large from either side as 200 skipReason', async () => {
    vi.mocked(readGitFileContents)
      .mockResolvedValueOnce({ ok: true, content: 'old\n' })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'too-large',
        sizeBytes: 2_000_000,
        maxBytes: 1_048_576,
      })
    const res = await GET(
      req('project-a', 'path=big.txt&side=unstaged', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: false,
      skipReason: 'too-large',
      sizeBytes: 2_000_000,
      maxBytes: 1_048_576,
      side: 'new',
    })
  })

  it('forwards binary as 200 skipReason', async () => {
    vi.mocked(readGitFileContents)
      .mockResolvedValueOnce({ ok: true, content: 'old\n' })
      .mockResolvedValueOnce({ ok: false, reason: 'binary' })
    const res = await GET(
      req('project-a', 'path=blob.bin&side=unstaged', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, skipReason: 'binary' })
  })

  it('400 missing path', async () => {
    const res = await GET(
      req('project-a', 'side=unstaged', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
  })

  it('400 path escape', async () => {
    const res = await GET(
      req('project-a', 'path=../../etc/passwd&side=unstaged', {
        'x-memon-role': 'owner',
      }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
    expect(readGitFileContents).not.toHaveBeenCalled()
  })

  it('400 invalid side', async () => {
    const res = await GET(
      req('project-a', 'path=app.ts&side=cached', { 'x-memon-role': 'owner' }),
      paramsFor('project-a'),
    )
    expect(res.status).toBe(400)
  })

  it('404 unknown project', async () => {
    const res = await GET(
      req('nope', 'path=app.ts&side=unstaged', { 'x-memon-role': 'owner' }),
      paramsFor('nope'),
    )
    expect(res.status).toBe(404)
  })

  it('403 viewer out of scope', async () => {
    const res = await GET(
      req('project-b', 'path=app.ts&side=unstaged', {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'project-a',
      }),
      paramsFor('project-b'),
    )
    expect(res.status).toBe(403)
  })

  describe('side=commit', () => {
    it('200 ok=true for an existing file at a commit', async () => {
      vi.mocked(readGitFileContents)
        .mockResolvedValueOnce({ ok: true, content: 'parent\n' })
        .mockResolvedValueOnce({ ok: true, content: 'commit\n' })
      const res = await GET(
        req('project-a', 'path=app.ts&side=commit&sha=abc1234', {
          'x-memon-role': 'owner',
        }),
        paramsFor('project-a'),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        filename: 'app.ts',
        status: 'modified',
        oldContent: 'parent\n',
        newContent: 'commit\n',
      })
      expect(readGitFileContents).toHaveBeenNthCalledWith(1, '/tmp/a', 'abc1234^', 'app.ts')
      expect(readGitFileContents).toHaveBeenNthCalledWith(2, '/tmp/a', 'abc1234', 'app.ts')
    })

    it('root commit: parent not-found → oldContent="" status=added', async () => {
      vi.mocked(readGitFileContents)
        .mockResolvedValueOnce({ ok: false, reason: 'not-found' })
        .mockResolvedValueOnce({ ok: true, content: 'first\n' })
      const res = await GET(
        req('project-a', 'path=app.ts&side=commit&sha=xyz0000', {
          'x-memon-role': 'owner',
        }),
        paramsFor('project-a'),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({
        ok: true,
        status: 'added',
        oldContent: '',
        newContent: 'first\n',
      })
    })

    it('400 missing sha', async () => {
      const res = await GET(
        req('project-a', 'path=app.ts&side=commit', { 'x-memon-role': 'owner' }),
        paramsFor('project-a'),
      )
      expect(res.status).toBe(400)
      expect(readGitFileContents).not.toHaveBeenCalled()
    })

    it('400 invalid sha (shell metachar)', async () => {
      const res = await GET(
        req('project-a', 'path=app.ts&side=commit&sha=foo%3Brm', {
          'x-memon-role': 'owner',
        }),
        paramsFor('project-a'),
      )
      expect(res.status).toBe(400)
      expect(readGitFileContents).not.toHaveBeenCalled()
    })

    it('forwards too-large from a commit side', async () => {
      vi.mocked(readGitFileContents)
        .mockResolvedValueOnce({ ok: true, content: 'parent\n' })
        .mockResolvedValueOnce({
          ok: false,
          reason: 'too-large',
          sizeBytes: 2_000_000,
          maxBytes: 1_048_576,
        })
      const res = await GET(
        req('project-a', 'path=big.txt&side=commit&sha=abc1234', {
          'x-memon-role': 'owner',
        }),
        paramsFor('project-a'),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: false,
        skipReason: 'too-large',
        sizeBytes: 2_000_000,
        maxBytes: 1_048_576,
        side: 'new',
      })
    })
  })
})
