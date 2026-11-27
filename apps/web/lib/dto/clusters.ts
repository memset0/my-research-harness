// Wire shape of `GET /api/clusters` (owner-only). Connection details (SSH
// targets, via lines, enter prefixes) and process command lines never appear.

export type ClusterNodeState = 'ok' | 'unreachable' | 'expired'

export interface ClusterGpuDto {
  index: number
  name: string | null
  memory_used_mib: number | null
  memory_total_mib: number | null
  utilization_pct: number | null
  allocatable: boolean
  /** Compute processes on this GPU; `null` when the node was not probed. */
  processes: number | null
}

export interface ClusterNodeDto {
  id: string
  gpu_type: string | null
  /** GPU count declared in the registry. */
  gpus: number | null
  allocation: 'node' | 'gpus'
  allocatable_gpus: number[] | null
  available_until: string
  expired: boolean
  transport: 'ssh' | 'via'
  state: ClusterNodeState
  probed_at: string | null
  error: string | null
  gpu_rows: ClusterGpuDto[]
}

export interface ClusterGroupDto {
  cluster: string
  nodes: ClusterNodeDto[]
}

export type ClusterTicketStatus = 'QUEUED' | 'GRANTED' | 'RELEASED' | 'EXPIRED' | 'FAILED'

export interface ClusterTicketTaskDto {
  name: string
  state: string
  exit_code: number | null
}

/**
 * A GPU ticket as the dashboard shows it. `redacted` tickets belong to Projects
 * the viewer may not see: only their node, GPUs and time window are kept.
 */
export interface ClusterTaskDto {
  id: string
  state: 'QUEUED' | 'RUNNING' | 'ENDED'
  status: ClusterTicketStatus
  redacted: boolean
  project: string | null
  /** The account that requested the ticket (null when redacted or unowned). */
  owner: string | null
  label: string | null
  node: string | null
  gpus: number[]
  requested_at: string | null
  granted_at: string | null
  expires_at: string | null
  ended_at: string | null
  requested_duration_s: number
  reason: string | null
  tasks: ClusterTicketTaskDto[]
}

export interface ClusterOverviewDto {
  now: string
  clusters: ClusterGroupDto[]
  tasks: { available: boolean; items: ClusterTaskDto[] }
}
