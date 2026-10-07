import { AsyncLocalStorage } from 'node:async_hooks'
import type { FileAccessOptions } from '../types.js'
import { monotonic } from './clock.js'
import type { FileOperationName } from './contract.js'

interface Demand {
  project: string
  bytes: number
  automatic: () => boolean
  operation: FileOperationName
  deferredOperation?: boolean
  deferredBytes?: boolean
  enqueued: number
  resolve: (finish: (actualBytes: number) => void) => void
  reject: (error: Error) => void
}
interface Bucket {
  active: number
  tokens: number
  bytes: number
  background: number
  backgroundBytes: number
  source: string
  updated: number
  queue: Demand[]
  timer?: NodeJS.Timeout
  lastProject?: string
  operationDeferrals: number
  byteDeferrals: number
}

export interface SourceBudgetTiming {
  waitMs: number
  automatic: () => boolean
}
const TIMING = Symbol.for('memon.source-budget-timing.v1')
const timingCarrier = globalThis as unknown as { [TIMING]?: AsyncLocalStorage<SourceBudgetTiming> }
timingCarrier[TIMING] ??= new AsyncLocalStorage<SourceBudgetTiming>()
const timingStorage = timingCarrier[TIMING]
export function sourceBudgetTiming(): SourceBudgetTiming | undefined {
  return timingStorage.getStore()
}
export function withSourceBudgetTiming<T>(
  timing: SourceBudgetTiming,
  work: () => Promise<T>,
): Promise<T> {
  return timingStorage.run(timing, work)
}

