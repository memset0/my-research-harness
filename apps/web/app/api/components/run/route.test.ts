// @vitest-environment node

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MemonCore from '@memon/core'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
// Real ComponentRunError so the handler's `instanceof` mapping is exercised.
vi.mock('@memon/core', async (importOriginal) => {
  const actual = await importOriginal<typeof MemonCore>()
  return { ...actual, runDocumentComponents: vi.fn() }
})

import { ComponentRunError, runDocumentComponents } from '@memon/core'
import { getRuntime } from '../../../../lib/runtime'
import { POST } from './route'

const OWNER = { 'content-type': 'application/json', 'x-memon-role': 'owner' }

/** `execution: null` configures a Project with no execution provider at all. */
function runtime(execution: unknown = { kind: 'local' }, overrides: Record<string, unknown> = {}) {
  return {
    config: {
      projects: [
        {
          name: 'project-a',
          root: '/projects/a',
          include: [],
          exclude: [],
          readOnly: true,
          ...(execution === null ? {} : { execution }),
          ...overrides,
        },
      ],
    },
  }
}

function post(body: unknown, headers: Record<string, string> = OWNER): NextRequest {
  return new NextRequest('http://localhost:3737/api/components/run', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/components/run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRuntime).mockResolvedValue(runtime() as never)
  })

  it('runs the document with the project interpreter and timeout, ignoring read_only', async () => {
    vi.mocked(getRuntime).mockResolvedValue(
      runtime({
        kind: 'local',
        python: '/opt/venv/bin/python',
        component_timeout_ms: 5000,
      }) as never,
    )
    const results = [
      {
        id: 'fid',
        status: 'updated',
        path: 'docs/wiki/note/W0004-x__assets/fid.json',
        durationMs: 12,
      },
    ]
    vi.mocked(runDocumentComponents).mockResolvedValue(results as never)

    const response = await POST(
      post({ project: 'project-a', document: 'docs/wiki/note/W0004-x.md', ids: ['fid'] }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(vi.mocked(runDocumentComponents)).toHaveBeenCalledWith({
      root: '/projects/a',
      documentPath: 'docs/wiki/note/W0004-x.md',
      pythonCommand: '/opt/venv/bin/python',
      timeoutMs: 5000,
      ids: ['fid'],
    })
  })

  it('omits the interpreter and timeout when the project does not configure them', async () => {
    vi.mocked(runDocumentComponents).mockResolvedValue([] as never)
    expect(
      (await POST(post({ project: 'project-a', document: 'docs/wiki/note/W0004-x.md' }))).status,
    ).toBe(200)
    expect(vi.mocked(runDocumentComponents)).toHaveBeenCalledWith({
      root: '/projects/a',
      documentPath: 'docs/wiki/note/W0004-x.md',
    })
  })

  it('refuses a viewer without running anything', async () => {
    const response = await POST(
      post(
        { project: 'project-a', document: 'docs/wiki/note/W0004-x.md' },
        {
          'content-type': 'application/json',
          'x-memon-role': 'viewer',
          'x-memon-scope': 'project-a',
        },
      ),
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe('FORBIDDEN')
    expect(vi.mocked(runDocumentComponents)).not.toHaveBeenCalled()
  })

  it('rejects a malformed body and a document that is not project-relative', async () => {
    expect((await POST(post('{'))).status).toBe(400)
    for (const body of [
      {},
      { project: 'project-a' },
      { project: 'project-a', document: 'a.md', extra: 1 },
      { project: 'project-a', document: 'a.md', ids: 'fid' },
    ]) {
      const response = await POST(post(body))
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect((await response.json()).error.code).toBe('BAD_REQUEST')
    }
    for (const document of ['/etc/passwd', '../../etc/passwd', 'docs\\wiki\\a.md']) {
      const response = await POST(post({ project: 'project-a', document }))
      expect(response.status, document).toBe(400)
      expect((await response.json()).error.message).toContain('project-relative')
    }
    expect(vi.mocked(runDocumentComponents)).not.toHaveBeenCalled()
  })

  it('409s when the project has no local execution provider', async () => {
    for (const execution of [null, { kind: 'ssh', target: 'node-a', remoteRoot: '/remote/a' }]) {
      vi.mocked(getRuntime).mockResolvedValue(runtime(execution) as never)
      const response = await POST(post({ project: 'project-a', document: 'a.md' }))
      expect(response.status).toBe(409)
      expect((await response.json()).error.code).toBe('EXECUTION_UNAVAILABLE')
    }
    expect(vi.mocked(runDocumentComponents)).not.toHaveBeenCalled()
  })

  it('409s a Host this instance does not serve and 400s an unknown project', async () => {
    vi.mocked(getRuntime).mockResolvedValue(runtime({ kind: 'local' }, { host: 'host-a' }) as never)
    const remote = await POST(post({ project: 'project-a', host: 'host-b', document: 'a.md' }))
    expect(remote.status).toBe(409)
    expect((await remote.json()).error).toMatchObject({
      code: 'EXECUTION_UNAVAILABLE',
      message: expect.stringContaining('host-b'),
    })

    const unknown = await POST(post({ project: 'project-z', document: 'a.md' }))
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error.code).toBe('BAD_REQUEST')
    expect(vi.mocked(runDocumentComponents)).not.toHaveBeenCalled()
  })

  it('maps a refused run onto its error code with 400', async () => {
    for (const code of [
      'UNKNOWN_ID',
      'NO_EXECUTABLE_BLOCKS',
      'DOCUMENT_NOT_FOUND',
      'INVALID_BLOCK',
    ] as const) {
      vi.mocked(runDocumentComponents).mockRejectedValueOnce(
        new ComponentRunError(code, `refused: ${code}`),
      )
      const response = await POST(post({ project: 'project-a', document: 'a.md' }))
      expect(response.status, code).toBe(400)
      expect(await response.json()).toEqual({
        error: { code, message: `refused: ${code}` },
      })
    }
  })
})
