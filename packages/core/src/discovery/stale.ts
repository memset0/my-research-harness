// Stale-RUNNING heuristic.
//
// When an experiment's status is RUNNING but its directory mtime hasn't
// advanced for a while, it's probably crashed without the agent updating the
// status. The frontend surfaces a `⚠` badge but does NOT change the status —
// only the user (or an agent) can decide what the new status should be.

import type { Experiment } from '../types.js'

export const DEFAULT_STALE_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

export interface StaleCheckOptions {
  thresholdMs?: number
  now?: number
}

export function isStaleRunning(exp: Experiment, options: StaleCheckOptions = {}): boolean {
  if (exp.frontMatter.status !== 'RUNNING') return false
  const threshold = options.thresholdMs ?? DEFAULT_STALE_THRESHOLD_MS
  const now = options.now ?? Date.now()
  return now - exp.mtime > threshold
}

/**
 * Returns the elapsed milliseconds since last activity on a stale-running
 * experiment, or `null` when the experiment is not stale-running.
 */
export function staleAgeMs(exp: Experiment, options: StaleCheckOptions = {}): number | null {
  if (!isStaleRunning(exp, options)) return null
  return (options.now ?? Date.now()) - exp.mtime
}
