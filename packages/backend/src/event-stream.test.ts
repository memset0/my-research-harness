import { type BackendEventFrame, BackendEventFrameSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import {
  BackendEventStream,
  BackendEventStreamError,
  type BackendEventTimer,
} from './event-stream.js'

const EPOCH = '123e4567-e89b-42d3-a456-426614174000'
const NOW = '2026-08-26T16:30:00.000Z'

interface TimerHandle {
  callback: () => void
  intervalMs: number
  active: boolean
}

class FakeTimer implements BackendEventTimer {
  readonly handles: TimerHandle[] = []
  clearCalls = 0

  setInterval = (callback: () => void, intervalMs: number): TimerHandle => {
    const handle = { callback, intervalMs, active: true }
    this.handles.push(handle)
    return handle
  }

  clearInterval = (handle: unknown): void => {
    const timer = handle as TimerHandle
    if (timer.active) this.clearCalls += 1
    timer.active = false
  }

  tick(): void {
    for (const handle of this.handles) {
      if (handle.active) handle.callback()
    }
  }
}

function parseSse(serialized: string): BackendEventFrame {
  expect(Buffer.byteLength(serialized)).toBeGreaterThan(0)
  expect(serialized.endsWith('\n\n')).toBe(true)
  const dataLine = serialized.split('\n').find((line) => line.startsWith('data: '))
  if (!dataLine) throw new Error('SSE frame has no data line')
  return BackendEventFrameSchema.parse(JSON.parse(dataLine.slice('data: '.length)))
}

function createStream(
  overrides: Partial<ConstructorParameters<typeof BackendEventStream>[0]> = {},
) {
  const timer = new FakeTimer()
  const stream = new BackendEventStream({
    instanceEpoch: EPOCH,
    timer,
    now: () => NOW,
    ...overrides,
  })
  return { stream, timer }
}

describe('BackendEventStream', () => {
  it('emits schema-valid events with one epoch and a monotonic safe sequence', () => {
    const { stream } = createStream()
    const serialized: string[] = []
    const unsubscribe = stream.subscribe((frame) => {
      serialized.push(frame)
      return true
    })

    const first = stream.publish({
      project: 'project-a',
      topic: 'run-change',
      data: { id: 'run-a', type: 'set' },
    })
    const second = stream.publish({
      project: 'project-a',
      topic: 'experiment-change',
      data: { id: 'E0001-demo', type: 'set' },
    })

    expect(first).toMatchObject({ instanceEpoch: EPOCH, sequence: 1 })
    expect(second).toMatchObject({ instanceEpoch: EPOCH, sequence: 2 })
    expect(stream.currentSequence).toBe(2)
    expect(serialized.map(parseSse).map((frame) => frame.sequence)).toEqual([0, 1, 2])
    unsubscribe()
  })

  it('emits injected-interval heartbeats at the current event sequence', () => {
    const { stream, timer } = createStream({ heartbeatIntervalMs: 321 })
    const serialized: string[] = []
    const unsubscribe = stream.subscribe((frame) => {
      serialized.push(frame)
      return true
    })

    expect(timer.handles).toHaveLength(1)
    expect(timer.handles[0]!.intervalMs).toBe(321)
    expect(parseSse(serialized[0]!)).toMatchObject({
      kind: 'heartbeat',
      instanceEpoch: EPOCH,
      sequence: 0,
      emittedAt: NOW,
    })

    stream.publish({ project: 'project-a', topic: 'reports-change', data: {} })
    timer.tick()
    expect(parseSse(serialized.at(-1)!)).toMatchObject({ kind: 'heartbeat', sequence: 1 })
    unsubscribe()
  })

  it.each([
    ['project', { project: 'bad project', topic: 'run-change', data: {} }],
    ['topic', { project: 'project-a', topic: 'unknown-topic', data: {} }],
    ['data', { project: 'project-a', topic: 'run-change', data: [] }],
  ])('rejects an invalid %s event without consuming a sequence', (_field, input) => {
    const { stream } = createStream()
    expect(() => stream.publish(input)).toThrow(BackendEventStreamError)
    expect(stream.currentSequence).toBe(0)
  })

  it('rejects non-serializable and oversized data without consuming a sequence', () => {
    const { stream } = createStream({ maxFrameBytes: 512 })

    expect(() =>
      stream.publish({ project: 'project-a', topic: 'run-change', data: { value: 1n } }),
    ).toThrow(expect.objectContaining({ code: 'SERIALIZATION_FAILED' }))
    expect(() =>
      stream.publish({
        project: 'project-a',
        topic: 'run-change',
        data: { text: 'x'.repeat(2_000) },
      }),
    ).toThrow(expect.objectContaining({ code: 'FRAME_TOO_LARGE' }))
    expect(stream.currentSequence).toBe(0)

    expect(
      stream.publish({ project: 'project-a', topic: 'run-change', data: { id: 'run-a' } }),
    ).toMatchObject({ sequence: 1 })
  })

  it('fails closed before exceeding the safe integer sequence range', () => {
    const { stream } = createStream({ initialSequence: Number.MAX_SAFE_INTEGER })
    expect(() => stream.publish({ project: 'project-a', topic: 'run-change', data: {} })).toThrow(
      expect.objectContaining({ code: 'SEQUENCE_EXHAUSTED' }),
    )
  })

  it('disconnect and close remove subscribers and clear the heartbeat timer', () => {
    const { stream, timer } = createStream()
    const unsubscribe = stream.subscribe(() => true)
    expect(stream.subscriberCount).toBe(1)
    expect(timer.handles[0]!.active).toBe(true)

    unsubscribe()
    expect(stream.subscriberCount).toBe(0)
    expect(timer.handles[0]!.active).toBe(false)
    expect(timer.clearCalls).toBe(1)

    stream.subscribe(() => true)
    stream.close()
    expect(stream.subscriberCount).toBe(0)
    expect(timer.clearCalls).toBe(2)
  })

  it('drops a failed/backpressured subscriber without retaining a timer', () => {
    const { stream, timer } = createStream()
    stream.subscribe(() => false)
    expect(stream.subscriberCount).toBe(0)
    expect(timer.handles[0]!.active).toBe(false)
  })

  it('soaks a long-lived subscriber without retaining an application event queue', () => {
    const { stream, timer } = createStream()
    let delivered = 0
    let lastSequence = 0
    const unsubscribe = stream.subscribe((serialized) => {
      const data = serialized.split('\n').find((line) => line.startsWith('data: '))
      const frame = JSON.parse(data!.slice('data: '.length)) as { sequence: number }
      delivered += 1
      lastSequence = frame.sequence
      return true
    })
    for (let sequence = 1; sequence <= 25_000; sequence += 1) {
      stream.publish({
        project: 'project-a',
        topic: 'run-change',
        data: { id: `run-${sequence}`, type: 'set' },
      })
    }
    expect(delivered).toBe(25_001) // initial heartbeat plus every incremental event
    expect(lastSequence).toBe(25_000)
    expect(stream.subscriberCount).toBe(1)
    expect(timer.handles).toHaveLength(1)
    unsubscribe()
    expect(stream.subscriberCount).toBe(0)
    expect(timer.clearCalls).toBe(1)
  })
})
