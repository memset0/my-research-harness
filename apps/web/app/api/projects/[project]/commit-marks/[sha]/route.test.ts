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
    setCommitMark: vi.fn(),
    deleteCommitMark: vi.fn(),
  }
})

import { deleteCommitMark, setCommitMark } from '@memon/core'
import { getRuntime } from '../../../../../../lib/server/runtime'
import { DELETE, PUT } from './route'

const MARK = {
  sha: 'abc1234',
  status: 'verified' as const,
  note: 'ok',
  updatedAt: '2026-05-15T12:00:00+08:00',
  submodule: '',
}

function paramsFor(name: string, sha: string) {
  return { params: Promise.resolve({ project: name, sha }) }
}

function req(
  name: string,
  sha: string,
  method: 'PUT' | 'DELETE',
  headers: Record<string, string> = {},
  body?: unknown,
): NextRequest {
  return new NextRequest(`http://localhost/api/projects/${name}/commit-marks/${sha}`, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? null : JSON.stringify(body),
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
  vi.mocked(setCommitMark).mockResolvedValue(MARK)
  vi.mocked(deleteCommitMark).mockResolvedValue({ deleted: true })
})

describe('PUT /api/projects/[project]/commit-marks/[sha]', () => {
  it('200 for owner with valid body', async () => {
    const res = await PUT(
      req(
        'project-a',
        'abc1234',
        'PUT',
        { 'x-memon-role': 'owner' },
        {
          status: 'verified',
          note: 'ok',
        },
      ),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mark: MARK })
    expect(setCommitMark).toHaveBeenCalledWith('/tmp/a', 'abc1234', {
      status: 'verified',
      note: 'ok',
    })
  })

  it('200 for owner with missing optional note (passed as undefined)', async () => {
    const res = await PUT(
      req(
        'project-a',
        'abc1234',
        'PUT',
        { 'x-memon-role': 'owner' },
        {
          status: 'suspicious',
        },
      ),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(200)
    expect(setCommitMark).toHaveBeenCalledWith('/tmp/a', 'abc1234', {
      status: 'suspicious',
      note: undefined,
    })
  })

  it('403 viewer-in-scope cannot mutate', async () => {
    const res = await PUT(
      req(
        'project-a',
        'abc1234',
        'PUT',
        {
          'x-memon-role': 'viewer',
          'x-memon-scope': 'project-a',
        },
        { status: 'verified' },
      ),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(403)
    expect(setCommitMark).not.toHaveBeenCalled()
  })

  it('403 viewer-out-of-scope', async () => {
    const res = await PUT(
      req(
        'project-b',
        'abc1234',
        'PUT',
        {
          'x-memon-role': 'viewer',
          'x-memon-scope': 'project-a',
        },
        { status: 'verified' },
      ),
      paramsFor('project-b', 'abc1234'),
    )
    expect(res.status).toBe(403)
  })

  it('400 invalid status', async () => {
    const res = await PUT(
      req(
        'project-a',
        'abc1234',
        'PUT',
        { 'x-memon-role': 'owner' },
        {
          status: 'green',
        },
      ),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(400)
    expect(setCommitMark).not.toHaveBeenCalled()
  })

  it('400 invalid sha (shell metachar)', async () => {
    const res = await PUT(
      req(
        'project-a',
        'foo%3Brm',
        'PUT',
        { 'x-memon-role': 'owner' },
        {
          status: 'verified',
        },
      ),
      paramsFor('project-a', 'foo;rm'),
    )
    expect(res.status).toBe(400)
    expect(setCommitMark).not.toHaveBeenCalled()
  })

  it('400 non-string note', async () => {
    const res = await PUT(
      req(
        'project-a',
        'abc1234',
        'PUT',
        { 'x-memon-role': 'owner' },
        {
          status: 'verified',
          note: 42,
        },
      ),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(400)
  })

  it('404 unknown project', async () => {
    const res = await PUT(
      req(
        'nope',
        'abc1234',
        'PUT',
        { 'x-memon-role': 'owner' },
        {
          status: 'verified',
        },
      ),
      paramsFor('nope', 'abc1234'),
    )
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/projects/[project]/commit-marks/[sha]', () => {
  it('200 for owner', async () => {
    const res = await DELETE(
      req('project-a', 'abc1234', 'DELETE', { 'x-memon-role': 'owner' }),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
    expect(deleteCommitMark).toHaveBeenCalledWith('/tmp/a', 'abc1234', {
      submodule: undefined,
    })
  })

  it('403 viewer in scope', async () => {
    const res = await DELETE(
      req('project-a', 'abc1234', 'DELETE', {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'project-a',
      }),
      paramsFor('project-a', 'abc1234'),
    )
    expect(res.status).toBe(403)
    expect(deleteCommitMark).not.toHaveBeenCalled()
  })

  it('400 invalid sha', async () => {
    const res = await DELETE(
      req('project-a', 'foo%3Brm', 'DELETE', { 'x-memon-role': 'owner' }),
      paramsFor('project-a', 'foo;rm'),
    )
    expect(res.status).toBe(400)
  })
})
