import 'server-only'

// Share link landing shared by `/s/<token>` and page URLs carrying
// `?share=<token>`: the generic invalid-link page, and the redirect that adds
// the redeemed token to the viewer cookie.

import { NextResponse } from 'next/server'
import {
  buildSetCookieHeader,
  mergeShareCookie,
  SHARES_COOKIE_NAME,
  SHARES_COOKIE_TTL_SECONDS,
  verifySharesCookie,
} from './auth/cookies'
import type { ShareRegistryRecord } from './share-registry'

const GENERIC_NOT_FOUND_BODY = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Share link invalid or expired · memon</title></head>
<body><h1>Share link invalid or expired</h1><p>Ask the project owner to issue a new one.</p></body>
</html>`

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/

export function invalidShareLinkResponse(): NextResponse {
  return new NextResponse(GENERIC_NOT_FOUND_BODY, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** 302 to `location`, adding the record's token to the viewer cookie. */
export function shareLandingResponse(input: {
  record: ShareRegistryRecord
  existingCookie: string | null
  secret: string
  location: string
  secure: boolean
}): NextResponse {
  const { record } = input
  const cookie = mergeShareCookie(
    verifySharesCookie(input.existingCookie, input.secret),
    record.host === null
      ? { project: record.project, token: record.token }
      : { host: record.host, project: record.project, token: record.token },
    input.secret,
  )
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: input.location, 'Cache-Control': 'no-store' },
  })
  response.headers.append(
    'Set-Cookie',
    buildSetCookieHeader({
      name: SHARES_COOKIE_NAME,
      value: cookie,
      maxAgeSeconds: SHARES_COOKIE_TTL_SECONDS,
      secure: input.secure,
    }),
  )
  return response
}
