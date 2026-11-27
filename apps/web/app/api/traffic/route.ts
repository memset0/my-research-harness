// Owner-only Traffic control snapshot.
//
//   GET /api/traffic[?windowMs=N] → per Host/Project/transport aggregates over
//   a 5, 15 or 60 minute window, the most recent and slowest forwarded
//   requests, configured Projects with their probe support, and recent probe
//   results. Everything comes from bounded in-memory state; no file is read.

import { type NextRequest, NextResponse } from 'next/server'
import { DEFAULT_TRAFFIC_WINDOW_MS, TRAFFIC_WINDOWS_MS } from '@/lib/dto/traffic'
import { getRuntime } from '@/lib/server/runtime'
import {
  TRAFFIC_HEADERS,
  trafficError,
  trafficForbidden,
  trafficOwnerOnly,
} from '@/lib/server/traffic/route-auth'
import { trafficSnapshot } from '@/lib/server/traffic/snapshot'
import { trafficTracker } from '@/lib/server/traffic/tracker'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!trafficOwnerOnly(req)) return trafficForbidden()
  const raw = req.nextUrl.searchParams.get('windowMs')
  const windowMs = raw === null ? DEFAULT_TRAFFIC_WINDOW_MS : Number(raw)
  if (!(TRAFFIC_WINDOWS_MS as readonly number[]).includes(windowMs))
    return trafficError(
      400,
      'INVALID_WINDOW',
      `windowMs must be one of ${TRAFFIC_WINDOWS_MS.join(', ')}`,
    )
  const runtime = await getRuntime()
  return NextResponse.json(trafficSnapshot(trafficTracker(), runtime.config, windowMs), {
    headers: TRAFFIC_HEADERS,
  })
}
