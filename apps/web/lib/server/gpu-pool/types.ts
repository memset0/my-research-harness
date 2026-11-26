import 'server-only'

export type TicketStatus = 'QUEUED' | 'GRANTED' | 'RELEASED' | 'EXPIRED' | 'FAILED'

export interface TicketRequest {
  project: string
  gpus?: number
  wholeNode?: boolean
  gpuType?: string
  durationS: number
  label?: string
  /** Shell line started as task `main` when the ticket is granted. */
  run?: string
}

export interface Ticket {
  id: string
  project: string
  gpus: number | null
  wholeNode: boolean
  gpuType: string | null
  durationS: number
  label: string | null
  run: string | null
  status: TicketStatus
  node: string | null
  grantedGpus: number[]
  requestedAt: string
  requestedAtMs: number
  grantedAt: string | null
  expiresAt: string | null
  expiresAtMs: number | null
  endedAt: string | null
  /** Why the ticket failed, or the last reclaim/launch error while it is still open. */
  reason: string | null
}

export interface DirtyGpu {
  node: string
  gpu: number
  since: string
  reason: string
}

export interface GpuSnapshot {
  index: number
  memoryUsedMib: number | null
  processes: number
}
