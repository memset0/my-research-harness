// @vitest-environment node
import { NodeAccessError } from '@memon/core'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/cluster/overview', () => ({ getClusterOverview: vi.fn() }))

import { getClusterOverview } from '@/lib/server/cluster/overview'
import { GET } from './route'

const request = (role: 'owner' | 'viewer' | 'anon', query = '') =>
  new NextRequest(`http://localhost/api/clusters${query}`, { headers: { 'x-memon-role': role } })

describe('GET /api/clusters', () => {
  it('returns the overview to the owner and forwards refresh', async () => {
    vi.mocked(getClusterOverview).mockResolvedValue({
      now: '2026-11-25T00:00:00+00:00',
      clusters: [],
      tasks: { available: false, items: [] },
    })
    const response = await GET(request('owner', '?refresh=1'))
    expect(response.status).toBe(200)
    expect(getClusterOverview).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ role: 'owner' }),
    )
  })

  it('refuses viewers and anonymous requests without probing', async () => {
    vi.mocked(getClusterOverview).mockClear()
    for (const role of ['viewer', 'anon'] as const) {
      const response = await GET(request(role))
      expect(response.status).toBe(403)
    }
    expect(getClusterOverview).not.toHaveBeenCalled()
  })

  it('reports an invalid registry as NODES_CONFIG_INVALID', async () => {
    vi.mocked(getClusterOverview).mockRejectedValue(
      new NodeAccessError('NODES_CONFIG_INVALID', 'schema_version must be 1'),
    )
    const response = await GET(request('owner'))
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe('NODES_CONFIG_INVALID')
  })
})
