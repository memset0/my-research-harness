// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuthConfig } from '@memon/core'
import { NextRequest } from 'next/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSharesCookie } from './lib/server/auth/cookies'
import { __limits, __resetForTests } from './lib/server/auth/rate-limit'
import { shareRegistryFor } from './lib/server/share-registry'

vi.mock('./lib/server/runtime', () => ({ getRuntime: vi.fn() }))

import { getRuntime } from './lib/server/runtime'
import { middleware } from './middleware'

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
}

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'GET', headers })
}

function jsonApiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { accept: 'application/json', ...extra }
}

let auth: AuthConfig & { sessionSecret?: string }
beforeAll(() => {
  auth = { username: 'admin', password: 'correct', sessionSecret: 'test-session-secret' }
})

beforeEach(() => {
  __resetForTests()
  // Minimal Runtime mock — enough to satisfy makeProjectResolver +
  // share-cookie validator paths (neither matters for Basic-auth tests).
  vi.mocked(getRuntime).mockResolvedValue({
    auth,
    config: { projects: [] },
    index: { get: () => undefined },
    experiments: new Map(),
    reportsCache: { getList: () => [] },
    projectFor: () => null,
    reportsDir: () => null,
    digestsDir: () => null,
  } as unknown as Awaited<ReturnType<typeof getRuntime>>)
})

afterEach(() => {
  __resetForTests()
})

