// project-file-store/metrics — bounded rolling per-group/operation/origin metrics.

import { monotonic } from './clock.js'
import type {
  FileOperationCounters,
  FileOperationName,
  FileOperationOrigin,
  FileOperationSeries,
} from './contract.js'

export const METRIC_BUCKET_MS = 5_000
export const METRIC_BUCKET_COUNT = 180
export const METRIC_WINDOWS_MS = [60_000, 300_000, 900_000]
const HISTOGRAM_BOUNDS = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1_024, 2_048, 4_096, 8_192, 16_384, 32_768, 65_536,
  131_072,
]
const HISTOGRAM_LEN = HISTOGRAM_BOUNDS.length + 1

const ALL_OPERATIONS: FileOperationName[] = [
  'readFile',
  'readdir',
  'stat',
  'lstat',
  'realpath',
  'write',
]

// ---------------------------------------------------------------------------
// Bounded rolling metrics
// ---------------------------------------------------------------------------

interface MetricBucket {
  slot: number
  samples: number
  errors: number
  cacheHits: number
  coalesced: number
  readBytes: number
  execSum: number
  waitSum: number
  exec: Uint32Array
  wait: Uint32Array
}

interface MetricSeriesState {
  storageGroup: string
  operation: FileOperationName
  origin: FileOperationOrigin
  buckets: (MetricBucket | undefined)[]
}

interface Accumulator {
  samples: number
  errors: number
  cacheHits: number
  coalesced: number
  readBytes: number
  execSum: number
  waitSum: number
  exec: Uint32Array
  wait: Uint32Array
}

function createAccumulator(): Accumulator {
  return {
    samples: 0,
    errors: 0,
    cacheHits: 0,
    coalesced: 0,
    readBytes: 0,
    execSum: 0,
    waitSum: 0,
    exec: new Uint32Array(HISTOGRAM_LEN),
    wait: new Uint32Array(HISTOGRAM_LEN),
  }
}

function histogramIndex(valueMs: number): number {
  for (let i = 0; i < HISTOGRAM_BOUNDS.length; i += 1) {
    if (valueMs <= HISTOGRAM_BOUNDS[i]!) return i
  }
  return HISTOGRAM_BOUNDS.length
}

