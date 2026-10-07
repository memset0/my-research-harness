import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceBudgetPool, withSourceBudgetTiming } from './budgets.js'
import { DEFAULT_FILE_ACCESS_OPTIONS } from './contract.js'

const options = {
  ...DEFAULT_FILE_ACCESS_OPTIONS,
  operationBurst: 1,
  operationsPerSecond: 2,
  byteBurst: 16,
  bytesPerSecond: 16,
  maxReadBytes: 16,
}
afterEach(() => vi.useRealTimers())
describe('independent source admission budgets', () => {
  it('respects operation refill and does not refund failed-operation credits', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const budgets = new SourceBudgetPool(() => options)
    const finish = await budgets.reserve('source-a', 'project-a', 0, false)
    finish(0)
    const admitted = vi.fn()
    const queued = budgets.reserve('source-a', 'project-a', 0, false).then(admitted)
    await vi.advanceTimersByTimeAsync(499)
    expect(admitted).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await queued
    expect(admitted).toHaveBeenCalledTimes(1)
  })
  it('bounds unknown-size admission and lets another source proceed', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const budgets = new SourceBudgetPool(() => ({ ...options, operationBurst: 10 }))
    const finish = await budgets.reserve('source-a', 'project-a', 16, false)
    const admitted = vi.fn()
    const queued = budgets.reserve('source-a', 'project-b', 8, false).then(admitted)
    expect(await budgets.reserve('source-b', 'project-a', 16, false)).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(499)
    expect(admitted).not.toHaveBeenCalled()
    finish(8)
    await queued
    expect(admitted).toHaveBeenCalledTimes(1)
    await expect(budgets.reserve('source-a', 'project-a', 17, false)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })
  it('rotates projects behind a busy project and preserves foreground capacity', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] })
    const budgets = new SourceBudgetPool(() => options)
    await budgets.reserve('source-a', 'project-a', 0, false)
    const order: string[] = []
    const a = budgets.reserve('source-a', 'project-a', 0, false).then(() => {
      order.push('project-a')
    })
    const b = budgets.reserve('source-a', 'project-b', 0, true).then(() => {
      order.push('project-b')
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(order).toEqual(['project-b'])
    await vi.advanceTimersByTimeAsync(500)
    await Promise.all([a, b])
    expect(order).toEqual(['project-b', 'project-a'])
  })
  it('promotes pending automatic budget demand without spending a second operation credit', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const budgets = new SourceBudgetPool(() => ({
      ...options,
      operationBurst: 10,
      operationsPerSecond: 1,
      backgroundShare: 0.1,
    }))
    const finish = await budgets.reserve('source-a', 'project-a', 0, true)
    finish(0)
    let automatic = true
    const admitted = vi.fn()
    const pending = budgets.reserve('source-a', 'project-b', 0, () => automatic).then(admitted)
    await vi.advanceTimersByTimeAsync(1000)
    expect(admitted).not.toHaveBeenCalled()
    automatic = false
    budgets.refresh('source-a')
    await pending
    expect(admitted).toHaveBeenCalledTimes(1)
  })
  it('measures nested adapter budget waiting separately from work after admission', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
    const budgets = new SourceBudgetPool(() => options)
    const finish = await budgets.reserve('source-a', 'project-a', 0, false)
    finish(0)
    const timing = { waitMs: 0, automatic: () => false }
    const work = withSourceBudgetTiming(timing, async () => {
      const complete = await budgets.reserve('source-a', 'project-b', 0, false)
      complete(0)
    })
    await vi.advanceTimersByTimeAsync(500)
    await work
    expect(timing.waitMs).toBe(500)
  })
  it('supports independent explicitly unlimited rates without weakening concurrency', async () => {
    const budgets = new SourceBudgetPool(() => ({
      ...options,
      operationsPerSecond: 0,
      bytesPerSecond: 0,
      concurrency: 1,
    }))
    const finish = await budgets.reserve('source-a', 'project-a', 16, true)
    const admitted = vi.fn()
    const pending = budgets.reserve('source-a', 'project-b', 16, false).then(admitted)
    await Promise.resolve()
    expect(admitted).not.toHaveBeenCalled()
    finish(16)
    await pending
    expect(admitted).toHaveBeenCalledTimes(1)
  })
})
