// A task's screen and `lines` of history (default 200), as plain text in JSON.

import type { NextRequest } from 'next/server'
import { forceOf, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; task: string }> },
) {
  const { id, task } = await params
  const lines = Number(req.nextUrl.searchParams.get('lines') ?? 200)
  return ticketRoute(req, async (broker, actor) => ({
    body: {
      text: await broker.taskLogs(
        id,
        actor,
        task,
        Number.isFinite(lines) ? Math.trunc(lines) : 200,
        forceOf(req),
      ),
    },
  }))
}
