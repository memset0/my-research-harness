// Pull the ticket's cluster checkout again; on success start a held start
// command once. Body: {start? (default true), force?}.

import type { NextRequest } from 'next/server'
import { forceOf, ticketDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { start?: unknown } | null
  return ticketRoute(req, async (broker, actor) => ({
    body: {
      ticket: ticketDto(
        await broker.sync(id, actor, { start: body?.start !== false, force: forceOf(req, body) }),
      ),
    },
  }))
}
