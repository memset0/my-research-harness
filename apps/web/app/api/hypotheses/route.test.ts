// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../lib/runtime', () => ({
  getRuntime: vi.fn(),
}))

import { GET } from './route'
import { getRuntime } from '../../../lib/runtime'

function fakeRuntime(overrides: Partial<{ hypothesesPath: (n: string) => string | null; cacheValue: unknown }> = {}) {
  return {
    hypothesesPath:
      overrides.hypothesesPath ??
      ((n: string) => (n === 'project-a' ? '/p/a/docs/hypotheses.md' : null)),
    hypothesesCache: {
      get: () => ({
        value: overrides.cacheValue ?? {
          legendBlock: null,
          summaryTableBlock: null,
          entries: [
            {
              id: 'H0001',
              slug: 'sparse-deltas',
              statement: 'param delta is sparse',
              status: 'CONFIRMED',
              origin: null,
              experiments: ['foo-260501-100000'],
              evidence: [],
              caveats: [],
              lastVerified: null,
            },
          ],
          parseErrors: [],
          parseWarnings: [],
        },
      }),
    },
  }
}

describe('GET /api/hypotheses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400 when project query param is missing', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime() as never)
    const res = await GET(new NextRequest('http://localhost/api/hypotheses'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('404 when project not in config', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime() as never)
    const res = await GET(
      new NextRequest('http://localhost/api/hypotheses?project=ghost'),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('200 with parsed hypotheses for known project', async () => {
    vi.mocked(getRuntime).mockResolvedValue(fakeRuntime() as never)
    const res = await GET(
      new NextRequest('http://localhost/api/hypotheses?project=project-a'),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.path).toBe('/p/a/docs/hypotheses.md')
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({ id: 'H0001', status: 'CONFIRMED' })
  })
})
