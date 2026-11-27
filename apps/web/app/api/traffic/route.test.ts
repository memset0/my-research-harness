// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeAccountHeader } from '@/lib/server/auth/request-context'

vi.mock('@/lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime, type Runtime } from '@/lib/server/runtime'
import { trafficTracker } from '@/lib/server/traffic/tracker'
import { GET as payload } from './payload/route'
import { POST as probe } from './probe/route'
import { GET as snapshot } from './route'

function request(
  path: string,
  options: { level?: 'super_admin' | 'admin' | null; method?: string; body?: unknown } = {},
): NextRequest {
  const level = options.level === undefined ? 'super_admin' : options.level
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'x-memon-role': level ? 'owner' : 'viewer',
      ...(level
        ? {
            'x-memon-account': encodeAccountHeader({
              id: level === 'super_admin' ? 1 : 2,
              username: 'u',
              level,
            }),
          }
        : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

beforeEach(() => {
  vi.mocked(getRuntime).mockResolvedValue({
    config: {
      projects: [{ name: 'project-a', host: 'h1', root: '/srv/a', include: [], exclude: [] }],
    },
  } as unknown as Runtime)
})

describe('/api/traffic', () => {
  it('refuses admins and viewers on every route', async () => {
    for (const level of ['admin', null] as const) {
      expect((await snapshot(request('/api/traffic', { level }))).status).toBe(403)
      expect((await payload(request('/api/traffic/payload?bytes=1', { level }))).status).toBe(403)
      const probed = await probe(
        request('/api/traffic/probe', {
          level,
          method: 'POST',
          body: { host: 'h1', project: 'project-a' },
        }),
      )
      expect(probed.status).toBe(403)
    }
  })

  it('returns the snapshot for a valid window only', async () => {
    trafficTracker().record({
      host: 'h1',
      project: 'project-a',
      transport: 'native',
      kind: 'service',
      document: 'report/R0001',
      method: 'GET',
      path: '/route-test?secret=1',
      status: 200,
      bytes: 10,
      resolveMs: 1,
      ttfbMs: 2,
      upstreamTtfbMs: 1,
      totalMs: 3,
      reused: false,
      outcome: 'ok',
    })
    expect((await snapshot(request('/api/traffic?windowMs=7'))).status).toBe(400)
    const response = await snapshot(request('/api/traffic?windowMs=300000'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.windowMs).toBe(300000)
    expect(body.recent.some((r: { path: string }) => r.path === '/route-test?…')).toBe(true)
    expect(JSON.stringify(body)).not.toContain('secret=1')
    expect(body.projects).toEqual([
      { host: 'h1', project: 'project-a', transport: 'native', probe: 'native' },
    ])
    expect(body.generatedAt).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('serves exactly the requested bounded payload', async () => {
    const response = await payload(request('/api/traffic/payload?bytes=100000'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.arrayBuffer()).byteLength).toBe(100000)
    expect((await payload(request('/api/traffic/payload?bytes=99999999'))).status).toBe(400)
    expect((await payload(request('/api/traffic/payload?bytes=-1'))).status).toBe(400)
  })

  it('validates probe bodies and unknown projects', async () => {
    const bad = await probe(
      request('/api/traffic/probe', {
        method: 'POST',
        body: {
          host: 'h1',
          project: 'project-a',
          path: '/../etc',
          document: { kind: 'wiki', id: 'W0001' },
        },
      }),
    )
    expect(bad.status).toBe(400)
    const missing = await probe(
      request('/api/traffic/probe', { method: 'POST', body: { host: 'h1', project: 'nope' } }),
    )
    expect(missing.status).toBe(404)
    const native = await probe(
      request('/api/traffic/probe', { method: 'POST', body: { host: 'h1', project: 'project-a' } }),
    )
    expect(native.status).toBe(200)
    expect((await native.json()).transport).toBe('native')
  })
})
