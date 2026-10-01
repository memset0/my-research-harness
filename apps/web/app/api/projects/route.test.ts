// @vitest-environment node

import { ProjectRefSchema } from '@memon/core'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeHostScopeHeader, HOST_SCOPE_HEADER } from '../../../lib/server/auth/request-context'

vi.mock('../../../lib/server/runtime', () => ({ getRuntime: vi.fn() }))
vi.mock('../../../lib/server/central/fleet-runtime', () => ({ getCentralFleet: vi.fn() }))
vi.mock('../../../lib/server/central/central-projects', () => ({
  aggregateCentralProjects: vi.fn(),
}))

import { aggregateCentralProjects } from '../../../lib/server/central/central-projects'
import { getCentralFleet } from '../../../lib/server/central/fleet-runtime'
import { getRuntime } from '../../../lib/server/runtime'
import { GET } from './route'

function request(
  role: 'owner' | 'viewer' | 'anon',
  scope = '',
  hostScopes: Array<{ host: string; project: string }> = [],
): NextRequest {
  return new NextRequest('http://central.internal/api/projects', {
    headers: {
      'x-memon-role': role,
      ...(scope ? { 'x-memon-scope': scope } : {}),
      ...(hostScopes.length
        ? {
            [HOST_SCOPE_HEADER]: encodeHostScopeHeader(
              hostScopes.map((entry) => ProjectRefSchema.parse(entry)),
            ),
          }
        : {}),
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/projects role composition', () => {
  it('returns Host-qualified safe aggregation for a central owner', async () => {
    const registry = { marker: 'registry' }
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [{ id: 'host-a' }] }, projects: [] },
    } as never)
    vi.mocked(getCentralFleet).mockResolvedValue({ registry } as never)
    vi.mocked(aggregateCentralProjects).mockResolvedValue({
      projects: [
        { host: 'host-a', project: 'shared-project', label: 'A' },
        { host: 'host-b', project: 'shared-project', label: 'B' },
      ],
    } as never)

    const response = await GET(request('owner'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      projects: [
        {
          mode: 'central',
          host: 'host-a',
          project: 'shared-project',
          name: 'shared-project',
          label: 'A',
        },
        {
          mode: 'central',
          host: 'host-b',
          project: 'shared-project',
          name: 'shared-project',
          label: 'B',
        },
      ],
    })
    expect(text).not.toContain('root')
    expect(text).not.toContain('path')
    expect(aggregateCentralProjects).toHaveBeenCalledWith({
      registry,
      actor: { role: 'owner' },
    })
  })

  it('fails a central viewer closed instead of expanding a name-only scope', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [] }, projects: [] },
    } as never)

    const response = await GET(request('viewer', 'shared-project'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Host-qualified viewer scope is required' },
    })
    expect(getCentralFleet).not.toHaveBeenCalled()
    expect(aggregateCentralProjects).not.toHaveBeenCalled()
  })

  it('aggregates a central viewer with exact Host-qualified scopes', async () => {
    const registry = { marker: 'registry' }
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [{ id: 'host-a' }] }, projects: [] },
    } as never)
    vi.mocked(getCentralFleet).mockResolvedValue({ registry } as never)
    vi.mocked(aggregateCentralProjects).mockResolvedValue({
      projects: [{ host: 'host-a', project: 'shared-project' }],
    } as never)

    const scope = { host: 'host-a', project: 'shared-project' }
    const response = await GET(request('viewer', '', [scope]))
    expect(response.status).toBe(200)
    expect(aggregateCentralProjects).toHaveBeenCalledWith({
      registry,
      actor: { role: 'viewer', scopes: [ProjectRefSchema.parse(scope)] },
    })
  })

  it('preserves standalone owner and viewer response behavior', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: {
        projects: [
          { name: 'project-a', root: '/srv/project-a', exclude: ['tmp'] },
          { name: 'project-b', root: '/srv/project-b', exclude: [] },
        ],
      },
    } as never)

    const owner = await GET(request('owner'))
    expect(await owner.json()).toEqual({
      projects: [
        {
          mode: 'standalone',
          host: null,
          project: 'project-a',
          name: 'project-a',
          root: '/srv/project-a',
          exclude: ['tmp'],
        },
        {
          mode: 'standalone',
          host: null,
          project: 'project-b',
          name: 'project-b',
          root: '/srv/project-b',
          exclude: [],
        },
      ],
    })

    const viewer = await GET(request('viewer', 'project-b'))
    expect(await viewer.json()).toEqual({
      projects: [
        {
          mode: 'standalone',
          host: null,
          project: 'project-b',
          name: 'project-b',
          root: '/srv/project-b',
          exclude: [],
        },
      ],
    })
    expect(getCentralFleet).not.toHaveBeenCalled()
    expect(aggregateCentralProjects).not.toHaveBeenCalled()
  })

  it('redacts central aggregation failures', async () => {
    vi.mocked(getRuntime).mockResolvedValue({
      config: { central: { hosts: [{ id: 'host-a' }] }, projects: [] },
    } as never)
    vi.mocked(getCentralFleet).mockRejectedValue(
      new Error('private tunnel /srv/private token=secret'),
    )

    const response = await GET(request('owner'))
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).toContain('Central Project discovery failed')
    expect(text).not.toContain('/srv/private')
    expect(text).not.toContain('secret')
  })
})
