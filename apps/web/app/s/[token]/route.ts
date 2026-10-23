// GET /s/<token> — landing for central scoped share links.
//
// The token is validated against the central share registry (constant time,
// expiry checked). Success adds `{host, project, token}` to the viewer cookie
// (deduplicated by token, bounded) and redirects to the page the link was
// issued for — its canonical landing page, never a request parameter. Unknown or
// expired tokens get the generic invalid-link page and keep the consumed
// rate-limit token.

import { type NextRequest, NextResponse } from 'next/server'
import { SHARES_COOKIE_NAME } from '@/lib/server/auth/cookies'
import { isHttps, publicOrigin } from '@/lib/server/auth/public-url'
import { clientIpFromHeaders, consume, refund } from '@/lib/server/auth/rate-limit'
import { getRuntime } from '@/lib/server/runtime'
import {
  invalidShareLinkResponse,
  SHARE_TOKEN_PATTERN,
  shareLandingResponse,
} from '@/lib/server/share-landing'
import { canonicalLandingPath, shareRegistryFor } from '@/lib/server/share-registry'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const ip = clientIpFromHeaders(req.headers)
  const limit = consume(ip)
  if (!limit.ok) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfter ?? 60) },
    })
  }
  const { token } = await ctx.params
  if (!SHARE_TOKEN_PATTERN.test(token)) return invalidShareLinkResponse()

  const runtime = await getRuntime()
  const secret = runtime.auth.sessionSecret
  if (!secret) {
    return new NextResponse('Server not initialised', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const record = await shareRegistryFor(runtime.configPath)
    .find(token)
    .catch(() => null)
  const landing = record ? canonicalLandingPath(record) : null
  if (!record || landing === null) return invalidShareLinkResponse()
  refund(ip)
  return shareLandingResponse({
    record,
    existingCookie: req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null,
    secret,
    location: new URL(landing, publicOrigin(req)).toString(),
    secure: isHttps(req),
  })
}
