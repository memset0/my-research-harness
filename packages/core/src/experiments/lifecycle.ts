import type { ExperimentDescription } from '../results/description.js'
import { deriveVariantStatus } from '../results/summary.js'
import {
  type ExperimentDisplayStatus,
  type ExperimentStatus,
  isExperimentLifecycle,
  type Status,
} from '../types.js'

export interface ExperimentLifecycleRun {
  path: string
  status: Status
  deprecated: boolean
}
export interface ExperimentLifecycleProjection {
  lifecycle: ExperimentStatus
  displayStatus: ExperimentDisplayStatus
  requiredVariantCount: number
  currentRunningRunCount: number
  /** All declared members, including excluded generations and deprecated evidence. */
  runningRunCount: number
}

/** Read-time progress from current definitions and member Run facts; never reads result CSV. */
export function projectExperimentLifecycle(
  lifecycle: ExperimentStatus,
  description: ExperimentDescription | null,
  runs: readonly ExperimentLifecycleRun[],
): ExperimentLifecycleProjection {
  const byPath = new Map(runs.map((run) => [run.path, run]))
  const projection: ExperimentLifecycleProjection = {
    lifecycle,
    displayStatus: lifecycle,
    requiredVariantCount: 0,
    currentRunningRunCount: 0,
    runningRunCount: [...byPath.values()].filter((run) => run.status === 'RUNNING').length,
  }
  // Legacy documents keep their stored presentation until explicitly migrated.
  if (!isExperimentLifecycle(lifecycle) || !description?.research) return projection
  const ledger = description.research
  const required = description.variants.filter(
    (variant) => !variant.deprecated && variant.status !== 'DROPPED',
  )
  projection.requiredVariantCount = required.length
  const currentRunning = new Set<string>()
  const statuses = required.map((variant) => {
    const current = variant.runs.filter(
      (path) => ledger.run_versions[path] === ledger.current_version,
    )
    const records = current.map((path) => {
      const run = byPath.get(path)
      if (run?.status === 'RUNNING' && !run.deprecated) currentRunning.add(path)
      return run ? { status: run.status, deprecated: run.deprecated, stop_reason: null } : null
    })
    return deriveVariantStatus(variant.status ?? null, records, variant.frozen?.status ?? null)
  })
  projection.currentRunningRunCount = currentRunning.size
  if (lifecycle !== 'ACTIVE') return projection
  if (currentRunning.size) projection.displayStatus = 'RUNNING'
  else if (statuses.length > 0 && statuses.every((status) => status === 'COMPLETED'))
    projection.displayStatus = 'COMPLETED'
  return projection
}
