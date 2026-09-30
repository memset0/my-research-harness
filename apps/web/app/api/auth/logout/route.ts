// POST /api/auth/logout — clears the memon-session cookie. Owner-only
// (middleware enforces this via the default `mutating` classification).
//
// Preserves the `memon-shares` cookie so a user who was elevated from
// viewer→owner via login reverts to viewer mode (with their original share
// scopes) after logout.

import { type NextRequest, NextResponse } from 'next/server'
import { buildClearCookieHeader, SESSION_COOKIE_NAME } from '@/lib/auth/cookies'
import { isHttps, publicOrigin } from '@/lib/auth/public-url'

function wantsJson(req: NextRequest): boolean {
  const accept = req.headers.get('accept') ?? ''
  return accept.includes('application/json')
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let res: NextResponse
  if (wantsJson(req)) {
    res = new NextResponse(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } else {
    // Build the Location against the public origin so the browser lands on
    // the user-facing /login page (not memon's internal address).
    const target = new URL('/login', publicOrigin(req))
    res = new NextResponse(null, {
      status: 302,
      headers: { Location: target.toString(), 'Cache-Control': 'no-store' },
    })
  }
  res.headers.append('Set-Cookie', buildClearCookieHeader(SESSION_COOKIE_NAME, isHttps(req)))
  return res
}
