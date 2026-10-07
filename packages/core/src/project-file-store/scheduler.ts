import { withSourceBudgetTiming } from './budgets.js'
// project-file-store/scheduler — the file operation scheduler.
//
// One task per queued-or-running project/path/operation key, human promotion
// of pending automatic work, anti-starvation aging, a bounded queue per
// storage group, a per-group physical concurrency budget shared with
// mutations, and the backoff arithmetic the store applies to completions.
// Everything here is memory-only. The scheduler reaches store state only
// through `SchedulerHooks`.

import { isFileURI } from '@memon/file-protocol/paths'
import type { FileAccessOptions } from '../types.js'
import type { SourceBudgetPool } from './budgets.js'
import { monotonic } from './clock.js'
import type { FileOperationName, FileOperationOrigin } from './contract.js'
import { queueFullError } from './errors.js'
import type { MetricsRegistry } from './metrics.js'
import type { Observation } from './observation.js'
import type { ScheduledTask, StorageGroup, StoreEntry } from './state.js'

/** Pending (not yet dispatched) operations retained per storage group. */
export const MAX_QUEUED_PER_GROUP = 2_048

/** What the scheduler needs from the store that owns it. */
export interface SchedulerHooks {
  budgets: SourceBudgetPool
  /** The current effective options (concurrency, heartbeat for aging). */
  options(): FileAccessOptions
  readonly metrics: MetricsRegistry
  /** The completed observation for a key, consulted at dispatch. */
  cached(key: string): Observation | undefined
  /** Accept a successful physical observation into the entry's state. */
  succeeded(
    entry: StoreEntry,
    task: ScheduledTask,
    observation: Observation,
    completedMono: number,
  ): void
  /** Record a failed physical operation in the entry's state. */
  failed(entry: StoreEntry, error: NodeJS.ErrnoException): void
  /** Runs after every executed task settles (memory bounds). */
  executed(): void
}

export class FileOperationScheduler {
  readonly groups = new Map<string, StorageGroup>()

  constructor(private readonly hooks: SchedulerHooks) {}

  groupFor(name: string): StorageGroup {
    let group = this.groups.get(name)
    if (group === undefined) {
      group = { name, active: 0, queue: [], tasks: new Map(), writeWaiters: [] }
      this.groups.set(name, group)
    }
    return group
  }

  schedule(
    entry: StoreEntry,
    operation: FileOperationName,
    origin: FileOperationOrigin,
    human: boolean,
    runner: () => Promise<Observation>,
  ): Promise<Observation> {
    const group = entry.group
    const existing = group.tasks.get(entry.key)
    if (existing !== undefined && existing.mutationGeneration === entry.mutationGeneration) {
      if (human && !existing.human) {
        // Promote the pending automatic task instead of adding a second one.
        existing.human = true
        existing.origin = 'human'
        existing.attentionGeneration = entry.attentionGeneration
        this.hooks.budgets.refresh(group.name)
      }
      this.hooks.metrics.recordCoalesced(group.name, operation, origin)
      return existing.promise
    }

    // Bounded pending work: in-flight operations are capped by the group
    // concurrency, but a blocked mount would otherwise let the queue grow
    // without limit. Human demand may displace the oldest automatic task;
    // automatic demand is refused outright (an honest error, never a
    // fabricated missing result).
    if (group.queue.length >= MAX_QUEUED_PER_GROUP) {
      const displaced = human ? this.takeOldestAutomatic(group) : undefined
      if (displaced === undefined) {
        return Promise.reject(queueFullError(entry.path))
      }
      this.settle(displaced, null, queueFullError(displaced.entry.path))
    }

    let resolveFn!: (observation: Observation) => void
    let rejectFn!: (error: unknown) => void
    const promise = new Promise<Observation>((res, rej) => {
      resolveFn = res
      rejectFn = rej
    })
    const task: ScheduledTask = {
      key: entry.key,
      entry,
      group,
      operation,
      human,
      origin,
      enqueuedAtMono: monotonic(),
      startedAtMono: null,
      attentionGeneration: entry.attentionGeneration,
      mutationGeneration: entry.mutationGeneration,
      state: 'queued',
      runner,
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    }
    group.tasks.set(entry.key, task)
    group.queue.push(task)
    this.dispatch(group)
    return promise
  }

  /** Automatic work older than this is treated as human-priority (anti-starvation). */
  private agingMs(): number {
    return Math.max(1_000, this.hooks.options().heartbeatMs * 5)
  }

  /** Remove the oldest queued automatic task so a human caller can enqueue. */
  private takeOldestAutomatic(group: StorageGroup): ScheduledTask | undefined {
    let index = -1
    let oldest = Number.POSITIVE_INFINITY
    for (let i = 0; i < group.queue.length; i += 1) {
      const task = group.queue[i]!
      if (task.human) continue
      if (task.enqueuedAtMono < oldest) {
        oldest = task.enqueuedAtMono
        index = i
      }
    }
    if (index < 0) return undefined
    return group.queue.splice(index, 1)[0]
  }

