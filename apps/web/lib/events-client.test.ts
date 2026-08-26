// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetMemonEventsForTests, type MemonEvent, subscribeMemonEvents } from './events-client'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  readonly close = vi.fn()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(topic: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(topic) ?? []
    listeners.push(listener)
    this.listeners.set(topic, listeners)
  }

  emit(topic: string, payload: unknown): void {
    const event = { data: typeof payload === 'string' ? payload : JSON.stringify(payload) }
    for (const listener of this.listeners.get(topic) ?? []) {
      listener(event as MessageEvent)
    }
  }
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('window', {})
  vi.stubGlobal('EventSource', FakeEventSource)
  __resetMemonEventsForTests()
})

afterEach(() => {
  __resetMemonEventsForTests()
  vi.unstubAllGlobals()
})

describe('events-client singleton', () => {
  it('uses one browser EventSource and preserves Host-tagged payloads/resync', () => {
    const first: MemonEvent[] = []
    const second: MemonEvent[] = []
    const unsubscribeFirst = subscribeMemonEvents((event) => first.push(event))
    const unsubscribeSecond = subscribeMemonEvents((event) => second.push(event))

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]!
    expect(source.url).toBe('/api/events')

    source.emit('run-change', {
      topic: 'forged-topic',
      host: 'host-a',
      project: 'project-x',
      type: 'set',
      id: 'run-a',
    })
    source.emit('host-resync', {
      host: 'host-a',
      reason: 'sequence_gap',
      emittedAt: '2026-08-26T17:00:00.000Z',
    })
    source.emit('reports-change', { host: 'host-b', project: 'project-x' })
    source.emit('anomaly', 'not-json')

    expect(first).toEqual([
      {
        topic: 'run-change',
        host: 'host-a',
        project: 'project-x',
        type: 'set',
        id: 'run-a',
      },
      {
        topic: 'host-resync',
        host: 'host-a',
        reason: 'sequence_gap',
        emittedAt: '2026-08-26T17:00:00.000Z',
      },
      { topic: 'reports-change', host: 'host-b', project: 'project-x' },
    ])
    expect(second).toEqual(first)

    unsubscribeFirst()
    expect(source.close).not.toHaveBeenCalled()
    unsubscribeSecond()
    expect(source.close).toHaveBeenCalledTimes(1)
  })
})
