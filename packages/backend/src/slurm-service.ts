import {
  type BackendSlurmJob,
  BackendSlurmJobSchema,
  type BackendSlurmStatus,
  BackendSlurmStatusSchema,
} from '@memon/core'
import {
  type BackendExecutionProvider,
  createLocalExecutionProvider,
} from './execution-service.js'

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
/**
 * `squeue --me` on an execution target. Local targets keep the historical
 * behaviour; a remote Project runs the same argv over its configured SSH
 * target instead of against a mounted filesystem that has no Slurm.
 */
export async function runSqueueMe(
  execution: BackendExecutionProvider = createLocalExecutionProvider(),
): Promise<BackendSlurmJob[]> {
  const result = await execution.run('squeue', ['--me', '--noheader', '-O', SQUEUE_FORMAT], {
    timeoutMs: 10_000,
    maxBuffer: 262_144,
  })
  if (result.code !== 0) {
    throw new Error(
      result.spawnFailed
        ? 'squeue is not available on the execution target'
        : result.timedOut
          ? 'squeue timed out'
          : result.stderr.trim() || 'squeue failed',
    )
  }
  return parseSqueueOutput(result.stdout)
}

export interface BackendSlurmServiceOptions {
  totalNodes: number
  provider?: SlurmJobsProvider
  /**
   * Execution target for the default `squeue` reader. Omitted means local,
   * preserving today's single-node behaviour; a provider that refuses (a
   * Project with no execution configuration) surfaces its refusal from
   * `status()` rather than being silently run locally.
   */
  execution?: BackendExecutionProvider
}

export function createBackendSlurmService(
  options: BackendSlurmServiceOptions,
): BackendSlurmService | null {
  if (options.totalNodes <= 0) return null
  const provider = options.provider ?? (() => runSqueueMe(options.execution))
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
