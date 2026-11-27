// Release a GPU ticket: reclaim its tasks and GPUs. Owner only (super admin with force).

import type { NextRequest } from 'next/server'
import { forceOf, ticketDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  return ticketRoute(req, async (broker, actor) => ({
    body: { ticket: ticketDto(await broker.release(id, actor, forceOf(req, body))) },
  }))
}
