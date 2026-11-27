// Owner-only browser→central check payload.
//
//   GET /api/traffic/payload?bytes=N (0 ≤ N ≤ 16 MiB) → exactly N random,
//   incompressible bytes, never cached. The browser times the request itself;
//   central only serves bytes.

import { randomFillSync } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { TRAFFIC_PAYLOAD_MAX_BYTES } from '@/lib/dto/traffic'
import { trafficError, trafficForbidden, trafficOwnerOnly } from '@/lib/server/traffic/route-auth'

export const dynamic = 'force-dynamic'

const CHUNK = 64 * 1024

export async function GET(req: NextRequest): Promise<Response> {
  if (!trafficOwnerOnly(req)) return trafficForbidden()
  const raw = req.nextUrl.searchParams.get('bytes') ?? '0'
  const bytes = /^\d{1,9}$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > TRAFFIC_PAYLOAD_MAX_BYTES)
    return trafficError(
      400,
      'INVALID_SIZE',
      `bytes must be an integer between 0 and ${TRAFFIC_PAYLOAD_MAX_BYTES}`,
    )
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) {
        controller.close()
        return
      }
      const size = Math.min(CHUNK, bytes - sent)
      controller.enqueue(randomFillSync(new Uint8Array(size)))
      sent += size
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(bytes),
      'Content-Encoding': 'identity',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