describe('middleware', () => {
  it('passes through with valid Basic auth (NextResponse.next)', async () => {
    const res = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('admin', 'correct'),
        'x-forwarded-for': '203.0.113.1',
      }),
    )
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns 401 without a browser Basic challenge on anonymous API request', async () => {
    const res = await middleware(
      req('http://localhost/api/projects', jsonApiHeaders({ 'x-forwarded-for': '203.0.113.2' })),
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBeNull()
  })

  it('redirects old page URLs to their canonical page in one uncached 308', async () => {
    const cases: Array<[string, string]> = [
      [
        '/h/host-a/p/project-a/e/E0017-kernels?run=sample&report=R0007&reportSurface=split',
        '/host-a/project-a/e/17?run=sample',
      ],
      ['/h/host-a/p/project-a?wiki=W0004&wikiSurface=drawer', '/host-a/project-a'],
      ['/h/host-a/p/project-a/reports/R0010?expanded=1', '/host-a/project-a/r/10?expanded=1'],
      ['/h/host-a/p/project-a/wiki/W0004?share=tok', '/host-a/project-a/w/4?share=tok'],
      [
        '/h/host-a/p/project-a/code-review/experiments/E0005-bf16/code-review/2026-05-22-guard',
        '/host-a/project-a/e/5/cr/2026-05-22-guard',
      ],
      ['/host-a/project-a/r/0010?expanded=1', '/host-a/project-a/r/10?expanded=1'],
      ['/host-a/project-a/e/E0010-kernels', '/host-a/project-a/e/10'],
      ['/host-a/project-a/w/4?wikiSurface=split', '/host-a/project-a/w/4'],
    ]
    for (const [from, to] of cases) {
      // Anonymous: the redirect happens before authentication.
      const res = await middleware(
        req(`http://localhost${from}`, { accept: 'text/html', 'x-forwarded-for': '203.0.113.9' }),
      )
      expect(res.status, from).toBe(308)
      expect(res.headers.get('location'), from).toBe(`http://localhost${to}`)
      expect(res.headers.get('cache-control'), from).toBe('no-store')
    }
    // API routes keep their own `report`/`wiki` query parameters.
    const api = await middleware(
      req('http://localhost/api/reports?project=project-a&report=R0007', {
        authorization: basic('admin', 'correct'),
      }),
    )
    expect(api.status).not.toBe(308)
  })

  it('answers 404 for hostless and unmapped legacy page URLs before authentication', async () => {
    for (const path of [
      '/p/project-a',
      '/p/project-a/reports/R0010',
      '/p/project-a/r/run-1',
      '/h/host-a/p/project-a/unknown',
      '/h/host-a',
    ]) {
      const res = await middleware(
        req(`http://localhost${path}`, { accept: 'text/html', 'x-forwarded-for': '203.0.113.10' }),
      )
      expect(res.status, path).toBe(404)
    }
  })

  it('returns 302 to /login on anonymous HTML page request', async () => {
    const res = await middleware(
      req('http://localhost/host-a/project-a', {
        accept: 'text/html',
        'x-forwarded-for': '203.0.113.2',
      }),
    )
    expect(res.status).toBe(302)
    const location = res.headers.get('location') ?? ''
    expect(location).toContain('/login')
    expect(location).toContain('next=%2Fhost-a%2Fproject-a')
  })

  it('returns 401 on wrong password (API)', async () => {
    const res = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('admin', 'WRONG'),
        'x-forwarded-for': '203.0.113.3',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong username (API)', async () => {
    const res = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('eve', 'correct'),
        'x-forwarded-for': '203.0.113.4',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns an explicit 403 when a valid share viewer invokes a viewer-visible write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'memon-middleware-'))
    vi.mocked(getRuntime).mockResolvedValue({
      configPath: join(directory, 'config.yml'),
      auth,
      config: { central: { hosts: [] }, projects: [] },
      index: { get: () => undefined },
      experiments: new Map(),
      reportsCache: { getList: () => [] },
      projectFor: () => null,
      reportsDir: () => null,
      digestsDir: () => null,
    } as unknown as Awaited<ReturnType<typeof getRuntime>>)
    const record = await shareRegistryFor(join(directory, 'config.yml')).create({
      host: 'host-a',
      project: 'project-a',
      scope: { kind: 'project' },
    })
    const viewerCookie = signSharesCookie(
      [{ host: 'host-a', project: 'project-a', token: record.token }],
      auth.sessionSecret!,
    )
    const query = 'host=host-a&project=project-a&experiment=E0001-demo'
    const requests = [
      ['POST', `http://localhost/api/experiment-results-views?${query}`],
      ['PATCH', `http://localhost/api/experiment-results-views/view-a?${query}`],
      ['DELETE', `http://localhost/api/experiment-results-views/view-a?${query}`],
    ] as const

    for (const [method, url] of requests) {
      const response = await middleware(
        new NextRequest(url, {
          method,
          headers: {
            accept: 'application/json',
            cookie: `memon-shares=${viewerCookie}`,
            'x-forwarded-for': '203.0.113.29',
          },
        }),
      )
      expect(response.status).toBe(403)
    }
    await rm(directory, { recursive: true, force: true })
  })

  it('bypasses auth for /api/auth/check (own validation)', async () => {
    const res = await middleware(req('http://localhost/api/auth/check'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('passes /login (anon class) without identity', async () => {
    const res = await middleware(
      req('http://localhost/login', { 'x-forwarded-for': '203.0.113.99' }),
    )
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('passes /share/<project>/<token> (anon class) without identity', async () => {
    const res = await middleware(
      req('http://localhost/share/project-a/abc123', { 'x-forwarded-for': '203.0.113.98' }),
    )
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns 429 once the bucket is exhausted', { timeout: 30_000 }, async () => {
    const ip = '203.0.113.123'
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      const r = await middleware(
        req('http://localhost/api/projects', {
          authorization: basic('admin', 'WRONG'),
          'x-forwarded-for': ip,
        }),
      )
      expect(r.status).toBe(401)
    }
    const r = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('admin', 'correct'),
        'x-forwarded-for': ip,
      }),
    )
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('successful authentications do not drain the bucket (refund-on-success)', {
    timeout: 30_000,
  }, async () => {
    const ip = '203.0.113.50'
    for (let i = 0; i < __limits.CAPACITY * 2; i += 1) {
      const r = await middleware(
        req('http://localhost/api/projects', {
          authorization: basic('admin', 'correct'),
          'x-forwarded-for': ip,
        }),
      )
      expect(r.headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('mixed wrong-then-right credentials: wrongs drain, rights net-zero', {
    timeout: 30_000,
  }, async () => {
    const ip = '203.0.113.51'
    for (let i = 0; i < 30; i += 1) {
      const r = await middleware(
        req('http://localhost/api/projects', {
          authorization: basic('admin', 'WRONG'),
          'x-forwarded-for': ip,
        }),
      )
      expect(r.status).toBe(401)
    }
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      const r = await middleware(
        req('http://localhost/api/projects', {
          authorization: basic('admin', 'correct'),
          'x-forwarded-for': ip,
        }),
      )
      expect(r.headers.get('x-middleware-next')).toBe('1')
    }
  })

  it('shares the rate-limit bucket with /api/auth/check (same key, in-process)', {
    timeout: 30_000,
  }, async () => {
    const { GET } = await import('./app/api/auth/check/route')
    const ip = '203.0.113.222'
    const half = Math.floor(__limits.CAPACITY / 2)
    for (let i = 0; i < half; i += 1) {
      await middleware(
        req('http://localhost/api/projects', {
          authorization: basic('admin', 'WRONG'),
          'x-forwarded-for': ip,
        }),
      )
    }
    for (let i = 0; i < __limits.CAPACITY - half; i += 1) {
      const r = await GET(
        req('http://localhost/api/auth/check', {
          authorization: basic('admin', 'WRONG'),
          'x-forwarded-for': ip,
        }),
      )
      expect(r.status).toBe(401)
    }
    const next = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('admin', 'correct'),
        'x-forwarded-for': ip,
      }),
    )
    expect(next.status).toBe(429)
  })
})
