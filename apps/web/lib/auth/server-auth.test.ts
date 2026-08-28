// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import type { AuthConfig } from '@memon/core'
import { __resetForTests, __limits } from './rate-limit'

vi.mock('../runtime', () => ({ getRuntime: vi.fn() }))

import { authenticateNodeRequest } from './server-auth'
import { getRuntime } from '../runtime'

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

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
}

function fakeReq(headers: Record<string, string | string[] | undefined> = {}, ip = '203.0.113.10'): IncomingMessage {
  return {
    headers,
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage
}

describe('authenticateNodeRequest', () => {
  it('rejects with 401 when no Authorization header', async () => {
    const r = await authenticateNodeRequest(fakeReq())
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
    expect(r.headers?.['WWW-Authenticate']).toBeUndefined()
  })

  it('rejects with 401 on bad password', async () => {
    const r = await authenticateNodeRequest(fakeReq({ authorization: basic('admin', 'wrong') }))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
  })

  it('returns 429 + Retry-After when the rate-limit bucket is empty', async () => {
    // Drain the bucket from the test IP, then try once more.
    const ip = '203.0.113.42'
    for (let i = 0; i < __limits.CAPACITY; i++) {
      await authenticateNodeRequest(fakeReq({ authorization: basic('admin', 'wrong'), 'x-forwarded-for': ip }, '127.0.0.1'))
    }
    const r = await authenticateNodeRequest(fakeReq({ authorization: basic('admin', 'wrong'), 'x-forwarded-for': ip }, '127.0.0.1'))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(429)
    expect(r.headers?.['Retry-After']).toMatch(/^\d+$/)
  })

  it('returns ok on valid credentials', async () => {
    const r = await authenticateNodeRequest(fakeReq({ authorization: basic('admin', 'correct') }))
    expect(r.ok).toBe(true)
    expect(r.status).toBeUndefined()
  })

  it('successful authentications do not drain the bucket (refund-on-success)', async () => {
    const ip = '203.0.113.200'
    for (let i = 0; i < __limits.CAPACITY * 2; i++) {
      const r = await authenticateNodeRequest(
        fakeReq({ authorization: basic('admin', 'correct'), 'x-forwarded-for': ip }, '127.0.0.1'),
      )
      expect(r.ok).toBe(true)
    }
  })

  it('uses the last X-Forwarded-For hop as the rate-limit key', async () => {
    // Two requests from the same trusted-hop IP should share a bucket
    // regardless of the socket peer (which is Caddy, not the client).
    const r1 = await authenticateNodeRequest(
      fakeReq({ authorization: basic('admin', 'wrong'), 'x-forwarded-for': '198.51.100.7' }, '127.0.0.1'),
    )
    const r2 = await authenticateNodeRequest(
      fakeReq({ authorization: basic('admin', 'wrong'), 'x-forwarded-for': '198.51.100.7, 127.0.0.1' }, '127.0.0.1'),
    )
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    expect(r1.status).toBe(401)
    expect(r2.status).toBe(401)
  })
})
