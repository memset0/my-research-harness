// Wait up to `timeout_s` (≤ 60) for a task to stop; callers repeat until it has.

import type { NextRequest } from 'next/server'
import { forceOf, taskDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; task: string }> },
) {
  const { id, task } = await params
  const body = (await req.json().catch(() => null)) as { timeout_s?: unknown } | null
  const timeout = typeof body?.timeout_s === 'number' ? body.timeout_s : 60
  return ticketRoute(req, async (broker, actor) => ({
    body: { task: taskDto(await broker.waitTask(id, actor, task, timeout, forceOf(req, body))) },
  }))
}
