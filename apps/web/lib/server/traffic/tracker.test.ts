// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  LATENCY_BOUNDS_MS,
  sanitizeTrafficPath,
  TRAFFIC_PATH_MAX,
  type TrafficSample,
  TrafficTracker,
} from './tracker'

function sample(overrides: Partial<TrafficSample> = {}): TrafficSample {
  return {
    host: 'h1',
    project: 'project-a',
    transport: 'file-agent',
    kind: 'service',
    document: 'report/R0001',
    method: 'GET',
    path: '/index.html',
    status: 200,
    bytes: 1000,
    resolveMs: 3,
    ttfbMs: 40,
    upstreamTtfbMs: 35,
    totalMs: 50,
    reused: true,
    outcome: 'ok',
    ...overrides,
  }
}

describe('sanitizeTrafficPath', () => {
  it('drops the query and bounds the length', () => {
    expect(sanitizeTrafficPath('/static/app.js?token=secret')).toBe('/static/app.js?…')
    expect(sanitizeTrafficPath('/plain')).toBe('/plain')
    const long = sanitizeTrafficPath(`/${'a'.repeat(400)}?x=1`)
    expect(long.length).toBeLessThanOrEqual(TRAFFIC_PATH_MAX + 2)
    expect(long.endsWith('…?…')).toBe(true)
  })
})

describe('TrafficTracker', () => {
  it('keeps a bounded ring, newest first, while aggregates count everything', () => {
    let now = 1_000_000
    const tracker = new TrafficTracker({ ringSize: 10, now: () => now })
    for (let i = 0; i < 25; i++) {
      tracker.record(sample({ path: `/r${i}?k=v` }))
      now += 100
    }
    const records = tracker.records()
    expect(records).toHaveLength(10)
    expect(records[0]!.path).toBe('/r24?…')
    expect(records[9]!.path).toBe('/r15?…')
    expect(records.every((r) => !r.path.includes('k=v'))).toBe(true)
    const [aggregate] = tracker.aggregates(5 * 60_000)
    expect(aggregate).toMatchObject({
      count: 25,
      errors: 0,
      bytes: 25_000,
      transport: 'file-agent',
    })
    expect(aggregate!.ttfbMeanMs).toBe(40)
    expect(aggregate!.ttfbP95Ms).toBe(50)
  })

  it('derives throughput only for large ok bodies and counts slow and failed requests', () => {
    const tracker = new TrafficTracker({ now: () => 5_000_000 })
    tracker.record(sample({ bytes: 1024 * 1024, ttfbMs: 1000, totalMs: 3000 }))
    tracker.record(sample({ bytes: 100, ttfbMs: 10, totalMs: 20 }))
    tracker.record(sample({ status: 503, outcome: 'error', bytes: 0, ttfbMs: null, totalMs: 5 }))
    const [big, small, failed] = tracker.records().reverse()
    expect(big!.throughputBps).toBe(Math.round((1024 * 1024 * 1000) / 2000))
    expect(small!.throughputBps).toBeNull()
    expect(failed!.throughputBps).toBeNull()
    const [aggregate] = tracker.aggregates(60_000)
    expect(aggregate).toMatchObject({ count: 3, errors: 1, slow: 1 })
    expect(aggregate!.throughputBps).toBe(big!.throughputBps)
    expect(tracker.slowest(60_000, 1)[0]!.totalMs).toBe(3000)
  })

  it('separates keys by transport and kind, ages out old minutes and evicts idle keys', () => {
    let now = 10 * 60_000
    const tracker = new TrafficTracker({ maxKeys: 2, now: () => now })
    tracker.record(sample())
    tracker.record(sample({ kind: 'asset' }))
    expect(tracker.aggregates(5 * 60_000).map((a) => a.kind)).toEqual(['asset', 'service'])
    now += 6 * 60_000
    expect(tracker.aggregates(5 * 60_000)).toEqual([])
    expect(tracker.aggregates(15 * 60_000)).toHaveLength(2)
    tracker.record(sample({ project: 'project-b' }))
    const projects = tracker.aggregates(60 * 60_000).map((a) => `${a.project}/${a.kind}`)
    expect(projects).toHaveLength(2)
    expect(projects).toContain('project-b/service')
  })

  it('caps latency histograms with an open last bucket', () => {
    const tracker = new TrafficTracker({ now: () => 0 })
    tracker.record(sample({ totalMs: 10 * LATENCY_BOUNDS_MS.at(-1)!, ttfbMs: 1 }))
    expect(tracker.aggregates(60_000)[0]!.totalP95Ms).toBeGreaterThan(LATENCY_BOUNDS_MS.at(-1)!)
  })

  it('keeps the last probe results and one running probe per key', () => {
    const tracker = new TrafficTracker()
    for (let i = 0; i < 25; i++)
      tracker.addProbe({
        id: String(i),
        host: 'h1',
        project: 'project-a',
        transport: 'native',
        startedAt: i,
        durationMs: 1,
        steps: [],
      })
    expect(tracker.probeResults()).toHaveLength(20)
    expect(tracker.probeResults()[0]!.id).toBe('24')
    expect(tracker.claimProbe('h1/project-a')).toBe(true)
    expect(tracker.claimProbe('h1/project-a')).toBe(false)
    tracker.releaseProbe('h1/project-a')
    expect(tracker.claimProbe('h1/project-a')).toBe(true)
  })

  it('never throws into the request path', () => {
    const tracker = new TrafficTracker()
    expect(() =>
      tracker.record({ ...sample(), path: undefined as unknown as string }),
    ).not.toThrow()
  })
})
