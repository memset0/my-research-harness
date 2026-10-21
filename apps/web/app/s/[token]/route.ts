// GET /s/<token> — landing for central scoped share links.
//
// The token is validated against the central share registry (constant time,
// expiry checked). Success adds `{host, project, token}` to the viewer cookie
// (deduplicated by token, bounded) and redirects to the page the link was
// issued for — the stored landing path, never a request parameter. Unknown or
// expired tokens get the generic invalid-link page and keep the consumed
// rate-limit token.

import { type NextRequest, NextResponse } from 'next/server'
import {
  buildSetCookieHeader,
  mergeShareCookie,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
  verifySharesCookie,
} from '@/lib/server/auth/cookies'
import { isHttps, publicOrigin } from '@/lib/server/auth/public-url'
import { clientIpFromHeaders, consume, refund } from '@/lib/server/auth/rate-limit'
import { getRuntime } from '@/lib/server/runtime'
import { shareRegistryFor } from '@/lib/server/share-registry'

const GENERIC_NOT_FOUND_BODY = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Share link invalid or expired · memon</title></head>
<body><h1>Share link invalid or expired</h1><p>Ask the project owner to issue a new one.</p></body>
</html>`

function notFoundResponse(): NextResponse {
  return new NextResponse(GENERIC_NOT_FOUND_BODY, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

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
  if (!/^[A-Za-z0-9_-]{24}$/.test(token)) return notFoundResponse()

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
  if (!record) return notFoundResponse()
  refund(ip)

  const existing = verifySharesCookie(req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null, secret)
  const cookie = mergeShareCookie(
    existing,
    record.host === null
      ? { project: record.project, token }
      : { host: record.host, project: record.project, token },
    secret,
  )
  const response = new NextResponse(null, {
    status: 302,
    headers: {
      Location: new URL(record.path, publicOrigin(req)).toString(),
      'Cache-Control': 'no-store',
    },
  })
  response.headers.append(
    'Set-Cookie',
    buildSetCookieHeader({
      name: SHARES_COOKIE_NAME,
      value: cookie,
      maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
      secure: isHttps(req),
    }),
  )
  return response
}
