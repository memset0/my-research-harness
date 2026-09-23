import { describe, expect, it } from 'vitest'
import { RunInventory } from './run-inventory.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('RunInventory', () => {
  it('shares one walk between concurrent callers before any inventory exists', async () => {
    const walk = deferred<string[]>()
    let walks = 0
    const inventory = new RunInventory(() => {
      walks += 1
      return walk.promise
    })
    const first = inventory.get('p')
    const second = inventory.get('p')
    walk.resolve(['/r/a'])
    expect(await first).toEqual(['/r/a'])
    expect(await second).toEqual(['/r/a'])
    expect(walks).toBe(1)
  })

  it('serves the cached inventory at once and refreshes it in the background after the refresh age', async () => {
    let now = 0
    const results = [deferred<string[]>(), deferred<string[]>()]
    let walks = 0
    const inventory = new RunInventory(() => results[walks++]!.promise, {
      refreshMs: 100,
      now: () => now,
    })
    const cold = inventory.get('p')
    results[0]!.resolve(['/r/a'])
    await cold

    now = 50
    expect(await inventory.get('p')).toEqual(['/r/a'])
    expect(walks).toBe(1)

    now = 150
    // Stale: answered from the cache while the refresh is still pending.
    expect(await inventory.get('p')).toEqual(['/r/a'])
    expect(await inventory.get('p')).toEqual(['/r/a'])
    expect(walks).toBe(2)
    results[1]!.resolve(['/r/a', '/r/b'])
    await results[1]!.promise
    await Promise.resolve()
    expect(await inventory.get('p')).toEqual(['/r/a', '/r/b'])
  })

  it('keeps the last inventory when a background refresh fails', async () => {
    let now = 0
    let fail = false
    let walks = 0
    const inventory = new RunInventory(
      async () => {
        walks += 1
        if (fail) throw new Error('nfs hiccup')
        return ['/r/a']
      },
      { refreshMs: 10, now: () => now },
    )
    await inventory.get('p')
    fail = true
    now = 20
    expect(await inventory.get('p')).toEqual(['/r/a'])
    await new Promise((resolve) => setImmediate(resolve))
    expect(await inventory.get('p')).toEqual(['/r/a'])
    expect(walks).toBe(3)
  })

  it('rejects waiting callers when the first walk fails and retries on the next call', async () => {
    let walks = 0
    const inventory = new RunInventory(async () => {
      walks += 1
      if (walks === 1) throw new Error('nfs hiccup')
      return ['/r/a']
    })
    await expect(inventory.get('p')).rejects.toThrow('nfs hiccup')
    expect(await inventory.get('p')).toEqual(['/r/a'])
  })

  it('keeps Projects apart', async () => {
    const inventory = new RunInventory(async (project) => [`/${project}/run`])
    expect(await inventory.get('a')).toEqual(['/a/run'])
    expect(await inventory.get('b')).toEqual(['/b/run'])
  })
})
