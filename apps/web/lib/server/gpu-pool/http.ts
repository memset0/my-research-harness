import 'server-only'

import { type NextRequest, NextResponse } from 'next/server'
import { levelCan } from '@/lib/server/auth/capabilities'
import { type RequestIdentity, readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { getRuntime } from '@/lib/server/runtime'
import { getTicketBroker, type TicketBroker, TicketError } from './broker'
import type { Ticket } from './types'

const HEADERS = { 'Cache-Control': 'no-store' }
const STATUS = { BAD_REQUEST: 400, NOT_FOUND: 404, CONFLICT: 409, UNAVAILABLE: 503 } as const

/** Ticket access is `access_clusters`: admins and the super admin (owner Basic auth included). */
export function canUseTickets(identity: RequestIdentity): boolean {
  if (!identity.account) return identity.role === 'owner'
  return levelCan(identity.account.level, 'access_clusters')
}

/** Runs a ticket route behind the cluster capability gate, mapping broker errors to HTTP. */
export async function ticketRoute(
  req: NextRequest,
  handle: (broker: TicketBroker) => Promise<{ status?: number; body: unknown }>,
): Promise<NextResponse> {
  if (!canUseTickets(readIdentityFromRequest(req))) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'GPU tickets are available only to cluster users' } },
      { status: 403, headers: HEADERS },
    )
  }
  try {
    const broker = getTicketBroker((await getRuntime()).configPath)
    broker.start()
    const { status, body } = await handle(broker)
    return NextResponse.json(body, { status: status ?? 200, headers: HEADERS })
  } catch (err) {
    if (err instanceof TicketError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: STATUS[err.code], headers: HEADERS },
      )
    }
    return NextResponse.json(
      { error: { code: 'GPU_POOL_ERROR', message: (err as Error).message } },
      { status: 500, headers: HEADERS },
    )
  }
}

export function ticketDto(ticket: Ticket) {
  return {
    id: ticket.id,
    project: ticket.project,
    status: ticket.status,
    gpus: ticket.gpus,
    whole_node: ticket.wholeNode,
    gpu_type: ticket.gpuType,
    duration_s: ticket.durationS,
    label: ticket.label,
    run: ticket.run,
    node: ticket.node,
    granted_gpus: ticket.grantedGpus,
    requested_at: ticket.requestedAt,
    granted_at: ticket.grantedAt,
    expires_at: ticket.expiresAt,
    ended_at: ticket.endedAt,
    reason: ticket.reason,
  }
}
