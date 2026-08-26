// GET /share/<project>/<token> — anon-accessible viewer share landing.
//
// Validates the token against `<projectRoot(project)>/.memon/shares.json`
// using a constant-time compare. On success, appends `{project, token}` to
// the existing `memon-shares` cookie (dedup by project — newest token wins)
// and 302s to `/p/<project>`. On failure, renders a generic 404 page (does
// NOT distinguish "unknown project" from "bad/expired token").
//
// Rate-limit: consume one token; refund on success.

import { BackendShareValidationRequestSchema, ProjectNameSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import {
  buildSetCookieHeader,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
  signHostQualifiedSharesCookie,
  signSharesCookie,
  verifySharesCookie,
} from '@/lib/auth/cookies'
import { isHttps, publicOrigin } from '@/lib/auth/public-url'
import { clientIpFromHeaders, consume, refund } from '@/lib/auth/rate-limit'
import { validateCentralShare } from '@/lib/central/central-shares'
import { getCentralFleet } from '@/lib/central/fleet-runtime'
import { getRuntime } from '@/lib/runtime'
import { standaloneServices } from '@/lib/server/standalone-services'

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
  if (!runtime.auth.sessionSecret) {
    // Misconfigured — would not be able to sign the resulting cookie.
    return new NextResponse('Server not initialised', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  if (runtime.config.central) {
    const host = runtime.config.central.legacyShareHost
    const parsedProject = ProjectNameSchema.safeParse(projectName)
    const parsedToken = BackendShareValidationRequestSchema.safeParse({ token })
    if (!host || !parsedProject.success || !parsedToken.success) return notFoundResponse()
    const fleet = await getCentralFleet().catch(() => null)
    if (!fleet) return notFoundResponse()
    const valid = await validateCentralShare({
      registry: fleet.registry,
      host,
      project: parsedProject.data,
      token: parsedToken.data.token,
      signal: req.signal,
    })
    if (!valid) return notFoundResponse()
    refund(ip)

    const existing = verifySharesCookie(
      req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null,
      runtime.auth.sessionSecret,
    )
    const entries =
      existing?.v === 2
        ? existing.entries.filter(
            (entry) => entry.host !== host || entry.project !== parsedProject.data,
          )
        : []
    entries.push({ host, project: parsedProject.data, token: parsedToken.data.token })
    const newCookie = signHostQualifiedSharesCookie(entries, runtime.auth.sessionSecret)
    const target = new URL(
      `/h/${encodeURIComponent(host)}/p/${encodeURIComponent(parsedProject.data)}`,
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
        value: newCookie,
        maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
        secure: isHttps(req),
      }),
    )
    return response
  }

  const valid = await standaloneServices(runtime.config)
    .shares.validate(projectName, token)
    .catch(() => false)
  if (!valid) return notFoundResponse()

  refund(ip)

  // Merge with the existing cookie. New token for the same project wins.
  const existingCookie = req.cookies.get(SHARES_COOKIE_NAME)?.value ?? null
  const existing = existingCookie
    ? verifySharesCookie(existingCookie, runtime.auth.sessionSecret)
    : null
  const entries = existing?.v === 1 ? existing.entries.filter((e) => e.project !== projectName) : []
  entries.push({ project: projectName, token })

  const newCookie = signSharesCookie(entries, runtime.auth.sessionSecret)

  // Build the Location against the PUBLIC origin (X-Forwarded-Host/Proto
  // from Caddy) so the browser navigates to the user-facing hostname,
  // not `http://localhost:3737/p/...` which Next.js sees.
  const target = new URL(`/p/${encodeURIComponent(projectName)}`, publicOrigin(req))
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
