// Auth helper for the custom Node entry (apps/web/server.ts).
//
// Mirrors what apps/web/middleware.ts does for HTTP requests, but accepts a
// raw node:http IncomingMessage so it can also be invoked from the
// `upgrade` event listener (which has no access to NextRequest / Headers).
//
// Three-mode evaluation, OWNER-ONLY: this gate covers `/api/terminal/proxy/*`
// which is shell-classed. The viewer share cookie (mode 3) SHALL NOT be
// decoded — viewers are categorically denied terminal access.
//
//   1. Owner session cookie  (memon-session)
//   2. Owner HTTP Basic      (Authorization: Basic ...)
//
// We share the same primitives (parseBasicAuth, verifyBasic, consume) and
// the same process-global rate-limit bucket — so a brute-force attempt
// counted by middleware on HTTP cannot be circumvented by switching to a
// WebSocket upgrade against the same IP.

import type { IncomingMessage } from 'node:http'
import { getRuntime } from '../runtime'
import {
  parseBasicAuth,
  verifyBasic,
  UNAUTHORIZED_HEADERS,
  TOO_MANY_HEADERS,
} from './basic-auth'
import { consume, refund } from './rate-limit'
import {
  SESSION_COOKIE_NAME,
  verifySessionCookie,
} from './cookies'

export interface AuthOutcome {
  ok: boolean
  /** Set when ok=false; the HTTP status the server should reply with. */
  status?: 401 | 429
  /** Set when ok=false; headers to include in the rejection response. */
  headers?: Record<string, string>
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

/**
 * Parse the `Cookie` header (one or more `name=value; ...` entries) and
 * return the value of the named cookie, or null. Same simple form Next.js
 * itself uses internally for cookie parsing.
 */
function readCookie(req: IncomingMessage, name: string): string | null {
  const header = firstHeader(req.headers['cookie'])
  if (!header) return null
  // Split on `;` and find the entry whose key equals `name`. Whitespace
  // around tokens is normalized.
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const k = part.slice(0, eq).trim()
    if (k === name) {
      const v = part.slice(eq + 1).trim()
      return v
    }
  }
  return null
}

/**
 * Derive the client IP from a Node IncomingMessage. Mirrors
 * `clientIpFromHeaders` in rate-limit.ts: prefer the last hop of
 * X-Forwarded-For (Caddy is the only trusted upstream), else fall back to
 * the underlying socket's remoteAddress.
 */
function clientIpFromNodeRequest(req: IncomingMessage): string {
  const xff = firstHeader(req.headers['x-forwarded-for'])
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/**
 * Verify owner credentials on a raw Node request. Returns a structured
 * outcome the caller turns into an HTTP/1.1 status line + headers (for
 * `request` events) or a raw socket write (for `upgrade` events).
 *
 * Order: rate-limit FIRST (so a brute-force loop with cheap-to-fail
 * credentials still hits the bucket), then mode 1 (cookie), then mode 2
 * (Basic). Mode 3 (share cookie) is INTENTIONALLY not evaluated — this
 * gate protects shell routes (terminal proxy) which are owner-only.
 */
export async function authenticateNodeRequest(req: IncomingMessage): Promise<AuthOutcome> {
  const ip = clientIpFromNodeRequest(req)
  const limit = consume(ip)
  if (!limit.ok) {
    return {
      ok: false,
      status: 429,
      headers: { ...TOO_MANY_HEADERS, 'Retry-After': String(limit.retryAfter ?? 60) },
    }
  }

  const runtime = await getRuntime()
  const secret = runtime.auth.sessionSecret ?? ''

  // Mode 1: owner session cookie.
  if (secret) {
    const sessionValue = readCookie(req, SESSION_COOKIE_NAME)
    if (sessionValue) {
      const payload = verifySessionCookie(sessionValue, secret)
      if (payload) {
        refund(ip)
        return { ok: true }
      }
    }
  }

  // Mode 2: owner HTTP Basic.
  const authHeader = firstHeader(req.headers['authorization'])
  const parsed = parseBasicAuth(authHeader ?? null)
  const ok = await verifyBasic(parsed, {
    username: runtime.auth.username,
    password: runtime.auth.password,
  })
  if (ok) {
    refund(ip)
    return { ok: true }
  }

  return { ok: false, status: 401, headers: { ...UNAUTHORIZED_HEADERS } }
}
