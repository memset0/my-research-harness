// HMAC-signed cookie primitives for `memon-session` (owner) and
// `memon-shares` (viewer scope set).
//
// Cookie value shape: base64url(canonicalJSON({payload, sig}))
// where `sig = base64url(HMAC-SHA256(secret, canonicalJSON(payload)))`.
//
// Canonical JSON is JSON.stringify with object keys sorted lexicographically,
// no whitespace. This gives a deterministic byte sequence to HMAC.
//
// Verification is constant-time via `timingSafeEqual`. Invalid signature,
// malformed payload, or missing secret all result in `null` (treated as
// "cookie not present" by callers).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { HostIdSchema, ProjectNameSchema } from '@memon/core'

// ----- Canonical JSON (sorted keys, compact) -----

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(v: unknown): unknown {
  if (v === null) return null
  if (Array.isArray(v)) return v.map(sortKeysDeep)
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

// ----- Base64URL encode / decode (no padding) -----

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64url')
}

function b64urlDecode(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  try {
    return Buffer.from(s, 'base64url')
  } catch {
    return null
  }
}

// ----- Sign / verify -----

function hmac(secret: string, message: string): Buffer {
  return createHmac('sha256', secret).update(message, 'utf8').digest()
}

function safeEqualB64(a: string, b: string): boolean {
  const ab = b64urlDecode(a)
  const bb = b64urlDecode(b)
  if (!ab || !bb) return false
  if (ab.length !== bb.length) {
    // Dummy compare to keep timing roughly constant.
    timingSafeEqual(ab, Buffer.alloc(ab.length))
    return false
  }
  return timingSafeEqual(ab, bb)
}

interface SignedEnvelope {
  payload: unknown
  sig: string
}

/**
 * Sign an arbitrary payload. Returns the cookie value string (a single
 * base64url-encoded JSON object containing payload + sig). Throws on missing
 * secret to avoid accidentally writing unsigned cookies.
 */
export function signCookie(payload: unknown, secret: string): string {
  if (!secret) throw new Error('signCookie: empty secret')
  const canonicalPayload = canonicalJson(payload)
  const sig = b64urlEncode(hmac(secret, canonicalPayload))
  const envelope: SignedEnvelope = { payload, sig }
  return b64urlEncode(Buffer.from(canonicalJson(envelope), 'utf8'))
}

/**
 * Verify a cookie value and return the decoded payload, or `null` on any
 * failure (no envelope / wrong base64 / wrong signature / missing keys).
 * Safe to feed arbitrary attacker-controlled input.
 */
export function verifyCookie<T = unknown>(
  cookieValue: string | undefined | null,
  secret: string,
): T | null {
  if (!cookieValue || !secret) return null
  const envelopeBuf = b64urlDecode(cookieValue)
  if (!envelopeBuf) return null
  let envelope: SignedEnvelope
  try {
    const parsed = JSON.parse(envelopeBuf.toString('utf8')) as SignedEnvelope
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sig !== 'string') return null
    envelope = parsed
  } catch {
    return null
  }
  const expectedSig = b64urlEncode(hmac(secret, canonicalJson(envelope.payload)))
  if (!safeEqualB64(expectedSig, envelope.sig)) return null
  return envelope.payload as T
}

// ----- High-level helpers per cookie type -----

export interface SessionPayload {
  v: 1
  role: 'owner'
  /** Issued at, seconds since epoch */
  iat: number
  /** Expires at, seconds since epoch */
  exp: number
}

export function signSessionCookie(payload: SessionPayload, secret: string): string {
  return signCookie(payload, secret)
}

export function verifySessionCookie(
  cookieValue: string | undefined | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  const payload = verifyCookie<SessionPayload>(cookieValue, secret)
  if (!payload) return null
  if (payload.v !== 1) return null
  if (payload.role !== 'owner') return null
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null
  if (payload.exp <= nowSeconds) return null
  return payload
}

export interface LegacyShareEntry {
  project: string
  token: string
  host?: never
}

export interface HostQualifiedShareEntry {
  host: string
  project: string
  token: string
}

export type ShareEntry = LegacyShareEntry | HostQualifiedShareEntry

export interface LegacySharesPayload {
  v: 1
  entries: LegacyShareEntry[]
}

export interface HostQualifiedSharesPayload {
  v: 2
  entries: HostQualifiedShareEntry[]
}

export type SharesPayload = LegacySharesPayload | HostQualifiedSharesPayload

export function signSharesCookie(entries: ShareEntry[], secret: string): string {
  const hasHost = entries.some((entry) => entry.host !== undefined)
  const hasLegacy = entries.some((entry) => entry.host === undefined)
  if (hasHost && hasLegacy) {
    throw new Error('signSharesCookie: legacy and Host-qualified entries cannot be mixed')
  }
  const payload: SharesPayload = hasHost
    ? { v: 2, entries: entries as HostQualifiedShareEntry[] }
    : { v: 1, entries: entries as LegacyShareEntry[] }
  return signCookie(payload, secret)
}

export function signHostQualifiedSharesCookie(
  entries: HostQualifiedShareEntry[],
  secret: string,
): string {
  return signCookie({ v: 2, entries } satisfies HostQualifiedSharesPayload, secret)
}

export function verifySharesCookie(
  cookieValue: string | undefined | null,
  secret: string,
): SharesPayload | null {
  const payload = verifyCookie<SharesPayload>(cookieValue, secret)
  if (!payload) return null
  if (payload.v !== 1 && payload.v !== 2) return null
  if (!Array.isArray(payload.entries)) return null
  const seen = new Set<string>()
  for (const entry of payload.entries) {
    if (
      !entry ||
      !ProjectNameSchema.safeParse(entry.project).success ||
      typeof entry.token !== 'string' ||
      entry.token.length === 0
    ) {
      return null
    }
    if (payload.v === 1) {
      if ('host' in entry) return null
      if (Object.keys(entry).sort().join(',') !== 'project,token') return null
      const key = `${entry.project}\0${entry.token}`
      if (seen.has(key)) return null
      seen.add(key)
      continue
    }
    if (!('host' in entry) || !HostIdSchema.safeParse(entry.host).success) return null
    if (Object.keys(entry).sort().join(',') !== 'host,project,token') return null
    const key = `${entry.host}\0${entry.project}\0${entry.token}`
    if (seen.has(key)) return null
    seen.add(key)
  }
  return payload
}

// ----- Owner session lifetime + cookie attribute helpers -----

export const OWNER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
export const SHARES_COOKIE_TTL_SECONDS = 90 * 24 * 60 * 60 // 90 days

export const SESSION_COOKIE_NAME = 'memon-session'
export const SHARES_COOKIE_NAME = 'memon-shares'

export interface CookieSetOptions {
  name: string
  value: string
  maxAgeSeconds: number
  secure: boolean
}

/** Build a Set-Cookie header value for our cookies. */
export function buildSetCookieHeader(opts: CookieSetOptions): string {
  const parts = [
    `${opts.name}=${opts.value}`,
    'Path=/',
    `Max-Age=${opts.maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

/** Build a Set-Cookie header value that clears a cookie. */
export function buildClearCookieHeader(name: string, secure: boolean): string {
  return buildSetCookieHeader({ name, value: '', maxAgeSeconds: 0, secure })
}

/**
 * Random session id used as a stable cache key in some test mocks. Not used
 * in the cookie itself.
 */
export function randomSessionId(): string {
  return b64urlEncode(randomBytes(12))
}

// ----- Test-only exports -----

export const __testHmac = hmac
export const __testB64urlEncode = b64urlEncode
export const __testB64urlDecode = b64urlDecode
