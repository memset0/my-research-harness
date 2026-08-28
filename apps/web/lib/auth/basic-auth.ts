// Shared helpers for HTTP Basic auth verification, used by middleware and
// /api/auth/check.
//
// We compare the client's plaintext password against the plaintext stored in
// config.yml using `crypto.timingSafeEqual` on equal-length buffers (and a
// dummy compare on length mismatch to keep timing roughly constant). scrypt
// is intentionally NOT used here: plaintext is on disk anyway (single-user
// system, host filesystem access defines the trust boundary), so a hashed-on-
// disk + scrypt-verify path would add latency without adding security. Service-
// token instance configs are additionally required to be owner-only. The rate
// limiter is the secondary defense; see rate-limit.ts.

import { timingSafeEqual } from 'node:crypto'
import type { AuthConfig } from '@memon/core'

export interface ParsedBasic {
  username: string
  password: string
}

/** Parse `Authorization: Basic <b64>` and return the decoded user/pass, or null. */
export function parseBasicAuth(headerValue: string | null | undefined): ParsedBasic | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (!trimmed.toLowerCase().startsWith('basic ')) return null
  const b64 = trimmed.slice(6).trim()
  if (!b64) return null
  let decoded: string
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return null
  return {
    username: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  }
}

/** Constant-time-ish equality on two UTF-8 strings of any length. */
function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // Force a comparison of equal-length buffers so we don't short-circuit
    // and leak length info via timing on first mismatch.
    timingSafeEqual(ab, Buffer.alloc(ab.length))
    return false
  }
  return timingSafeEqual(ab, bb)
}

/**
 * Verify parsed Basic credentials against the configured plaintext auth.
 * Returns true iff both username and password match.
 *
 * The caller MUST gate this behind the rate limiter; even though plaintext
 * compare is fast, the limiter exists to bound brute-force attempts.
 */
export async function verifyBasic(parsed: ParsedBasic | null, auth: AuthConfig): Promise<boolean> {
  if (!parsed) return false
  const userOk = safeEqualString(parsed.username, auth.username)
  const passOk = safeEqualString(parsed.password, auth.password)
  return userOk && passOk
}

export const UNAUTHORIZED_HEADERS = {
  'Cache-Control': 'no-store',
}

export const TOO_MANY_HEADERS = {
  'Cache-Control': 'no-store',
}
