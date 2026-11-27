// Bounded in-memory measurements of forwarded service and content-asset
// requests, plus the latest network probe results (openspec traffic-tracking).
//
// The content gateway is loaded by the custom Node entry (tsx) while the
// /api/traffic routes are bundled by Next, so the one tracker instance lives
// on a `globalThis` slot. Nothing here touches the filesystem and nothing is
// persisted: a restart starts empty. Recording never throws into a request.
//
// This module is in the custom entry's import graph, so it must not import
// `server-only` (see lib/server/layering.test.ts).

/** `sshfs` marks content assets read through an SSHFS mount (no tunnel). */
export type TrafficTransport = 'native' | 'ssh-tunnel' | 'file-agent' | 'sshfs'
export type TrafficKind = 'service' | 'websocket' | 'asset'
export type TrafficOutcome = 'ok' | 'error' | 'aborted'

export interface TrafficSample {
  host: string
  project: string
  transport: TrafficTransport
  kind: TrafficKind
  /** `report/R0001` or `wiki/W0001`. */
  document: string
  method: string
  /** Raw request path (may carry a query); sanitized on record. */
  path: string
  status: number | null
  bytes: number
  /** Bytes sent browser → upstream (WebSocket sessions). */
  bytesUp?: number
  /** WebSocket session length; `totalMs` then holds the upgrade setup time. */
  sessionMs?: number
  /** Arrival → target chosen (auth, manifest read, tunnel readiness). */
  resolveMs: number | null
  /** Arrival → upstream (or handler) response headers. */
  ttfbMs: number | null
  /** Upstream request dispatched → response headers. */
  upstreamTtfbMs: number | null
  totalMs: number
  /** Upstream request rode an already-open keep-alive connection. */
  reused: boolean | null
  outcome: TrafficOutcome
  /** Epoch ms of arrival; defaults to now − totalMs. */
  startedAt?: number
}

export interface TrafficRecord extends Omit<TrafficSample, 'startedAt' | 'bytesUp' | 'sessionMs'> {
  /** Monotonic per process; a stable row key. */
  seq: number
  startedAt: number
  bytesUp: number
  sessionMs: number | null
  /** Bytes per second over the transfer phase, only for bodies ≥ THROUGHPUT_MIN_BYTES. */
  throughputBps: number | null
}

export const TRAFFIC_RING_SIZE = 1000
export const TRAFFIC_MAX_KEYS = 128
export const TRAFFIC_BUCKET_MS = 60_000
export const TRAFFIC_BUCKETS = 60
export const TRAFFIC_PATH_MAX = 160
export const THROUGHPUT_MIN_BYTES = 32 * 1024
export const SLOW_REQUEST_MS = 2_000
export const TRAFFIC_PROBE_RESULTS = 20
export const TRAFFIC_WINDOWS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000] as const

/** Upper bounds (ms) of the latency histogram; the last bucket is open. */
export const LATENCY_BOUNDS_MS = [
  5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000,
] as const

/** Drop the query (it may carry tokens or application secrets) and bound the length. */
export function sanitizeTrafficPath(raw: string): string {
  const query = raw.indexOf('?')
  let path = query >= 0 ? raw.slice(0, query) : raw
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > TRAFFIC_PATH_MAX) path = `${path.slice(0, TRAFFIC_PATH_MAX - 1)}…`
  return query >= 0 ? `${path}?…` : path
}

function histogramIndex(ms: number): number {
  const index = LATENCY_BOUNDS_MS.findIndex((bound) => ms <= bound)
  return index === -1 ? LATENCY_BOUNDS_MS.length : index
}

interface Bucket {
  minute: number
  count: number
  errors: number
  slow: number
  bytes: number
  ttfbSum: number
  ttfbCount: number
  totalSum: number
  transferBytes: number
  transferMs: number
  ttfbHist: number[]
  totalHist: number[]
}

function emptyBucket(minute: number): Bucket {
  return {
    minute,
    count: 0,
    errors: 0,
    slow: 0,
    bytes: 0,
    ttfbSum: 0,
    ttfbCount: 0,
    totalSum: 0,
    transferBytes: 0,
    transferMs: 0,
    ttfbHist: new Array(LATENCY_BOUNDS_MS.length + 1).fill(0),
    totalHist: new Array(LATENCY_BOUNDS_MS.length + 1).fill(0),
  }
}

