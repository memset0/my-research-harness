// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { AgentReadHandle } from './agent-handle.js'

vi.mock('./store-access.js', () => ({
  storeAccess: () => ({ effectiveOptions: () => ({ byteBurst: 64 * 1024 * 1024 }) }),
}))

describe('agent read handle streams', () => {
  it('reads one-megabyte ranges and requests the next before the consumer asks', async () => {
    const source = Buffer.alloc(2.5 * 1024 * 1024, 7)
    const calls: Array<[number, number]> = []
    let inFlight = 0
    let maxInFlight = 0
    const handle = new AgentReadHandle(
      async (offset, length) => {
        calls.push([offset, length])
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        return source.subarray(offset, offset + length)
      },
      async () => {},
      { size: source.length, mtimeMs: 0, mode: 0o100644 },
    )
    const chunks: Buffer[] = []
    for await (const chunk of handle.createReadStream({ highWaterMark: 64 * 1024 })) {
      chunks.push(chunk as Buffer)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(Buffer.concat(chunks).equals(source)).toBe(true)
    expect(calls.slice(0, 3)).toEqual([
      [0, 1024 * 1024],
      [1024 * 1024, 1024 * 1024],
      [2 * 1024 * 1024, 1024 * 1024],
    ])
    expect(maxInFlight).toBe(1)
  })

  it('stops at an explicit end without reading past it', async () => {
    const calls: Array<[number, number]> = []
    const handle = new AgentReadHandle(
      async (offset, length) => {
        calls.push([offset, length])
        return Buffer.alloc(length, 1)
      },
      async () => {},
      { size: 100, mtimeMs: 0, mode: 0o100644 },
    )
    const chunks: Buffer[] = []
    for await (const chunk of handle.createReadStream({ start: 10, end: 19 }))
      chunks.push(chunk as Buffer)
    expect(Buffer.concat(chunks).length).toBe(10)
    expect(calls).toEqual([[10, 10]])
  })
})