  private takeNext(group: StorageGroup): ScheduledTask | undefined {
    const now = monotonic()
    const aging = this.agingMs()
    let bestIndex = -1
    let bestPriority = -1
    let bestEnqueued = Number.POSITIVE_INFINITY
    for (let i = 0; i < group.queue.length; i += 1) {
      const task = group.queue[i]!
      const priority = task.human || now - task.enqueuedAtMono >= aging ? 1 : 0
      if (
        priority > bestPriority ||
        (priority === bestPriority && task.enqueuedAtMono < bestEnqueued)
      ) {
        bestIndex = i
        bestPriority = priority
        bestEnqueued = task.enqueuedAtMono
      }
    }
    if (bestIndex < 0) return undefined
    return group.queue.splice(bestIndex, 1)[0]
  }

  private dispatch(group: StorageGroup): void {
    while (group.queue.length > 0 && group.active < this.hooks.options().concurrency) {
      const task = this.takeNext(group)
      if (task === undefined) return
      const entry = task.entry
      const now = monotonic()
      const observation = this.hooks.cached(entry.key)
      if (
        observation !== undefined &&
        now < entry.dueAtMono &&
        entry.mutationGeneration === task.mutationGeneration
      ) {
        // Another completion already satisfied this key while it waited.
        task.startedAtMono = now
        this.hooks.metrics.recordCacheHit(group.name, task.operation, task.origin)
        this.settle(task, observation, null)
        continue
      }
      group.active += 1
      void this.execute(task)
    }
  }

  private async execute(task: ScheduledTask): Promise<void> {
    const entry = task.entry
    const group = task.group
    task.state = 'running'
    let finishBudget: ((bytes: number) => void) | undefined
    let reservedBytes = 0
    const timing = { waitMs: 0, automatic: () => !task.human }
    let waitMs = monotonic() - task.enqueuedAtMono
    try {
      if (!isFileURI(entry.root)) {
        const reserve = ['readFile', 'readdir'].includes(task.operation)
          ? this.hooks.options().maxReadBytes
          : 0
        reservedBytes = reserve
        finishBudget = await this.hooks.budgets.reserve(
          group.name,
          entry.root,
          reserve,
          () => !task.human,
          task.operation,
        )
      }
      task.startedAtMono = monotonic()
      waitMs = task.startedAtMono - task.enqueuedAtMono
      const observation = await withSourceBudgetTiming(timing, task.runner)
      const completedMono = monotonic()
      finishBudget?.(observation.bytes)
      finishBudget = undefined
      this.hooks.succeeded(entry, task, observation, completedMono)
      this.hooks.metrics.recordOperation(group.name, task.operation, task.origin, {
        waitMs: waitMs + timing.waitMs,
        execMs: Math.max(0, completedMono - task.startedAtMono - timing.waitMs),
        bytes: observation.bytes,
        error: false,
      })
      this.release(group)
      this.settle(task, observation, null)
    } catch (error) {
      finishBudget?.(reservedBytes)
      task.startedAtMono ??= monotonic()
      const completedMono = monotonic()
      this.hooks.failed(entry, error as NodeJS.ErrnoException)
      this.hooks.metrics.recordOperation(group.name, task.operation, task.origin, {
        waitMs: waitMs + timing.waitMs,
        execMs: Math.max(0, completedMono - task.startedAtMono - timing.waitMs),
        bytes: 0,
        error: true,
      })
      this.release(group)
      this.settle(task, null, error)
    }
    this.hooks.executed()
  }

  private settle(task: ScheduledTask, observation: Observation | null, error: unknown): void {
    if (task.group.tasks.get(task.key) === task) task.group.tasks.delete(task.key)
    if (observation !== null) task.resolve(observation)
    else task.reject(error)
  }

  /**
   * Take a slot in the group budget for a physical mutation. Mutations are
   * never coalesced, so they queue on their own waiter list and are granted
   * ahead of pending reads when a slot frees.
   */
  acquire(group: StorageGroup): Promise<void> {
    if (group.active < this.hooks.options().concurrency) {
      group.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((grant) => {
      group.writeWaiters.push(grant)
    })
  }

  /** Release one slot, handing it to a waiting mutation before queued reads. */
  release(group: StorageGroup): void {
    const waiter = group.writeWaiters.shift()
    if (waiter !== undefined) {
      waiter()
      return
    }
    group.active -= 1
    this.dispatch(group)
  }
}

/**
 * Next interval after a successful observation: back to `base` when the
 * observation is new or changed, or when a newer human reset happened while
 * this check ran (`sameAttention` false); otherwise multiply by `factor` up
 * to `cap`.
 */
export function successIntervalMs(
  currentMs: number,
  [base, cap]: [number, number],
  factor: number,
  firstOrChanged: boolean,
  sameAttention: boolean,
): number {
  if (firstOrChanged) return base
  if (sameAttention) return Math.min(Math.max(currentMs, base) * factor, cap)
  // A newer human reset happened while this automatic check ran.
  return base
}

/** Retry delay after `failures` consecutive failures (>= 1). */
export function failureBackoffMs(options: FileAccessOptions, failures: number): number {
  return Math.min(
    options.failureMinMs * options.backoffFactor ** (failures - 1),
    options.failureMaxMs,
  )
}
