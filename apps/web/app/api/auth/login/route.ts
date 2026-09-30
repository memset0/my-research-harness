// POST /api/auth/login — anon-accessible owner login endpoint.
//
// Form-encoded body: { username, password, next? }. On success, sets the
// `memon-session` cookie (HMAC-signed, 30-day rolling expiry) and 302s to
// `next` (validated to be a same-origin path). On failure, returns either
// a 302 back to /login?error=1&next=<next> (form/HTML submission) or a
// JSON 401 (Accept: application/json).
//
// Rate-limit: consume one token; refund on success only.

import { type NextRequest, NextResponse } from 'next/server'
import { verifyBasic } from '@/lib/auth/basic-auth'
import {
  buildSetCookieHeader,
  OWNER_SESSION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  signSessionCookie,
} from '@/lib/auth/cookies'
import { isHttps, publicOrigin } from '@/lib/auth/public-url'
import { clientIpFromHeaders, consume, refund } from '@/lib/auth/rate-limit'
import { getRuntime } from '@/lib/runtime'

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get('accept') ?? ''
  return accept.includes('application/json')
}

function validateNext(raw: string | null): string {
  if (!raw) return '/'
  if (!raw.startsWith('/')) return '/'
  if (raw.startsWith('//')) return '/'
  if (raw.startsWith('/api/auth/')) return '/'
  return raw
}

function publicRedirect(
  req: NextRequest,
  path: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const target = new URL(path, publicOrigin(req))
  return new NextResponse(null, {
    status: 302,
    headers: { Location: target.toString(), 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Rate limit before any compare.
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

  // Parse form body.
  const contentType = req.headers.get('content-type') ?? ''
  let username = ''
  let password = ''
  let next = '/'
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text()
    const form = new URLSearchParams(text)
    username = form.get('username') ?? ''
    password = form.get('password') ?? ''
    next = validateNext(form.get('next'))
  } else if (contentType.includes('application/json')) {
    try {
      const body = (await req.json()) as { username?: string; password?: string; next?: string }
      username = body.username ?? ''
      password = body.password ?? ''
      next = validateNext(body.next ?? null)
    } catch {
      // fall through with empty creds → 401
    }
  } else {
    return new NextResponse('Unsupported Media Type', {
      status: 415,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const runtime = await getRuntime()
  if (!runtime.auth.sessionSecret) {
    // Server is misconfigured — session_secret should have been
    // auto-generated on first run. Refuse to issue an unsigned cookie.
    return new NextResponse('Server not initialised', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const ok = await verifyBasic(
    { username, password },
    {
      username: runtime.auth.username,
      password: runtime.auth.password,
    },
  )
  if (!ok) {
    if (wantsJson(req)) {
      return new NextResponse(JSON.stringify({ ok: false }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    }
    const q = new URLSearchParams({ error: '1' })
    if (next !== '/') q.set('next', next)
    return publicRedirect(req, `/login?${q.toString()}`)
  }

  refund(ip)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const cookieValue = signSessionCookie(
    {
      v: 1,
      role: 'owner',
      iat: nowSeconds,
      exp: nowSeconds + OWNER_SESSION_TTL_SECONDS,
    },
    runtime.auth.sessionSecret,
  )

  if (wantsJson(req)) {
    const res = new NextResponse(JSON.stringify({ ok: true, next }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
    res.headers.append(
      'Set-Cookie',
      buildSetCookieHeader({
        name: SESSION_COOKIE_NAME,
        value: cookieValue,
        maxAgeSeconds: OWNER_SESSION_TTL_SECONDS,
        secure: isHttps(req),
      }),
    )
    return res
  }

  // Build the Location against the PUBLIC origin (X-Forwarded-Host/Proto
  // from Caddy) so the browser navigates to the user-facing hostname,
  // not memon's internal `localhost:3737`. `next` is already validated to
  // be a same-origin absolute path.
  const res = publicRedirect(req, next)
  res.headers.append(
    'Set-Cookie',
    buildSetCookieHeader({
      name: SESSION_COOKIE_NAME,
      value: cookieValue,
      maxAgeSeconds: OWNER_SESSION_TTL_SECONDS,
      secure: isHttps(req),
    }),
  )
  return res
}
