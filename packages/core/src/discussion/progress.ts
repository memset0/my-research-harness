import { questionSettled } from './model.js'

/** One unit as seen by progress: stored fields plus the response-derived display status. */
export interface ProgressUnit {
  type?: string | null
  status?: string | null
  work?: string | null
  displayStatus: string
}

/**
 * Two-axis discussion progress. `counted` excludes DROPPED, DEFERRED and invalid units and is
 * partitioned exactly by completed + awaitingWork + waitingOwner + awaitingAgent + otherUnsettled.
 */
export interface DiscussionProgress {
  counted: number
  settled: number
  completed: number
  awaitingWork: number
  waitingOwner: number
  awaitingAgent: number
  otherUnsettled: number
  deferred: number
  dropped: number
  invalid: number
}

export type ProgressSegment =
  | 'completed'
  | 'awaitingWork'
  | 'waitingOwner'
  | 'awaitingAgent'
  | 'otherUnsettled'
  | 'deferred'
  | 'dropped'
  | 'invalid'

/** The single progress bucket of a unit; the order of checks is the precedence. */
export function progressSegment(unit: ProgressUnit): ProgressSegment {
  if (unit.displayStatus === 'INVALID' || !unit.status) return 'invalid'
  if (unit.status === 'DROPPED') return 'dropped'
  if (unit.status === 'DEFERRED') return 'deferred'
  const settled = questionSettled(unit)
  if (settled && (unit.work === 'DONE' || unit.work === 'SKIP')) return 'completed'
  // Unprocessed owner feedback outranks pending work: the agent must read it first.
  if (unit.displayStatus === 'ANSWERED') return 'awaitingAgent'
  if (
    unit.type !== 'subgoal' &&
    (unit.displayStatus === 'OPEN' || unit.displayStatus === 'REVISED')
  )
    return 'waitingOwner'
  if (settled) return 'awaitingWork'
  return 'otherUnsettled'
}

export function deriveDiscussionProgress(units: readonly ProgressUnit[]): DiscussionProgress {
  const progress: DiscussionProgress = {
    counted: 0,
    settled: 0,
    completed: 0,
    awaitingWork: 0,
    waitingOwner: 0,
    awaitingAgent: 0,
    otherUnsettled: 0,
    deferred: 0,
    dropped: 0,
    invalid: 0,
  }
  for (const unit of units) {
    const segment = progressSegment(unit)
    progress[segment]++
    if (segment === 'deferred' || segment === 'dropped' || segment === 'invalid') continue
    progress.counted++
    if (questionSettled(unit)) progress.settled++
  }
  return progress
}
