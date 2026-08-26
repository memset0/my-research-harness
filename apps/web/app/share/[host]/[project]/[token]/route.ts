// GET /share/<host>/<project>/<token> — Host-qualified central viewer landing.
// Validation occurs against exactly one usable Backend. Success replaces any
// legacy v1 share cookie with a v2-only tuple cookie and redirects without the
// token in the Location.

import { BackendShareValidationRequestSchema, HostIdSchema, ProjectNameSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  buildSetCookieHeader,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
  signHostQualifiedSharesCookie,
  verifySharesCookie,
} from '@/lib/auth/cookies'
import { isHttps, publicOrigin } from '@/lib/auth/public-url'
import { clientIpFromHeaders, consume, refund } from '@/lib/auth/rate-limit'
import { validateCentralShare } from '@/lib/central/central-shares'
import { getCentralFleet } from '@/lib/central/fleet-runtime'
import { getRuntime } from '@/lib/runtime'

interface RouteParams {
  params: Promise<{ host: string; project: string; token: string }>
}

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

export async function GET(req: NextRequest, ctx: RouteParams): Promise<NextResponse> {
  const ip = clientIpFromHeaders(req.headers)
  const limit = consume(ip)
  if (!limit.ok) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(limit.retryAfter ?? 60),
      },
    })
  }

  const raw = await ctx.params
  const host = HostIdSchema.safeParse(raw.host)
  const project = ProjectNameSchema.safeParse(raw.project)
  const token = BackendShareValidationRequestSchema.safeParse({ token: raw.token })
  if (!host.success || !project.success || !token.success) return notFoundResponse()

  const runtime = await getRuntime()
  if (!runtime.config.central) return notFoundResponse()
  const secret = runtime.auth.sessionSecret
  if (!secret) {
    return new NextResponse('Server not initialised', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const fleet = await getCentralFleet().catch(() => null)
  if (!fleet) return notFoundResponse()
  const valid = await validateCentralShare({
    registry: fleet.registry,
    host: host.data,
    project: project.data,
    token: token.data.token,
    signal: req.signal,
  })
  if (!valid) return notFoundResponse()
  refund(ip)

  const existingValue = req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null
  const existing = verifySharesCookie(existingValue, secret)
  // Never mix or reinterpret legacy v1 name-only entries in central mode.
  const entries =
    existing?.v === 2
      ? existing.entries.filter(
          (entry) => entry.host !== host.data || entry.project !== project.data,
        )
      : []
  entries.push({ host: host.data, project: project.data, token: token.data.token })
  const cookie = signHostQualifiedSharesCookie(entries, secret)

  const target = new URL(
    `/h/${encodeURIComponent(host.data)}/p/${encodeURIComponent(project.data)}`,
    publicOrigin(req),
  )
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
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
