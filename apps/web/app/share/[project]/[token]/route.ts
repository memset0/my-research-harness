// GET /share/<project>/<token> — anon-accessible viewer share landing.
//
// Validates the token against `<projectRoot(project)>/.memon/shares.json`
// using a constant-time compare. On success, appends `{project, token}` to
// the existing `memon-shares` cookie (dedup by project — newest token wins)
// and 302s to `/p/<project>`. On failure, renders a generic 404 page (does
// NOT distinguish "unknown project" from "bad/expired token").
//
// Rate-limit: consume one token; refund on success.

import { NextResponse, type NextRequest } from 'next/server'
import { getRuntime } from '@/lib/runtime'
import {
  buildSetCookieHeader,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
  signSharesCookie,
  verifySharesCookie,
} from '@/lib/auth/cookies'
import {
  clientIpFromHeaders,
  consume,
  refund,
} from '@/lib/auth/rate-limit'
import { isHttps, publicOrigin } from '@/lib/auth/public-url'
import { validateShare as coreValidateShare } from '@memon/core'

interface RouteParams {
  params: Promise<{ project: string; token: string }>
}

const GENERIC_NOT_FOUND_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Share link invalid or expired · memon</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 36rem;
           margin: 4rem auto; padding: 1rem; color: #111; }
    h1 { font-size: 1.25rem; }
    p { color: #555; }
    a { color: #0050ff; }
  </style>
</head>
<body>
  <h1>Share link invalid or expired</h1>
  <p>This share link is no longer valid. Ask the project owner to issue a new one.</p>
  <p><a href="/login">Owner login</a></p>
</body>
</html>`

function notFoundResponse(): NextResponse {
  return new NextResponse(GENERIC_NOT_FOUND_BODY, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
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

  const { project: projectName, token } = await ctx.params
  if (!projectName || !token) return notFoundResponse()

  const runtime = await getRuntime()
  const projectCfg = runtime.config.projects.find((p) => p.name === projectName)
  if (!projectCfg) return notFoundResponse()
  if (!runtime.auth.sessionSecret) {
    // Misconfigured — would not be able to sign the resulting cookie.
    return new NextResponse('Server not initialised', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const record = await coreValidateShare(projectCfg.root, token).catch(() => null)
  if (!record) return notFoundResponse()

  refund(ip)

  // Merge with the existing cookie. New token for the same project wins.
  const existingCookie = req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null
  const existing = existingCookie
    ? verifySharesCookie(existingCookie, runtime.auth.sessionSecret)
    : null
  const entries = existing
    ? existing.entries.filter((e) => e.project !== projectName)
    : []
  entries.push({ project: projectName, token })

  const newCookie = signSharesCookie(entries, runtime.auth.sessionSecret)

  // Build the Location against the PUBLIC origin (X-Forwarded-Host/Proto
  // from Caddy) so the browser navigates to the user-facing hostname,
  // not `http://localhost:3737/p/...` which Next.js sees.
  const target = new URL(
    `/p/${encodeURIComponent(projectName)}`,
    publicOrigin(req),
  )
  const res = new NextResponse(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
  })
  res.headers.append(
    'Set-Cookie',
    buildSetCookieHeader({
      name: SHARES_COOKIE_NAME,
      value: newCookie,
      maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
      secure: isHttps(req),
    }),
  )
  return res
}
