import 'server-only'

export type TicketStatus = 'QUEUED' | 'GRANTED' | 'RELEASED' | 'EXPIRED' | 'FAILED'

/** The checkout pull on grant. Null until the ticket is granted. */
export type SyncState = 'PULLING' | 'READY' | 'PULL_FAILED'

/** The Run push on end. Null until the ticket ends. */
export type PushState = 'PUSHING' | 'PUSHED' | 'NOTHING_TO_PUSH' | 'PUSH_FAILED'

/** The account a ticket belongs to. */
export interface TicketOwner {
  accountId: number
  username: string
}

/** Who asks to act on a ticket. */
export interface TicketActor {
  accountId: number
  username: string
  superAdmin: boolean
}

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
  /** Null only for tickets requested before ownership existed. */
  owner: TicketOwner | null
  /** The last action the super admin forced on someone else's ticket. */
  forced: string | null
  syncState: SyncState | null
  syncCommit: string | null
  syncOutput: string | null
  /** When the start command was launched; it is launched at most once. */
  runStartedAt: string | null
  pushState: PushState | null
  pushCommit: string | null
  pushOutput: string | null
  /** Changed Run directories that recorded no ticket, left unpushed. */
  unrecordedRuns: string[]
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
