// Auth middleware (Node runtime).
//
// Gates every request behind HTTP Basic auth, except for:
//   - /api/auth/check (does its own check; this is what Caddy `forward_auth`
//     calls — middleware MUST NOT short-circuit it)
//   - Next.js static asset paths (the basic-auth dialog itself can't load
//     CSS without these)
//   - The favicon
//
// Uses node-runtime middleware (Next 15.2+) so it can run scrypt directly.
// See next.config.mjs `experimental.nodeMiddleware`.
//
// Rate-limiting: a process-global token-bucket limiter (5 capacity, 10/60s
// refill, keyed on client IP from X-Forwarded-For) gates BOTH this middleware
// and /api/auth/check. Brute-force across either path is bounded.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from './lib/runtime'
import { parseBasicAuth, verifyBasic, UNAUTHORIZED_HEADERS, TOO_MANY_HEADERS } from './lib/auth/basic-auth'
import { isAuthBypass } from './lib/auth/route-classes'
import { clientIpFromHeaders, consume } from './lib/auth/rate-limit'

export const config = {
  runtime: 'nodejs',
  matcher: [
    // Run on every path except Next.js internals and static assets. We still
    // do an allow-list check inside (isAuthBypass) so the matcher is
    // deliberately broad.
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl
  if (isAuthBypass(pathname)) return NextResponse.next()

  // Rate limit BEFORE scrypt. Same key for both middleware and /api/auth/check.
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
  return NextResponse.next()
}
