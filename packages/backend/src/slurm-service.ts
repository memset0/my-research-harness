import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type BackendSlurmJob,
  BackendSlurmJobSchema,
  type BackendSlurmStatus,
  BackendSlurmStatusSchema,
} from '@memon/core'

const execFile = promisify(nodeExecFile)
const SQUEUE_FORMAT = 'JobID:|,Partition:|,Name:|,StateCompact:|,TimeUsed:|,NumNodes:|,NodeList:|'
export type SlurmJobsProvider = () => Promise<readonly BackendSlurmJob[]>
export interface BackendSlurmService {
  readonly enabled: boolean
  status(): Promise<BackendSlurmStatus>
}

export function parseSqueueOutput(stdout: string): BackendSlurmJob[] {
  const jobs: BackendSlurmJob[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split('|')
    if (parts.length === 8 && parts[7] === '') parts.pop()
    if (parts.length !== 7) throw new Error('invalid squeue response')
    jobs.push(
      BackendSlurmJobSchema.parse({
        jobId: parts[0],
        partition: parts[1],
        name: parts[2],
        state: parts[3],
        time: parts[4],
        numNodes: Number(parts[5]),
        nodeList: parts[6],
      }),
    )
  }
  return jobs
}
export async function runSqueueMe(): Promise<BackendSlurmJob[]> {
  const { stdout } = await execFile('squeue', ['--me', '--noheader', '-O', SQUEUE_FORMAT], {
    timeout: 10_000,
    maxBuffer: 262_144,
  })
  return parseSqueueOutput(stdout)
}
export function createBackendSlurmService(options: {
  totalNodes: number
  provider?: SlurmJobsProvider
}): BackendSlurmService | null {
  if (options.totalNodes <= 0) return null
  const provider = options.provider ?? runSqueueMe
  return {
    enabled: true,
    async status() {
      const jobs = (await provider()).map((job) => BackendSlurmJobSchema.parse(job))
      return BackendSlurmStatusSchema.parse({
        enabled: true,
        totalNodes: options.totalNodes,
        usedNodes: jobs
          .filter((job) => job.state === 'R')
          .reduce((sum, job) => sum + job.numNodes, 0),
        jobs,
      })
    },
  }
}
