// Response DTOs: Slurm queue status (`/api/slurm/status`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

export interface SlurmJobJson {
  jobId: string
  partition: string
  name: string
  state: string
  time: string
  numNodes: number
  nodeList: string
}

export type SlurmStatus =
  | { enabled: false }
  | {
      enabled: true
      totalNodes: number
      usedNodes: number
      jobs: SlurmJobJson[]
    }
  | {
      enabled: true
      error: { code: 'SLURM_UNAVAILABLE'; message: string }
    }
