// A ticket's tasks: list them, or start one in a persistent terminal on its GPUs.
//   POST {command, name?, force?} → 201 {task}

import type { NextRequest } from 'next/server'
import { TicketError } from '@/lib/server/gpu-pool/broker'
import { forceOf, taskDto, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return ticketRoute(req, async (broker, actor) => ({
    body: { tasks: (await broker.tasks(id, actor, forceOf(req))).map(taskDto) },
  }))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { command?: unknown; name?: unknown } | null
  return ticketRoute(req, async (broker, actor) => {
    if (!body || typeof body.command !== 'string' || body.command.trim() === '')
      throw new TicketError('BAD_REQUEST', 'command must be a non-empty shell line')
    if (body.name !== undefined && typeof body.name !== 'string')
      throw new TicketError('BAD_REQUEST', 'name must be a string')
    const view = await broker.startNamedTask(id, actor, {
      command: body.command,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      force: forceOf(req, body),
    })
    return { status: 201, body: { task: taskDto(view) } }
  })
}
