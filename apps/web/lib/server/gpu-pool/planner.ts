import type { GpuSnapshot, Ticket } from './types'

/** Less than this much used memory (with no compute process) counts as idle. */
export const IDLE_MEMORY_MIB = 1024

export interface PoolNode {
  id: string
  gpuType: string | null
  allocation: 'node' | 'gpus'
  allocatable: number[]
  availableUntilMs: number
  /** Live GPU state, or null when the node's herdr machine could not be probed. */
  snapshot: GpuSnapshot[] | null
}

export interface PlanInput {
  queue: Ticket[]
  nodes: PoolNode[]
  /** `node` → GPUs held by granted tickets. */
  held: Map<string, Set<number>>
  /** `node:gpu` keys withheld until clean. */
  dirty: Set<string>
  nowMs: number
}

export interface Plan {
  grants: Array<{ id: string; node: string; gpus: number[] }>
  failures: Array<{ id: string; reason: string }>
}

export const isIdle = (gpu: GpuSnapshot) =>
  gpu.processes === 0 && (gpu.memoryUsedMib ?? 0) < IDLE_MEMORY_MIB

const typeMatches = (ticket: Ticket, node: PoolNode) =>
  ticket.gpuType === null ||
  (node.gpuType !== null && node.gpuType.toLowerCase() === ticket.gpuType.toLowerCase())

/** GPUs the ticket needs on this node, or null when its shape can never fit the node. */
function needed(ticket: Ticket, node: PoolNode): number | null {
  const total = node.allocatable.length
  if (total === 0) return null
  if (ticket.wholeNode) return total
  const count = ticket.gpus ?? 0
  if (node.allocation === 'node') return count === total ? total : null
  return count >= 1 && count <= total ? count : null
}

export function planGrants(input: PlanInput): Plan {
  const plan: Plan = { grants: [], failures: [] }
  const held = new Map([...input.held].map(([node, gpus]) => [node, new Set(gpus)]))
  const live = input.nodes.filter((node) => node.availableUntilMs > input.nowMs)

  for (const ticket of input.queue) {
    const shaped = live.filter((node) => typeMatches(ticket, node) && needed(ticket, node) !== null)
    if (shaped.length === 0) {
      const what = ticket.wholeNode ? 'a whole node' : `${ticket.gpus} GPU(s)`
      const type = ticket.gpuType ? ` of type ${ticket.gpuType}` : ''
      plan.failures.push({ id: ticket.id, reason: `no registered node can provide ${what}${type}` })
      continue
    }
    for (const node of [...shaped].sort((a, b) => a.id.localeCompare(b.id))) {
      if (node.snapshot === null) continue
      if (node.availableUntilMs - input.nowMs < ticket.durationS * 1000) continue
      const count = needed(ticket, node) as number
      const taken = held.get(node.id) ?? new Set<number>()
      const free = node.allocatable.filter((index) => {
        if (taken.has(index) || input.dirty.has(`${node.id}:${index}`)) return false
        const gpu = node.snapshot?.find((candidate) => candidate.index === index)
        return gpu !== undefined && isIdle(gpu)
      })
      if (free.length < count) continue
      const gpus = free.slice(0, count)
      plan.grants.push({ id: ticket.id, node: node.id, gpus })
      held.set(node.id, new Set([...taken, ...gpus]))
      break
    }
  }
  return plan
}
