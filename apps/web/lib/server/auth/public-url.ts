// Helpers for building URLs that work correctly behind a reverse proxy.
//
// memon is typically fronted by Caddy: the browser hits
// `https://memon.example.com/...`, Caddy proxies to `http://127.0.0.1:3737/...`,
// and Next.js sees `req.nextUrl.origin === 'http://localhost:3737'`. That's
// fine for internal routing, but any URL we hand to the browser (Location
// header, share_url response body) MUST reflect the public hostname or
// the user's browser will try to navigate to memon's internal address and
// fail.
//
// Two patterns covered here:
//
//   1. `publicOrigin(req)` — read `X-Forwarded-Host` + `X-Forwarded-Proto`
//      to reconstruct the original origin. Caddy is the only trusted hop
//      so its forwarded headers are safe to honour (same trust model as
//      the rate-limiter's X-Forwarded-For handling).
//
//   2. `redirectResponse(req, path)` — build a 302 response with a
//      RELATIVE Location header (just the path + query). Most clients
//      resolve relative redirects against the request's effective URL,
//      which is the public URL Caddy sees. This sidesteps the origin
//      question entirely for in-app redirects.

import 'server-only'

import type { NextRequest } from 'next/server'

export function publicOrigin(req: NextRequest): string {
  const xfHost = req.headers.get('x-forwarded-host')
  const xfProtoRaw = req.headers.get('x-forwarded-proto')
  if (xfHost) {
    // X-Forwarded-Proto may carry a comma-separated chain on multi-hop
    // setups; take the first entry (the original client-facing scheme).
    const proto = xfProtoRaw
      ? xfProtoRaw.split(',')[0]!.trim()
      : req.nextUrl.protocol.replace(':', '')
    // X-Forwarded-Host may itself be comma-separated; first entry wins.
    const host = xfHost.split(',')[0]!.trim()
    return `${proto}://${host}`
  }
  return req.nextUrl.origin
}

/** True iff the request reached us over HTTPS (directly OR via Caddy). */
export function isHttps(req: NextRequest): boolean {
  const xfp = req.headers.get('x-forwarded-proto')
  if (xfp) return xfp.split(',')[0]!.trim().toLowerCase() === 'https'
  return req.nextUrl.protocol === 'https:'
}