/** Independent admission budgets. Completion refunds unused reserved bytes, never operation credits. */
export class SourceBudgetPool {
  private groups = new Map<string, Bucket>()
  constructor(
    private readonly options: () => FileAccessOptions,
    private readonly onDeferral?: (
      source: string,
      operation: FileOperationName,
      automatic: boolean,
      kind: 'operation' | 'byte',
    ) => void,
    private readonly onOperation?: (
      source: string,
      operation: FileOperationName,
      automatic: boolean,
      sample: { waitMs: number; execMs: number; bytes: number; error: boolean },
    ) => void,
  ) {}
  private bucket(group: string): Bucket {
    let bucket = this.groups.get(group)
    if (!bucket) {
      const options = this.options()
      bucket = {
        source: group,
        active: 0,
        tokens: options.operationBurst,
        bytes: options.byteBurst,
        background: Math.max(1, options.operationBurst * options.backgroundShare),
        backgroundBytes: Math.max(
          options.maxReadBytes,
          options.byteBurst * options.backgroundShare,
        ),
        updated: monotonic(),
        queue: [],
        operationDeferrals: 0,
        byteDeferrals: 0,
      }
      this.groups.set(group, bucket)
    }
    return bucket
  }
  snapshot() {
    return [...this.groups].map(([source, bucket]) => ({
      source,
      queued: bucket.queue.length,
      active: bucket.active,
      operationDeferrals: bucket.operationDeferrals,
      byteDeferrals: bucket.byteDeferrals,
    }))
  }
  reserve(
    source: string,
    project: string,
    bytes: number,
    automatic: boolean | (() => boolean),
    operation: FileOperationName = 'readFile',
  ): Promise<(actualBytes: number) => void> {
    const bucket = this.bucket(source)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.options().byteBurst)
      return Promise.reject(
        Object.assign(new Error('source byte admission exceeds burst'), { code: 'LIMIT_EXCEEDED' }),
      )
    if (bucket.queue.length >= 2048)
      return Promise.reject(Object.assign(new Error('source budget queue full'), { code: 'EBUSY' }))
    return new Promise((resolve, reject) => {
      const timing = timingStorage.getStore()
      const enqueued = monotonic()
      bucket.queue.push({
        project,
        bytes,
        automatic:
          typeof automatic === 'function' ? automatic : (timing?.automatic ?? (() => automatic)),
        operation,
        enqueued,
        resolve: (finish) => {
          if (timing) timing.waitMs += Math.max(0, monotonic() - enqueued)
          resolve(finish)
        },
        reject,
      })
      this.dispatch(bucket)
    })
  }
  recordUnscheduledOperation(
    source: string,
    operation: FileOperationName,
    automatic: boolean,
    sample: { waitMs: number; execMs: number; bytes: number; error: boolean },
  ): void {
    this.onOperation?.(source, operation, automatic, sample)
  }
  refresh(source: string): void {
    const bucket = this.groups.get(source)
    if (bucket) this.dispatch(bucket)
  }
  private dispatch(bucket: Bucket): void {
    if (bucket.timer) {
      clearTimeout(bucket.timer)
      bucket.timer = undefined
    }
    const options = this.options()
    const now = monotonic()
    const seconds = Math.max(0, now - bucket.updated) / 1000
    bucket.tokens = Math.min(
      options.operationBurst,
      bucket.tokens + seconds * options.operationsPerSecond,
    )
    bucket.bytes = Math.min(options.byteBurst, bucket.bytes + seconds * options.bytesPerSecond)
    bucket.background = Math.min(
      Math.max(1, options.operationBurst * options.backgroundShare),
      bucket.background + seconds * options.operationsPerSecond * options.backgroundShare,
    )
    bucket.backgroundBytes = Math.min(
      Math.max(options.maxReadBytes, options.byteBurst * options.backgroundShare),
      bucket.backgroundBytes + seconds * options.bytesPerSecond * options.backgroundShare,
    )
    if (options.operationsPerSecond === 0) {
      bucket.tokens = Infinity
      bucket.background = Infinity
    }
    if (options.bytesPerSecond === 0) {
      bucket.bytes = Infinity
      bucket.backgroundBytes = Infinity
    }
    bucket.updated = now
    while (bucket.queue.length && bucket.active < options.concurrency) {
      const eligible = bucket.queue.filter(
        (item) =>
          bucket.tokens >= 1 &&
          bucket.bytes >= item.bytes &&
          (!item.automatic() || (bucket.background >= 1 && bucket.backgroundBytes >= item.bytes)),
      )
      const starved = bucket.queue
        .filter((item) => now - item.enqueued >= 30000)
        .sort((a, b) => a.enqueued - b.enqueued)[0]
      if (starved && !eligible.includes(starved)) break
      const alternatives = eligible.filter((item) => item.project !== bucket.lastProject)
      const pool = starved ? [starved] : alternatives.length ? alternatives : eligible
      pool.sort(
        (a, b) =>
          Number(!b.automatic() || now - b.enqueued >= 30000) -
            Number(!a.automatic() || now - a.enqueued >= 30000) || a.enqueued - b.enqueued,
      )
      const item = pool[0]
      if (!item) break
      bucket.queue.splice(bucket.queue.indexOf(item), 1)
      bucket.active++
      bucket.lastProject = item.project
      bucket.tokens -= 1
      bucket.bytes -= item.bytes
      const chargedBackground = item.automatic()
      if (chargedBackground) {
        bucket.background -= 1
        bucket.backgroundBytes -= item.bytes
      }
      let completed = false
      item.resolve((actual) => {
        if (completed) return
        completed = true
        bucket.active--
        // Large unexpected responses leave a deficit, rather than receiving unlimited credits.
        bucket.bytes = Math.min(
          this.options().byteBurst,
          bucket.bytes + item.bytes - Math.max(0, actual),
        )
        if (chargedBackground)
          bucket.backgroundBytes = Math.min(
            Math.max(
              this.options().maxReadBytes,
              this.options().byteBurst * this.options().backgroundShare,
            ),
            bucket.backgroundBytes + item.bytes - Math.max(0, actual),
          )
        this.dispatch(bucket)
      })
    }
    if (!bucket.queue.length || bucket.active >= options.concurrency) return
    let delay = 1000
    for (const item of bucket.queue) {
      const operationWait =
        options.operationsPerSecond === 0
          ? 0
          : (Math.max(0, 1 - bucket.tokens) / options.operationsPerSecond) * 1000
      const byteWait =
        options.bytesPerSecond === 0
          ? 0
          : Math.max(
              (Math.max(0, item.bytes - bucket.bytes) / options.bytesPerSecond) * 1000,
              item.automatic()
                ? (Math.max(0, item.bytes - bucket.backgroundBytes) /
                    (options.bytesPerSecond * options.backgroundShare)) *
                    1000
                : 0,
            )
      const backgroundWait =
        item.automatic() && options.operationsPerSecond > 0
          ? (Math.max(0, 1 - bucket.background) /
              (options.operationsPerSecond * options.backgroundShare)) *
            1000
          : 0
      if ((operationWait || backgroundWait) && !item.deferredOperation) {
        item.deferredOperation = true
        bucket.operationDeferrals++
        this.onDeferral?.(bucket.source, item.operation, item.automatic(), 'operation')
      }
      if (byteWait && !item.deferredBytes) {
        item.deferredBytes = true
        bucket.byteDeferrals++
        this.onDeferral?.(bucket.source, item.operation, item.automatic(), 'byte')
      }
      delay = Math.min(delay, Math.max(operationWait, byteWait, backgroundWait, 1))
    }
    bucket.timer = setTimeout(() => this.dispatch(bucket), delay)
    bucket.timer.unref()
  }
}
