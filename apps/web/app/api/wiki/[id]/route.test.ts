// @vitest-environment node

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../../../lib/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from '../../../../lib/runtime'
import { GET, PUT } from './route'

const content = [
  '---',
  'id: W0001',
  'kind: finding',
  'title: Finding',
  'created_at: 2026-05-01T10:00:00+08:00',
  'updated_at: 2026-05-01T10:00:00+08:00',
  '---',
  '```yaml datatable@1 #metrics',
  'columns: [step, loss]',
  'data: [[1]]',
  '```',
].join('\n')

const summary = {
  id: 'W0001',
  slug: 'finding',
  kind: 'finding',
  title: 'Finding',
  description: null,
  status: 'TENTATIVE',
  date: null,
  language: 'en',
  tags: [],
  sources: ['E0001'],
  legacyId: null,
  entry: null,
  deprecated: null,
  deprecatedSections: [],
  stale: false,
  staleSources: [],
  review: null,
  format: 'markdown',
  path: 'docs/wiki/finding/W0001-finding.md',
  mtime: 1,
  createdAt: '2026-05-01T10:00:00+08:00',
  updatedAt: '2026-05-01T10:00:00+08:00',
  diagnostics: [],
}

const wikiCache = {
  getWikiPage: vi.fn(),
  getWikiSummary: vi.fn(),
  putWikiPage: vi.fn(),
}

let root: string

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-wiki-route-'))
  vi.clearAllMocks()
  wikiCache.getWikiPage.mockResolvedValue({
    summary,
    content,
    mtime: 1,
    hash: 'a'.repeat(40),
  })
  wikiCache.getWikiSummary.mockReturnValue(summary)
  wikiCache.putWikiPage.mockResolvedValue({ ok: true, mtime: 2, hash: 'b'.repeat(40) })
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: 'project-a', root }] },
    wikiCache,
  } as never)
})

function request(method: 'GET' | 'PUT', id = 'W0001', body?: unknown) {
  return new NextRequest(`http://localhost/api/wiki/${id}?project=project-a`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

describe('GET /api/wiki/[id]', () => {
  it('serves the central component projection in full-file line coordinates', async () => {
    const response = await GET(request('GET'), { params: Promise.resolve({ id: 'W0001' }) })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.components).toEqual([
      {
        index: 0,
        type: 'datatable',
        version: 1,
        pinnedVersion: 1,
        latestVersion: 1,
        outdated: false,
        id: 'metrics',
        executable: false,
        line: 8,
      },
    ])
    expect(payload.diagnostics).toEqual([
      expect.objectContaining({ code: 'WIKI_COMPONENT_INVALID', line: 8 }),
    ])
  })

  it('omits unresolved component versions but preserves their diagnostics', async () => {
    wikiCache.getWikiPage.mockResolvedValueOnce({
      summary,
      content: content.replace('datatable@1', 'datatable@999'),
      mtime: 1,
      hash: 'a'.repeat(40),
    })
    const response = await GET(request('GET'), { params: Promise.resolve({ id: 'W0001' }) })
    const payload = await response.json()
    expect(payload.components).toEqual([])
    expect(payload.diagnostics).toEqual([
      expect.objectContaining({ code: 'WIKI_COMPONENT_INVALID', line: 8 }),
    ])
  })

  it('rejects malformed and unknown ids', async () => {
    expect(
      (await GET(request('GET', 'R0001'), { params: Promise.resolve({ id: 'R0001' }) })).status,
    ).toBe(400)
    wikiCache.getWikiPage.mockResolvedValueOnce(null)
    expect(
      (await GET(request('GET', 'W9999'), { params: Promise.resolve({ id: 'W9999' }) })).status,
    ).toBe(404)
  })
})

describe('PUT /api/wiki/[id]', () => {
  it('rejects identity changes before writing', async () => {
    const changed = content.replace('id: W0001', 'id: W0002')
    const response = await PUT(
      request('PUT', 'W0001', {
        content: changed,
        expectedMtime: 1,
        expectedHash: 'a'.repeat(40),
      }),
      { params: Promise.resolve({ id: 'W0001' }) },
    )
    expect(response.status).toBe(400)
    expect(wikiCache.putWikiPage).not.toHaveBeenCalled()
  })

  it('returns conflict state and a successful re-baselined page', async () => {
    wikiCache.putWikiPage.mockResolvedValueOnce({
      ok: false,
      code: 'CONFLICT',
      currentMtime: 2,
      currentHash: 'c'.repeat(40),
      currentContent: 'changed',
    })
    const payload = { content, expectedMtime: 1, expectedHash: 'a'.repeat(40) }
    const conflict = await PUT(request('PUT', 'W0001', payload), {
      params: Promise.resolve({ id: 'W0001' }),
    })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: { code: 'CONFLICT' },
      currentContent: 'changed',
    })

    const success = await PUT(request('PUT', 'W0001', payload), {
      params: Promise.resolve({ id: 'W0001' }),
    })
    expect(success.status).toBe(200)
    expect(await success.json()).toMatchObject({
      ok: true,
      hash: 'b'.repeat(40),
      finalContent: content,
      page: { id: 'W0001' },
    })
  })
})
