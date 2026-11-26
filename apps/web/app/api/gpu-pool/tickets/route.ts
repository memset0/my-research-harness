// GPU tickets: list with pool status, and queue a new request.

import type { NextRequest } from 'next/server'
import { ticketDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return ticketRoute(req, async (broker) => ({
    body: {
      tickets: (await broker.list()).map(ticketDto),
      dirty_gpus: await broker.dirty(),
      unticketed: broker.unticketed,
      last_tick: broker.lastTick,
    },
  }))
}

export async function POST(req: NextRequest) {
  return ticketRoute(req, async (broker) => {
    const body = await req.json().catch(() => null)
    return { status: 201, body: { ticket: ticketDto(await broker.request(body)) } }
  })
}