interface KeyState {
  host: string
  project: string
  transport: TrafficTransport
  kind: TrafficKind
  updatedAt: number
  /** Ring indexed by minute % TRAFFIC_BUCKETS. */
  buckets: Array<Bucket | undefined>
  lastDocument: string
}

export interface TrafficAggregate {
  host: string
  project: string
  transport: TrafficTransport
  kind: TrafficKind
  count: number
  errors: number
  slow: number
  bytes: number
  ttfbMeanMs: number | null
  ttfbP95Ms: number | null
  totalMeanMs: number | null
  totalP95Ms: number | null
  throughputBps: number | null
  lastDocument: string
  lastSeenAt: number
}

/** A step of a probe: one measured quantity, or a stated reason it is unavailable. */
export interface ProbeStep {
  label: string
  ok: boolean
  /** Summary values in ms (latency) or bytes per second (throughput). */
  setupMs?: number | null
  medianMs?: number | null
  minMs?: number | null
  maxMs?: number | null
  samples?: number
  ttfbMs?: number | null
  bytes?: number
  throughputBps?: number | null
  status?: number | null
  note?: string
}

export interface ProbeResult {
  id: string
  host: string
  project: string
  transport: TrafficTransport | 'unsupported'
  startedAt: number
  durationMs: number
  target?: string
  steps: ProbeStep[]
}

function quantile(hist: number[], q: number): number | null {
  const total = hist.reduce((sum, n) => sum + n, 0)
  if (total === 0) return null
  const rank = Math.ceil(total * q)
  let seen = 0
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i] ?? 0
    if (seen >= rank) return LATENCY_BOUNDS_MS[i] ?? LATENCY_BOUNDS_MS.at(-1)! * 2
  }
  return null
}

export class TrafficTracker {
  private readonly ring: Array<TrafficRecord | undefined>
  private next = 0
  private size = 0
  private seq = 0
  private readonly keys = new Map<string, KeyState>()
  private probes: ProbeResult[] = []
  private readonly running = new Set<string>()

