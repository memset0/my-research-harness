// /api/terminal/proxy/* — placeholder.
//
// In production this path MUST be handled by Caddy (or similar) and
// reverse-proxied to localhost:7682 (ttyd) with WebSocket upgrade enabled.
// The site MUST also have Caddy `forward_auth` pointing at /api/auth/check
// (see README "Production deployment") so anonymous WebSocket upgrades are
// rejected before they reach ttyd. Without that directive, ttyd is exposed
// to any caller that can reach `/api/terminal/proxy/*`.
//
// If Next.js is seeing this request, Caddy isn't configured; we return 503
// with a hint so the failure mode is loud rather than silent 404.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const HINT = `\
This path must be reverse-proxied directly to ttyd (localhost:7682), and the \
Caddy site must also enable forward_auth against /api/auth/check. Add to your \
Caddyfile:

  forward_auth 127.0.0.1:3737 {
    uri /api/auth/check
    copy_headers Authorization
  }

  @terminal path /api/terminal/proxy/*
  reverse_proxy @terminal localhost:7682 {
    flush_interval -1
  }

…and reload Caddy. Without the forward_auth directive, ttyd is exposed to \
anonymous WebSocket upgrades. Next.js cannot upgrade WebSocket connections, \
so the proxy must bypass it.`

export async function GET() {
  return NextResponse.json(
    { error: { code: 'PROXY_NOT_CONFIGURED', message: HINT } },
    { status: 503 },
  )
}
export const POST = GET
export const PUT = GET
export const DELETE = GET
export const PATCH = GET
