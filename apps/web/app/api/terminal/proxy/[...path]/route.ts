// /api/terminal/proxy/* — placeholder.
//
// In production this path MUST be handled by Caddy (or similar) and
// reverse-proxied to localhost:7682 (ttyd) with WebSocket upgrade enabled.
// If Next.js is seeing this request, it means Caddy isn't configured; we
// return 503 with a hint so the failure mode is loud rather than silent 404.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const HINT = `\
This path must be reverse-proxied directly to ttyd (localhost:7682). \
Add to your Caddyfile:

  @terminal path /api/terminal/proxy/*
  reverse_proxy @terminal localhost:7682 {
    flush_interval -1
  }

…and reload Caddy. Next.js cannot upgrade WebSocket connections, so the \
proxy must bypass it.`

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