function percentileMs(hist: Uint32Array, total: number, ratio: number): number {
  if (total === 0) return 0
  const target = Math.max(1, Math.ceil(total * ratio))
  let cumulative = 0
  for (let i = 0; i < hist.length; i += 1) {
    cumulative += hist[i]!
    if (cumulative >= target) {
      const bound = HISTOGRAM_BOUNDS[i]
      return bound ?? HISTOGRAM_BOUNDS[HISTOGRAM_BOUNDS.length - 1]! * 2
    }
  }
  return HISTOGRAM_BOUNDS[HISTOGRAM_BOUNDS.length - 1]! * 2
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function toCounters(acc: Accumulator): FileOperationCounters {
  return {
    samples: acc.samples,
    errors: acc.errors,
    cacheHits: acc.cacheHits,
    coalesced: acc.coalesced,
    readBytes: acc.readBytes,
    queueWaitMs: {
      meanMs: acc.samples === 0 ? 0 : round3(acc.waitSum / acc.samples),
      p95Ms: percentileMs(acc.wait, acc.samples, 0.95),
    },
    executionMs: {
      meanMs: acc.samples === 0 ? 0 : round3(acc.execSum / acc.samples),
      p95Ms: percentileMs(acc.exec, acc.samples, 0.95),
    },
  }
}

export class MetricsRegistry {
  private readonly series = new Map<string, MetricSeriesState>()

  private seriesFor(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
  ): MetricSeriesState {
    const key = `${storageGroup}\u0000${operation}\u0000${origin}`
    let state = this.series.get(key)
    if (state === undefined) {
      state = {
        storageGroup,
        operation,
        origin,
        buckets: new Array<MetricBucket | undefined>(METRIC_BUCKET_COUNT),
      }
      this.series.set(key, state)
    }
    return state
  }

  private bucketFor(state: MetricSeriesState): MetricBucket {
    const slot = Math.floor(monotonic() / METRIC_BUCKET_MS)
    const index = ((slot % METRIC_BUCKET_COUNT) + METRIC_BUCKET_COUNT) % METRIC_BUCKET_COUNT
    let bucket = state.buckets[index]
    if (bucket === undefined) {
      bucket = {
        slot,
        samples: 0,
        errors: 0,
        cacheHits: 0,
        coalesced: 0,
        readBytes: 0,
        execSum: 0,
        waitSum: 0,
        exec: new Uint32Array(HISTOGRAM_LEN),
        wait: new Uint32Array(HISTOGRAM_LEN),
      }
      state.buckets[index] = bucket
    } else if (bucket.slot !== slot) {
      bucket.slot = slot
      bucket.samples = 0
      bucket.errors = 0
      bucket.cacheHits = 0
      bucket.coalesced = 0
      bucket.readBytes = 0
      bucket.execSum = 0
      bucket.waitSum = 0
      bucket.exec.fill(0)
      bucket.wait.fill(0)
    }
    return bucket
  }

  recordOperation(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
    sample: { waitMs: number; execMs: number; bytes: number; error: boolean },
  ): void {
    const bucket = this.bucketFor(this.seriesFor(storageGroup, operation, origin))
    bucket.samples += 1
    bucket.execSum += sample.execMs
    bucket.waitSum += sample.waitMs
    const execSlot = histogramIndex(sample.execMs)
    const waitSlot = histogramIndex(sample.waitMs)
    bucket.exec[execSlot] = bucket.exec[execSlot]! + 1
    bucket.wait[waitSlot] = bucket.wait[waitSlot]! + 1
    bucket.readBytes += sample.bytes
    if (sample.error) bucket.errors += 1
  }

  recordCacheHit(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
  ): void {
    this.bucketFor(this.seriesFor(storageGroup, operation, origin)).cacheHits += 1
  }

  recordCoalesced(
    storageGroup: string,
    operation: FileOperationName,
    origin: FileOperationOrigin,
  ): void {
    this.bucketFor(this.seriesFor(storageGroup, operation, origin)).coalesced += 1
  }

  snapshot(windowMs: number): {
    overall: FileOperationCounters
    byOrigin: Record<FileOperationOrigin, FileOperationCounters>
    byOperation: Record<FileOperationName, FileOperationCounters>
    series: FileOperationSeries[]
  } {
    const currentSlot = Math.floor(monotonic() / METRIC_BUCKET_MS)
    const oldestSlot = currentSlot - Math.max(1, Math.ceil(windowMs / METRIC_BUCKET_MS)) + 1

    const overall = createAccumulator()
    const byOrigin: Record<FileOperationOrigin, Accumulator> = {
      human: createAccumulator(),
      automatic: createAccumulator(),
    }
    const byOperation = {} as Record<FileOperationName, Accumulator>
    for (const operation of ALL_OPERATIONS) byOperation[operation] = createAccumulator()
    const series: FileOperationSeries[] = []

    for (const state of this.series.values()) {
      const acc = createAccumulator()
      for (const bucket of state.buckets) {
        if (bucket === undefined) continue
        if (bucket.slot < oldestSlot || bucket.slot > currentSlot) continue
        mergeBucket(acc, bucket)
      }
      if (acc.samples === 0 && acc.cacheHits === 0 && acc.coalesced === 0) continue
      mergeAccumulator(overall, acc)
      mergeAccumulator(byOrigin[state.origin], acc)
      mergeAccumulator(byOperation[state.operation], acc)
      series.push({
        storageGroup: state.storageGroup,
        operation: state.operation,
        origin: state.origin,
        ...toCounters(acc),
      })
    }

    series.sort(
      (a, b) =>
        a.storageGroup.localeCompare(b.storageGroup) ||
        a.operation.localeCompare(b.operation) ||
        a.origin.localeCompare(b.origin),
    )

    const operations = {} as Record<FileOperationName, FileOperationCounters>
    for (const operation of ALL_OPERATIONS) {
      operations[operation] = toCounters(byOperation[operation])
    }

    return {
      overall: toCounters(overall),
      byOrigin: {
        human: toCounters(byOrigin.human),
        automatic: toCounters(byOrigin.automatic),
      },
      byOperation: operations,
      series,
    }
  }
}

function mergeBucket(acc: Accumulator, bucket: MetricBucket): void {
  acc.samples += bucket.samples
  acc.errors += bucket.errors
  acc.cacheHits += bucket.cacheHits
  acc.coalesced += bucket.coalesced
  acc.readBytes += bucket.readBytes
  acc.execSum += bucket.execSum
  acc.waitSum += bucket.waitSum
  for (let i = 0; i < HISTOGRAM_LEN; i += 1) {
    acc.exec[i] = acc.exec[i]! + bucket.exec[i]!
    acc.wait[i] = acc.wait[i]! + bucket.wait[i]!
  }
}

function mergeAccumulator(target: Accumulator, source: Accumulator): void {
  target.samples += source.samples
  target.errors += source.errors
  target.cacheHits += source.cacheHits
  target.coalesced += source.coalesced
  target.readBytes += source.readBytes
  target.execSum += source.execSum
  target.waitSum += source.waitSum
  for (let i = 0; i < HISTOGRAM_LEN; i += 1) {
    target.exec[i] = target.exec[i]! + source.exec[i]!
    target.wait[i] = target.wait[i]! + source.wait[i]!
  }
}
