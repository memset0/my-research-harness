import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceBudgetPool, withSourceBudgetTiming } from './budgets.js'
import { DEFAULT_FILE_ACCESS_OPTIONS } from './contract.js'
import { MetricsRegistry } from './metrics.js'
import { budgetedSourceOperation } from './source-budget-runtime.js'

afterEach(() => vi.useRealTimers())
describe('rolling source budget telemetry', () => {
  it('meters raw bounded reads without counting a scheduled adapter operation twice', async () => {
    const metrics = new MetricsRegistry()
    const pool = new SourceBudgetPool(
      () => DEFAULT_FILE_ACCESS_OPTIONS,
      undefined,
      (source, op, automatic, sample) =>
        metrics.recordOperation(source, op, automatic ? 'automatic' : 'human', sample),
    )
    await budgetedSourceOperation(
      'source-a',
      'project-a',
      8,
      async () => Buffer.from('body'),
      () => 4,
      pool,
    )
    expect(metrics.snapshot(60_000).overall).toMatchObject({ samples: 1, readBytes: 4 })
    await withSourceBudgetTiming({ waitMs: 0, automatic: () => false }, () =>
      budgetedSourceOperation(
        'source-a',
        'project-a',
        8,
        async () => Buffer.from('body'),
        () => 4,
        pool,
      ),
    )
    expect(metrics.snapshot(60_000).overall.samples).toBe(1)
    await budgetedSourceOperation(
      'source-a',
      'project-a',
      8,
      async () => ({ outcome: 'unchanged' }),
      () => 8,
      pool,
      'readFile',
      () => 0,
    )
    expect(metrics.snapshot(60_000).overall).toMatchObject({ samples: 2, readBytes: 4 })
  })
  it('counts one deferral per demand and drops it outside the requested window', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const metrics = new MetricsRegistry()
    const pool = new SourceBudgetPool(
      () => ({
        ...DEFAULT_FILE_ACCESS_OPTIONS,
        operationsPerSecond: 1,
        operationBurst: 1,
        bytesPerSecond: 16,
        byteBurst: 16,
        maxReadBytes: 16,
      }),
      (source, op, automatic, kind) =>
        metrics.recordBudgetDeferral(source, op, automatic ? 'automatic' : 'human', kind),
    )
    const finish = await pool.reserve('source-a', 'project-a', 16, false, 'readFile')
    finish(16)
    const pending = pool.reserve('source-a', 'project-b', 16, false, 'readFile')
    expect(metrics.snapshot(60_000).overall).toMatchObject({
      operationBudgetDeferrals: 1,
      byteBudgetDeferrals: 1,
      samples: 0,
    })
    await vi.advanceTimersByTimeAsync(1000)
    ;(await pending)(16)
    expect(metrics.snapshot(60_000).overall.operationBudgetDeferrals).toBe(1)
    await vi.advanceTimersByTimeAsync(65_000)
    expect(metrics.snapshot(60_000).overall.operationBudgetDeferrals).toBe(0)
    expect(metrics.snapshot(300_000).overall.operationBudgetDeferrals).toBe(1)
  })
})

describe('per-group timeline and recent operations', () => {
  it('buckets operations per storage group and keeps a bounded recent log', () => {
    const metrics = new MetricsRegistry()
    const sample = { waitMs: 1, execMs: 40, bytes: 0, error: false }
    metrics.recordOperation('source-a', 'stat', 'human', sample)
    metrics.recordOperation('source-a', 'stat', 'human', sample)
    metrics.recordOperation('source-b', 'readFile', 'automatic', { ...sample, error: true })
    metrics.recordCacheHit('source-b', 'readFile', 'human')
    const snapshot = metrics.snapshot(60_000)
    expect(snapshot.timeline.map((timeline) => timeline.storageGroup)).toEqual([
      'source-a',
      'source-b',
    ])
    const [a, b] = snapshot.timeline
    expect(a!.points).toHaveLength(12)
    expect(a!.points.reduce((sum, point) => sum + point.samples, 0)).toBe(2)
    expect(b!.points.at(-1)).toMatchObject({ samples: 1, errors: 1, cacheHits: 1 })
    expect(snapshot.recent.map((entry) => [entry.storageGroup, entry.executionMs])).toEqual([
      ['source-a', 40],
      ['source-a', 40],
      ['source-b', 40],
    ])
    for (let index = 0; index < 400; index += 1)
      metrics.recordOperation('source-a', 'stat', 'human', sample)
    expect(metrics.snapshot(60_000).recent).toHaveLength(300)
  })
})
