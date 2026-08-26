// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../lib/server/standalone-services', () => ({ standaloneServices: vi.fn() }))
vi.mock('@memon/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@memon/core')>()),
  BackendHypothesesResponseSchema: { parse: (value: unknown) => value },
}))

import { getRuntime } from '../../../lib/runtime'
import { standaloneServices } from '../../../lib/server/standalone-services'
import { GET } from './route'

const getHypotheses = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRuntime).mockResolvedValue({
    config: { projects: [{ name: 'project-a', root: '/p/a' }] },
  } as never)
  vi.mocked(standaloneServices).mockReturnValue({ projects: { getHypotheses } } as never)
  getHypotheses.mockResolvedValue({
    project: 'project-a',
    entries: [],
    parseErrors: [],
    parseWarnings: [],
    legendBlock: null,
    summaryTableBlock: null,
  })
})

describe('GET /api/hypotheses shared adapter', () => {
  it('returns legacy path around the shared DTO', async () => {
    const response = await GET(new NextRequest('http://x/api/hypotheses?project=project-a'))
    expect(response.status).toBe(200)
    expect((await response.json()).path).toBe('/p/a/docs/hypotheses.md')
    expect(getHypotheses).toHaveBeenCalledWith('project-a')
  })

  it('rejects unknown and missing Projects', async () => {
    expect((await GET(new NextRequest('http://x/api/hypotheses'))).status).toBe(404)
    expect((await GET(new NextRequest('http://x/api/hypotheses?project=ghost'))).status).toBe(404)
  })
})
