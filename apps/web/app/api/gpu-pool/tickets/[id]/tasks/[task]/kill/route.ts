// End a task's program.

import type { NextRequest } from 'next/server'
import { forceOf, taskDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; task: string }> },
) {
  const { id, task } = await params
  const body = await req.json().catch(() => null)
  return ticketRoute(req, async (broker, actor) => ({
    body: { task: taskDto(await broker.killTask(id, actor, task, forceOf(req, body))) },
  }))
}
