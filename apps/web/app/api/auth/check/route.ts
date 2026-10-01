// GET /api/auth/check — backs Caddy `forward_auth`.
//
// Returns 200 { ok, username } when the request carries valid `Authorization:
// Basic` credentials, 401 otherwise. Middleware skips this route (so we can
// be reached by Caddy's probe even from anonymous clients), so the rate
// limiter and scrypt verification both happen here directly.

import { type NextRequest, NextResponse } from 'next/server'
import {
  parseBasicAuth,
  TOO_MANY_HEADERS,
  UNAUTHORIZED_HEADERS,
  verifyBasic,
} from '../../../../lib/server/auth/basic-auth'
import { clientIpFromHeaders, consume, refund } from '../../../../lib/server/auth/rate-limit'
import { getRuntime } from '../../../../lib/server/runtime'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers)
  const limit = consume(ip)
  if (!limit.ok) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { ...TOO_MANY_HEADERS, 'Retry-After': String(limit.retryAfter ?? 60) },
    })
  }

  const runtime = await getRuntime()
  const parsed = parseBasicAuth(req.headers.get('authorization'))
  const ok = await verifyBasic(parsed, runtime.auth)
  if (!ok) {
    return new NextResponse('Unauthorized', { status: 401, headers: UNAUTHORIZED_HEADERS })
  }
  // Refund: legitimate authenticated probes do not drain the bucket.
  refund(ip)
  return NextResponse.json(
    { ok: true, username: runtime.auth.username },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
