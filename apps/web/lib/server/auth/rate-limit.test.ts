import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __limits, __resetForTests, clientIpFromHeaders, consume, refund } from './rate-limit'

beforeEach(() => __resetForTests())
afterEach(() => __resetForTests())

describe('consume', () => {
  it('passes the first <CAPACITY> requests in a tight burst', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      expect(consume('1.2.3.4', now + i).ok).toBe(true)
    }
  })

  it('returns 429 with Retry-After once the bucket is empty', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < __limits.CAPACITY; i += 1) consume('1.2.3.4', now)
    const res = consume('1.2.3.4', now)
    expect(res.ok).toBe(false)
    expect(res.retryAfter).toBeGreaterThanOrEqual(1)
    // 1 token at 60/60s refill = 1 second; ceil() to ≥ 1.
    expect(res.retryAfter).toBeLessThanOrEqual(2)
  })

  it('different IPs get independent buckets', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < __limits.CAPACITY; i += 1) consume('a', now)
    expect(consume('a', now).ok).toBe(false)
    expect(consume('b', now).ok).toBe(true)
  })

  it('refills tokens lazily as time passes', () => {
    const now = 1_700_000_000_000
    for (let i = 0; i < __limits.CAPACITY; i += 1) consume('x', now)
    expect(consume('x', now).ok).toBe(false)

    // 30 seconds → +30 tokens at 60/60s refill, capped at CAPACITY.
    const later = now + 30_000
    const res = consume('x', later)
    expect(res.ok).toBe(true)
  })

  it('caps refill at CAPACITY', () => {
    const now = 1_700_000_000_000
    consume('y', now) // tokens: 4
    // Wait a long time — should not exceed capacity.
    const muchLater = now + 10 * 60_000
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      expect(consume('y', muchLater + i).ok).toBe(true)
    }
    expect(consume('y', muchLater + __limits.CAPACITY).ok).toBe(false)
  })
})

describe('refund', () => {
  it('returns one token to a partially-drained bucket', () => {
    const now = 1_700_000_000_000
    consume('r', now)
    consume('r', now)
    refund('r', now)
    // Drain CAPACITY-1 more (one was net-consumed); the next one still passes.
    for (let i = 0; i < __limits.CAPACITY - 1; i += 1) consume('r', now)
    // Bucket should now be empty exactly — one more consume should 429.
    expect(consume('r', now).ok).toBe(false)
  })

  it('caps at CAPACITY (refunding a full bucket is a no-op)', () => {
    const now = 1_700_000_000_000
    refund('s', now) // creates bucket at CAPACITY, then no-ops cap
    refund('s', now)
    refund('s', now)
    for (let i = 0; i < __limits.CAPACITY; i += 1) {
      expect(consume('s', now + i).ok).toBe(true)
    }
    expect(consume('s', now + __limits.CAPACITY).ok).toBe(false)
  })

  it('lets unlimited successful auth through (consume + refund cycle)', () => {
    const now = 1_700_000_000_000
    // Simulate 10× CAPACITY successful verifications. Each pair must be
    // net-zero so we never hit 429.
    for (let i = 0; i < 10 * __limits.CAPACITY; i += 1) {
      const t = now + i
      expect(consume('t', t).ok).toBe(true)
      refund('t', t)
    }
  })
})

describe('clientIpFromHeaders', () => {
  it('uses the last entry of X-Forwarded-For when present', () => {
    const h = new Headers()
    h.set('x-forwarded-for', '203.0.113.5, 127.0.0.1')
    expect(clientIpFromHeaders(h)).toBe('127.0.0.1')
  })

  it('handles a single-entry XFF', () => {
    const h = new Headers()
    h.set('x-forwarded-for', '203.0.113.5')
    expect(clientIpFromHeaders(h)).toBe('203.0.113.5')
  })

  it('falls back to socketAddr when no XFF', () => {
    const h = new Headers()
    expect(clientIpFromHeaders(h, '10.0.0.1')).toBe('10.0.0.1')
  })

  it('returns "unknown" when neither is present', () => {
    expect(clientIpFromHeaders(new Headers())).toBe('unknown')
  })

  it('uses last XFF entry (Caddy-appended trusted hop) — anti-spoofing', () => {
    // Caddy `reverse_proxy` appends the real client IP to whatever the
    // downstream client sent as X-Forwarded-For, so the LAST entry is the
    // one Caddy actually observed and is therefore trustworthy.
    // A malicious client putting fake IPs in XFF cannot mask their real IP
    // because Caddy's appended entry comes after.
    const h = new Headers()
    h.set('x-forwarded-for', 'fake-spoofed-1, fake-spoofed-2, 203.0.113.42')
    expect(clientIpFromHeaders(h)).toBe('203.0.113.42')
  })

  it('keys different real client IPs (last XFF entry) into independent buckets', () => {
    const now = 1_700_000_000_000
    const real1 = new Headers()
    real1.set('x-forwarded-for', '203.0.113.1')
    const real2 = new Headers()
    real2.set('x-forwarded-for', '203.0.113.2')
    for (let i = 0; i < __limits.CAPACITY; i += 1) consume(clientIpFromHeaders(real1), now)
    expect(consume(clientIpFromHeaders(real1), now).ok).toBe(false)
    expect(consume(clientIpFromHeaders(real2), now).ok).toBe(true)
  })
})