  constructor(
    private readonly options: { ringSize?: number; maxKeys?: number; now?: () => number } = {},
  ) {
    this.ring = new Array(options.ringSize ?? TRAFFIC_RING_SIZE)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  record(sample: TrafficSample): void {
    try {
      this.recordUnsafe(sample)
    } catch {
      /* Telemetry never changes a request's result. */
    }
  }

  private recordUnsafe(sample: TrafficSample): void {
    const now = this.now()
    const ttfb = sample.ttfbMs
    const transferMs = ttfb === null ? null : Math.max(sample.totalMs - ttfb, 1)
    const throughputBps =
      sample.kind !== 'websocket' &&
      sample.outcome === 'ok' &&
      sample.bytes >= THROUGHPUT_MIN_BYTES &&
      transferMs !== null
        ? Math.round((sample.bytes * 1000) / transferMs)
        : null
    const { bytesUp, startedAt, sessionMs, ...rest } = sample
    const record: TrafficRecord = {
      ...rest,
      seq: ++this.seq,
      path: sanitizeTrafficPath(sample.path),
      method: sample.method.slice(0, 10),
      bytesUp: bytesUp ?? 0,
      sessionMs: sessionMs ?? null,
      startedAt: startedAt ?? now - (sessionMs ?? sample.totalMs),
      throughputBps,
    }
    this.ring[this.next] = record
    this.next = (this.next + 1) % this.ring.length
    this.size = Math.min(this.size + 1, this.ring.length)

    const key = [sample.host, sample.project, sample.transport, sample.kind].join('\u0000')
    let state = this.keys.get(key)
    if (!state) {
      const max = this.options.maxKeys ?? TRAFFIC_MAX_KEYS
      if (this.keys.size >= max) {
        let oldest: string | null = null
        let oldestAt = Number.POSITIVE_INFINITY
        for (const [candidate, value] of this.keys)
          if (value.updatedAt < oldestAt) {
            oldest = candidate
            oldestAt = value.updatedAt
          }
        if (oldest !== null) this.keys.delete(oldest)
      }
      state = {
        host: sample.host,
        project: sample.project,
        transport: sample.transport,
        kind: sample.kind,
        updatedAt: now,
        buckets: new Array(TRAFFIC_BUCKETS),
        lastDocument: sample.document,
      }
      this.keys.set(key, state)
    }
    state.updatedAt = now
    state.lastDocument = sample.document
    const minute = Math.floor(now / TRAFFIC_BUCKET_MS)
    const slot = minute % TRAFFIC_BUCKETS
    let bucket = state.buckets[slot]
    if (!bucket || bucket.minute !== minute) {
      bucket = emptyBucket(minute)
      state.buckets[slot] = bucket
    }
    bucket.count++
    if (sample.outcome !== 'ok' || (sample.status !== null && sample.status >= 500)) bucket.errors++
    if (sample.totalMs >= SLOW_REQUEST_MS) bucket.slow++
    bucket.bytes += sample.bytes
    bucket.totalSum += sample.totalMs
    bucket.totalHist[histogramIndex(sample.totalMs)]!++
    if (ttfb !== null) {
      bucket.ttfbSum += ttfb
      bucket.ttfbCount++
      bucket.ttfbHist[histogramIndex(ttfb)]!++
    }
    if (throughputBps !== null && transferMs !== null) {
      bucket.transferBytes += sample.bytes
      bucket.transferMs += transferMs
    }
  }

  /** Newest first. */
  records(): TrafficRecord[] {
    const out: TrafficRecord[] = []
    for (let i = 1; i <= this.size; i++) {
      const record = this.ring[(this.next - i + this.ring.length) % this.ring.length]
      if (record) out.push(record)
    }
    return out
  }

  aggregates(windowMs: number): TrafficAggregate[] {
    const now = this.now()
    const firstMinute = Math.floor((now - windowMs) / TRAFFIC_BUCKET_MS) + 1
    const result: TrafficAggregate[] = []
    for (const state of this.keys.values()) {
      const merged = emptyBucket(0)
      for (const bucket of state.buckets) {
        if (!bucket || bucket.minute < firstMinute) continue
        merged.count += bucket.count
        merged.errors += bucket.errors
        merged.slow += bucket.slow
        merged.bytes += bucket.bytes
        merged.ttfbSum += bucket.ttfbSum
        merged.ttfbCount += bucket.ttfbCount
        merged.totalSum += bucket.totalSum
        merged.transferBytes += bucket.transferBytes
        merged.transferMs += bucket.transferMs
        bucket.ttfbHist.forEach((n, i) => {
          merged.ttfbHist[i]! += n
        })
        bucket.totalHist.forEach((n, i) => {
          merged.totalHist[i]! += n
        })
      }
      if (merged.count === 0) continue
      result.push({
        host: state.host,
        project: state.project,
        transport: state.transport,
        kind: state.kind,
        count: merged.count,
        errors: merged.errors,
        slow: merged.slow,
        bytes: merged.bytes,
        ttfbMeanMs: merged.ttfbCount ? merged.ttfbSum / merged.ttfbCount : null,
        ttfbP95Ms: quantile(merged.ttfbHist, 0.95),
        totalMeanMs: merged.totalSum / merged.count,
        totalP95Ms: quantile(merged.totalHist, 0.95),
        throughputBps:
          merged.transferMs > 0
            ? Math.round((merged.transferBytes * 1000) / merged.transferMs)
            : null,
        lastDocument: state.lastDocument,
        lastSeenAt: state.updatedAt,
      })
    }
    return result.sort(
      (a, b) =>
        a.host.localeCompare(b.host) ||
        a.project.localeCompare(b.project) ||
        a.kind.localeCompare(b.kind),
    )
  }

  /** Slowest requests that started inside the window, slowest first. */
  slowest(windowMs: number, limit: number): TrafficRecord[] {
    const since = this.now() - windowMs
    return this.records()
      .filter((record) => record.startedAt >= since)
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, limit)
  }

  addProbe(result: ProbeResult): void {
    this.probes = [result, ...this.probes].slice(0, TRAFFIC_PROBE_RESULTS)
  }

  probeResults(): ProbeResult[] {
    return [...this.probes]
  }

  /** Claim the one probe slot of `key`; false while another probe of it runs. */
  claimProbe(key: string): boolean {
    if (this.running.has(key)) return false
    this.running.add(key)
    return true
  }

  releaseProbe(key: string): void {
    this.running.delete(key)
  }
}

const TRACKER_KEY = Symbol.for('memon.traffic-tracker.v1')

export function trafficTracker(): TrafficTracker {
  const host = globalThis as unknown as Record<symbol, TrafficTracker | undefined>
  host[TRACKER_KEY] ??= new TrafficTracker()
  return host[TRACKER_KEY]
}
