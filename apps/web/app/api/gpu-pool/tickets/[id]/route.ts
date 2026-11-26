// One GPU ticket; granted tickets include the launch template the CLI uses.

import type { NextRequest } from 'next/server'
import { ticketDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ticketRoute(req, async (broker) => {
    const ticket = await broker.get(id)
    const launch = ticket.status === 'GRANTED' ? await broker.template(id) : null
    return { body: { ticket: ticketDto(ticket), launch } }
  })
}
