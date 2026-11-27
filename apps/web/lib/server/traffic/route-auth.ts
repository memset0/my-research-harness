// Owner-only gate shared by the /api/traffic routes. Middleware already
// requires `configure_instance`; handlers re-check (defense in depth).

import 'server-only'
import { type NextRequest, NextResponse } from 'next/server'
import { readIdentityFromRequest, requestCan } from '../auth/request-context'

export const TRAFFIC_HEADERS = { 'Cache-Control': 'no-store' }

export function trafficOwnerOnly(req: NextRequest): boolean {
  return readIdentityFromRequest(req).role === 'owner' && requestCan(req, 'configure_instance')
}

export function trafficError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: TRAFFIC_HEADERS })
}

export function trafficForbidden(): NextResponse {
  return trafficError(
    403,
    'FORBIDDEN',
    'traffic measurements are available only to the logged-in owner',
  )
}
