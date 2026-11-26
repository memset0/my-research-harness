// Release a GPU ticket: reclaim its tasks and GPUs.

import type { NextRequest } from 'next/server'
import { ticketDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ticketRoute(req, async (broker) => ({
    body: { ticket: ticketDto(await broker.release(id)) },
  }))
}
