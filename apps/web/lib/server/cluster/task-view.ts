import 'server-only'

import type { ClusterTaskDto } from '@/lib/dto/clusters'
import type { HerdrTerminal } from '@/lib/server/gpu-pool/herdr'
import type { Ticket } from '@/lib/server/gpu-pool/types'

/** Ended tickets stay on the dashboard this long. */
export const RECENT_MS = 24 * 3600 * 1000

/** Whether the viewer may see a ticket's Project, label and tasks; others become anonymous. */
export type TicketVisibility = (project: string) => boolean

export function visibilityFor(
  granted: 'all' | ReadonlyArray<{ host: string; project: string }>,
): TicketVisibility {
  if (granted === 'all') return () => true
  return (project) =>
    granted.some((ref) => project === ref.project || project === `${ref.host}/${ref.project}`)
}

const endedMs = (ticket: Ticket) => (ticket.endedAt ? Date.parse(ticket.endedAt) : Number.NaN)

export function mapTasks(
  tickets: Ticket[],
  terminals: Map<string, HerdrTerminal[]>,
  visible: TicketVisibility,
  nowMs: number,
): ClusterTaskDto[] {
  const items: ClusterTaskDto[] = []
  for (const ticket of tickets) {
    const state =
      ticket.status === 'QUEUED' ? 'QUEUED' : ticket.status === 'GRANTED' ? 'RUNNING' : 'ENDED'
    if (state === 'ENDED' && !(nowMs - endedMs(ticket) < RECENT_MS)) continue
    const full = visible(ticket.project)
    // Others' tickets only matter where they hold GPUs.
    if (!full && state !== 'RUNNING') continue
    items.push({
      id: full ? ticket.id : 'occupied',
      state,
      status: full ? ticket.status : 'GRANTED',
      redacted: !full,
      project: full ? ticket.project : null,
      owner: full ? (ticket.owner?.username ?? null) : null,
      label: full ? ticket.label : null,
      node: ticket.node,
      gpus: ticket.grantedGpus,
      requested_at: full ? ticket.requestedAt : null,
      granted_at: ticket.grantedAt,
      expires_at: ticket.expiresAt,
      ended_at: full ? ticket.endedAt : null,
      requested_duration_s: ticket.durationS,
      reason: full ? ticket.reason : null,
      tasks: full
        ? (terminals.get(ticket.id) ?? []).map((terminal) => ({
            name: (terminal.name ?? terminal.address).replace(/^t\d{4,}-/, ''),
            state: terminal.state,
            exit_code: terminal.exitCode,
          }))
        : [],
    })
  }
  const order = { RUNNING: 0, QUEUED: 1, ENDED: 2 }
  return items.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (a.state === 'ENDED' ? (b.ended_at ?? '').localeCompare(a.ended_at ?? '') : 0),
  )
}
