// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AuthConfig } from '@memon/core'
import { __limits, __resetForTests } from './lib/auth/rate-limit'

vi.mock('./lib/runtime', () => ({ getRuntime: vi.fn() }))

import { middleware } from './middleware'
import { getRuntime } from './lib/runtime'

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
}

function req(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: 'GET', headers })
}

let auth: AuthConfig
beforeAll(() => {
  auth = { username: 'admin', password: 'correct' }
})

beforeEach(() => {
  __resetForTests()
  vi.mocked(getRuntime).mockResolvedValue({ auth } as Awaited<ReturnType<typeof getRuntime>>)
})

afterEach(() => {
  __resetForTests()
})

describe('middleware', () => {
  it('passes through with valid Basic auth (NextResponse.next)', async () => {
    const res = await middleware(
      req('http://localhost/p/project-a', {
        authorization: basic('admin', 'correct'),
        'x-forwarded-for': '203.0.113.1',
      }),
    )
    // NextResponse.next() returns a response with x-middleware-next: 1
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns 401 + WWW-Authenticate on anonymous page request', async () => {
    const res = await middleware(req('http://localhost/p/project-a', { 'x-forwarded-for': '203.0.113.2' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="memon"')
  })

  it('returns 401 on wrong password', async () => {
    const res = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('admin', 'WRONG'),
        'x-forwarded-for': '203.0.113.3',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 on wrong username', async () => {
    const res = await middleware(
      req('http://localhost/api/projects', {
        authorization: basic('eve', 'correct'),
        'x-forwarded-for': '203.0.113.4',
      }),
    )
    expect(res.status).toBe(401)
  })

  it('bypasses auth for /api/auth/check (forward_auth probe)', async () => {
    // The route handler does its own validation, not the middleware.
    const res = await middleware(req('http://localhost/api/auth/check'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns 429 once the bucket is exhausted', { timeout: 30_000 }, async () => {
    const ip = '203.0.113.123'
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      const r = await middleware(
        req('http://localhost/p/x', { authorization: basic('admin', 'WRONG'), 'x-forwarded-for': ip }),
      )
      expect(r.status).toBe(401)
    }
    const r = await middleware(
      req('http://localhost/p/x', { authorization: basic('admin', 'correct'), 'x-forwarded-for': ip }),
    )
    expect(r.status).toBe(429)
    expect(r.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('shares the rate-limit bucket with /api/auth/check (same key, in-process)', { timeout: 30_000 }, async () => {
    const { GET } = await import('./app/api/auth/check/route')
    const ip = '203.0.113.222'
    const half = Math.floor(__limits.CAPACITY / 2)
    // half via middleware…
    for (let i = 0; i < half; i += 1) {
      await middleware(
        req('http://localhost/p/x', { authorization: basic('admin', 'WRONG'), 'x-forwarded-for': ip }),
      )
    }
    // …then the rest via /api/auth/check should exhaust the same bucket.
    for (let i = 0; i < __limits.CAPACITY - half; i += 1) {
      const r = await GET(
        req('http://localhost/api/auth/check', {
          authorization: basic('admin', 'WRONG'),
          'x-forwarded-for': ip,
        }),
      )
      expect(r.status).toBe(401)
    }
    // The (CAPACITY+1)th attempt — through either path — should be 429.
    const next = await middleware(
      req('http://localhost/p/x', { authorization: basic('admin', 'correct'), 'x-forwarded-for': ip }),
    )
    expect(next.status).toBe(429)
  })
})
