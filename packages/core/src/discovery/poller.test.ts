import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Poller } from './poller.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-poller-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('Poller', () => {
  it('invokes callback when mtime changes and resets backoff to min', async () => {
    const target = join(dir, 't.txt')
    await fs.writeFile(target, 'hello')

    const opts = { minIntervalMs: 20, maxIntervalMs: 200, backoffFactor: 2 }

    // Capture interval inside the callback — at that point the reset to
    // minIntervalMs has already happened but no further ticks have fired.
    let observedInsideCallback: number | null = null
    let poller!: Poller
    const sawChange = new Promise<void>((resolve) => {
      poller = new Poller(opts, (path) => {
        observedInsideCallback = poller.intervalFor(path) ?? null
        resolve()
      })
    })

    poller.watch(target, (await fs.stat(target)).mtimeMs)

    // Let it back off at least once
    await sleep(80)
    await fs.utimes(target, new Date(), new Date(Date.now() + 1000))

    await sawChange
    expect(observedInsideCallback).toBe(opts.minIntervalMs)

    poller.stop()
  })

  it('backs off when no change detected', async () => {
    const target = join(dir, 't.txt')
    await fs.writeFile(target, 'hello')

    const poller = new Poller({ minIntervalMs: 10, maxIntervalMs: 80, backoffFactor: 2 }, () => {
      // no-op — we never call it because mtime never changes
    })
    poller.watch(target, (await fs.stat(target)).mtimeMs)

    // Let several ticks happen (10, 20, 40, 80, 80, 80...)
    await sleep(250)
    expect(poller.intervalFor(target)).toBe(80)

    poller.stop()
  })

  it('resetBackoff drops interval back to min and triggers immediate tick', async () => {
    const target = join(dir, 't.txt')
    await fs.writeFile(target, 'hello')

    const poller = new Poller({ minIntervalMs: 10, maxIntervalMs: 200, backoffFactor: 4 }, () => {})
    poller.watch(target, (await fs.stat(target)).mtimeMs)
    // Allow one or two ticks to back off
    await sleep(80)
    expect(poller.intervalFor(target)!).toBeGreaterThan(10)

    poller.resetBackoff(target)
    // After reset, interval should be min
    expect(poller.intervalFor(target)).toBe(10)

    poller.stop()
  })

  it('unwatch stops further ticks', async () => {
    const target = join(dir, 't.txt')
    await fs.writeFile(target, 'hello')
    const poller = new Poller({ minIntervalMs: 10, maxIntervalMs: 50, backoffFactor: 2 }, () => {})
    poller.watch(target)
    expect(poller.watchedCount()).toBe(1)
    poller.unwatch(target)
    expect(poller.watchedCount()).toBe(0)
    poller.stop()
  })
})
