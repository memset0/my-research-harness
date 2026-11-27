import 'server-only'

import { type NextRequest, NextResponse } from 'next/server'
import { levelCan } from '@/lib/server/auth/capabilities'
import { type RequestIdentity, readIdentityFromRequest } from '@/lib/server/auth/request-context'
import { getRuntime } from '@/lib/server/runtime'
import { getTicketBroker, type TicketBroker, TicketError } from './broker'
import type { Ticket, TicketActor } from './types'

const HEADERS = { 'Cache-Control': 'no-store' }
const STATUS = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OWNER_MISMATCH: 409,
  UNAVAILABLE: 503,
} as const

/** Ticket access is `access_clusters`: admins and the super admin (owner Basic auth included). */
export function canUseTickets(identity: RequestIdentity): boolean {
  if (!identity.account) return identity.role === 'owner'
  return levelCan(identity.account.level, 'access_clusters')
}

/** The account acting on tickets: the signed-in account (owner Basic auth is account #1). */
export function ticketActor(identity: RequestIdentity): TicketActor | null {
  const account = identity.account
  // Owner credentials without an account header are account #1, the super admin.
  if (!account)
    return identity.role === 'owner' ? { accountId: 1, username: 'owner', superAdmin: true } : null
  return {
    accountId: account.id,
    username: account.username,
    superAdmin: account.level === 'super_admin',
  }
}

/** `force` from a JSON body field or a `?force=1` query parameter. */
export function forceOf(req: NextRequest, body?: unknown): boolean {
  if (body && typeof body === 'object' && (body as { force?: unknown }).force === true) return true
  return req.nextUrl.searchParams.get('force') === '1'
}

/** Runs a ticket route behind the cluster capability gate, mapping broker errors to HTTP. */
export async function ticketRoute(
  req: NextRequest,
  handle: (broker: TicketBroker, actor: TicketActor) => Promise<{ status?: number; body: unknown }>,
): Promise<NextResponse> {
  const identity = readIdentityFromRequest(req)
  const actor = ticketActor(identity)
  if (!canUseTickets(identity) || !actor) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'GPU tickets are available only to cluster users' } },
      { status: 403, headers: HEADERS },
    )
  }
  try {
    const broker = getTicketBroker((await getRuntime()).configPath)
    broker.start()
    const { status, body } = await handle(broker, actor)
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
    owner: ticket.owner?.username ?? null,
    forced: ticket.forced,
    sync: {
      state: ticket.syncState,
      commit: ticket.syncCommit,
      output: ticket.syncOutput,
      run_started_at: ticket.runStartedAt,
    },
    push: {
      state: ticket.pushState,
      commit: ticket.pushCommit,
      output: ticket.pushOutput,
      unrecorded_runs: ticket.unrecordedRuns,
    },
  }
}

export function taskDto(view: {
  task: string
  address: string
  state: string
  exitCode: number | null
}) {
  return { task: view.task, terminal: view.address, state: view.state, exit_code: view.exitCode }
}
