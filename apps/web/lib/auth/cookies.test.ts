import { describe, expect, it } from 'vitest'
import {
  buildClearCookieHeader,
  buildSetCookieHeader,
  canonicalJson,
  signCookie,
  signSessionCookie,
  signSharesCookie,
  verifyCookie,
  verifySessionCookie,
  verifySharesCookie,
} from './cookies'

const SECRET = 'test-secret-abc123'

describe('canonicalJson', () => {
  it('sorts object keys lexicographically at every depth', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ z: { b: 1, a: 2 }, a: [3, 2, 1] })).toBe(
      '{"a":[3,2,1],"z":{"a":2,"b":1}}',
    )
  })

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('handles null / numbers / strings', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson({ x: null })).toBe('{"x":null}')
  })
})

describe('signCookie / verifyCookie', () => {
  it('round-trips a payload', () => {
    const cookie = signCookie({ role: 'owner', exp: 12345 }, SECRET)
    const payload = verifyCookie<{ role: string; exp: number }>(cookie, SECRET)
    expect(payload).toEqual({ role: 'owner', exp: 12345 })
  })

  it('returns null on empty cookie', () => {
    expect(verifyCookie(undefined, SECRET)).toBeNull()
    expect(verifyCookie(null, SECRET)).toBeNull()
    expect(verifyCookie('', SECRET)).toBeNull()
  })

  it('returns null on wrong secret', () => {
    const cookie = signCookie({ role: 'owner' }, SECRET)
    expect(verifyCookie(cookie, 'different-secret')).toBeNull()
  })

  it('returns null on tampered payload', () => {
    const cookie = signCookie({ role: 'viewer' }, SECRET)
    // Decode the envelope, mutate, re-encode without re-signing.
    const decoded = Buffer.from(cookie, 'base64url').toString('utf8')
    const tampered = decoded.replace('"role":"viewer"', '"role":"owner"')
    const remangled = Buffer.from(tampered, 'utf8').toString('base64url')
    expect(verifyCookie(remangled, SECRET)).toBeNull()
  })

  it('returns null on malformed base64', () => {
    expect(verifyCookie('not!base64', SECRET)).toBeNull()
  })

  it('throws on empty secret when signing', () => {
    expect(() => signCookie({}, '')).toThrow('empty secret')
  })

  it('canonical JSON ensures sig matches even when keys are re-ordered in input', () => {
    const a = signCookie({ a: 1, b: 2 }, SECRET)
    const b = signCookie({ b: 2, a: 1 }, SECRET)
    // Both produce the same cookie since canonical JSON sorts keys.
    expect(a).toBe(b)
  })
})

describe('signSessionCookie / verifySessionCookie', () => {
  it('round-trips an owner session', () => {
    const now = 1700000000
    const cookie = signSessionCookie({ v: 1, role: 'owner', iat: now, exp: now + 3600 }, SECRET)
    const payload = verifySessionCookie(cookie, SECRET, now)
    expect(payload).toEqual({ v: 1, role: 'owner', iat: now, exp: now + 3600 })
  })

  it('returns null on expired session', () => {
    const cookie = signSessionCookie(
      { v: 1, role: 'owner', iat: 100, exp: 200 },
      SECRET,
    )
    expect(verifySessionCookie(cookie, SECRET, 300)).toBeNull()
  })

  it('rejects non-owner role', () => {
    const cookie = signCookie({ v: 1, role: 'viewer', iat: 100, exp: 9_000_000_000 }, SECRET)
    expect(verifySessionCookie(cookie, SECRET, 1000)).toBeNull()
  })

  it('rejects unknown version', () => {
    const cookie = signCookie({ v: 2, role: 'owner', iat: 100, exp: 9_000_000_000 }, SECRET)
    expect(verifySessionCookie(cookie, SECRET, 1000)).toBeNull()
  })
})

describe('signSharesCookie / verifySharesCookie', () => {
  it('round-trips an entries list', () => {
    const cookie = signSharesCookie(
      [
        { project: 'a', token: 'tok-a' },
        { project: 'b', token: 'tok-b' },
      ],
      SECRET,
    )
    const payload = verifySharesCookie(cookie, SECRET)
    expect(payload).toEqual({
      v: 1,
      entries: [
        { project: 'a', token: 'tok-a' },
        { project: 'b', token: 'tok-b' },
      ],
    })
  })

  it('returns null on tampered entries', () => {
    const cookie = signSharesCookie([{ project: 'a', token: 'tok' }], SECRET)
    const decoded = Buffer.from(cookie, 'base64url').toString('utf8')
    const tampered = decoded.replace('"project":"a"', '"project":"b"')
    const remangled = Buffer.from(tampered, 'utf8').toString('base64url')
    expect(verifySharesCookie(remangled, SECRET)).toBeNull()
  })

  it('returns null when entries is not an array', () => {
    const cookie = signCookie({ v: 1, entries: 'not-array' }, SECRET)
    expect(verifySharesCookie(cookie, SECRET)).toBeNull()
  })

  it('returns null when an entry is missing fields', () => {
    const cookie = signCookie({ v: 1, entries: [{ project: 'a' }] }, SECRET)
    expect(verifySharesCookie(cookie, SECRET)).toBeNull()
  })

  it('round-trips an empty entries list', () => {
    const cookie = signSharesCookie([], SECRET)
    const payload = verifySharesCookie(cookie, SECRET)
    expect(payload).toEqual({ v: 1, entries: [] })
  })
})

describe('buildSetCookieHeader / buildClearCookieHeader', () => {
  it('builds a cookie set header with the standard attributes', () => {
    const header = buildSetCookieHeader({
      name: 'memon-session',
      value: 'abc.def.ghi',
      maxAgeSeconds: 3600,
      secure: false,
    })
    expect(header).toContain('memon-session=abc.def.ghi')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=3600')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).not.toContain('Secure')
  })

  it('adds Secure when secure=true', () => {
    const header = buildSetCookieHeader({
      name: 'memon-session',
      value: 'x',
      maxAgeSeconds: 60,
      secure: true,
    })
    expect(header).toContain('Secure')
  })

  it('clear header has empty value and Max-Age=0', () => {
    const header = buildClearCookieHeader('memon-session', false)
    expect(header).toContain('memon-session=')
    expect(header).toContain('Max-Age=0')
  })
})
