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
