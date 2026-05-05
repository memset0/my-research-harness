// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AuthConfig } from '@memon/core'
import { __limits, __resetForTests } from '../../../../lib/auth/rate-limit'

// Mock the runtime singleton — the real one walks the filesystem.
vi.mock('../../../../lib/runtime', () => {
  return {
    getRuntime: vi.fn(),
  }
})

import { GET } from './route'
import { getRuntime } from '../../../../lib/runtime'

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
}

function reqWith(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/auth/check', { method: 'GET', headers })
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

describe('GET /api/auth/check', () => {
  it('200 with { ok, username } on correct credentials', async () => {
    const res = await GET(reqWith({ authorization: basic('admin', 'correct'), 'x-forwarded-for': '203.0.113.1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, username: 'admin' })
  })

  it('401 with WWW-Authenticate: Basic realm="memon" on missing header', async () => {
    const res = await GET(reqWith({ 'x-forwarded-for': '203.0.113.2' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="memon"')
  })

  it('401 on wrong password', async () => {
    const res = await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': '203.0.113.3' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="memon"')
  })

  it('401 on wrong username', async () => {
    const res = await GET(reqWith({ authorization: basic('eve', 'correct'), 'x-forwarded-for': '203.0.113.4' }))
    expect(res.status).toBe(401)
  })

  it(
    '429 with Retry-After once the bucket for one IP is exhausted',
    { timeout: 30_000 },
    async () => {
      const ip = '203.0.113.99'
      // Burn full capacity with bad creds.
      for (let i = 0; i < __limits.CAPACITY; i += 1) {
        const res = await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': ip }))
        expect(res.status).toBe(401)
      }
      // (CAPACITY+1)th from the same IP → 429.
      const res = await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': ip }))
      expect(res.status).toBe(429)
      expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
      // Crucially: even WITH correct credentials, 429 wins (rate limiter runs first).
      const res2 = await GET(reqWith({ authorization: basic('admin', 'correct'), 'x-forwarded-for': ip }))
      expect(res2.status).toBe(429)
    },
  )

  it(
    'successful checks do not drain the bucket (refund-on-success)',
    { timeout: 30_000 },
    async () => {
      const ip = '203.0.113.150'
      for (let i = 0; i < __limits.CAPACITY * 2; i += 1) {
        const res = await GET(
          reqWith({ authorization: basic('admin', 'correct'), 'x-forwarded-for': ip }),
        )
        expect(res.status).toBe(200)
      }
    },
  )

  it('different IPs have independent buckets', { timeout: 30_000 }, async () => {
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': '203.0.113.50' }))
    }
    const exhausted = await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': '203.0.113.50' }))
    expect(exhausted.status).toBe(429)
    const fresh = await GET(reqWith({ authorization: basic('admin', 'correct'), 'x-forwarded-for': '203.0.113.51' }))
    expect(fresh.status).toBe(200)
  })

  it('reads last X-Forwarded-For entry, not the first (anti-spoof)', { timeout: 30_000 }, async () => {
    const realIp = '203.0.113.77'
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': `spoofed-1, spoofed-2, ${realIp}` }))
    }
    // Same real IP, different spoof prefix → still 429 (correctly keyed).
    const res = await GET(reqWith({ authorization: basic('admin', 'WRONG'), 'x-forwarded-for': `other-spoof, ${realIp}` }))
    expect(res.status).toBe(429)
  })
})
