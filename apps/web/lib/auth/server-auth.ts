// Auth helper for the custom Node entry (apps/web/server.ts).
//
// Mirrors what apps/web/middleware.ts does for HTTP requests, but accepts a
// raw node:http IncomingMessage so it can also be invoked from the
// `upgrade` event listener (which has no access to NextRequest / Headers).
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
import { consume } from './rate-limit'

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
 * Verify HTTP Basic credentials on a raw Node request. Returns a structured
 * outcome the caller turns into an HTTP/1.1 status line + headers (for
 * `request` events) or a raw socket write (for `upgrade` events).
 *
 * Order: rate-limit FIRST (so a brute-force loop with cheap-to-fail
 * credentials still hits the bucket), then password check.
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
  const authHeader = firstHeader(req.headers['authorization'])
  const parsed = parseBasicAuth(authHeader ?? null)
  const ok = await verifyBasic(parsed, runtime.auth)
  if (!ok) {
    return { ok: false, status: 401, headers: { ...UNAUTHORIZED_HEADERS } }
  }
  return { ok: true }
}
