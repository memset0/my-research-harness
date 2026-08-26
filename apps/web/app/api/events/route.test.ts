// @vitest-environment node

import { EventEmitter } from 'node:events'
import { CentralEventSchema, ProjectRefSchema } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { createEventsReadableStream } from './route'

async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const next = await reader.read()
  if (next.done) throw new Error('SSE stream ended unexpectedly')
  const text = new TextDecoder().decode(next.value)
  const event = /^event: ([^\n]+)$/m.exec(text)?.[1]
  const rawData = /^data: (.*)$/m.exec(text)?.[1]
  if (!event || rawData === undefined) throw new Error('invalid SSE test frame')
  return { event, data: JSON.parse(rawData) as Record<string, unknown> }
}

describe('events route stream', () => {
  it('uses one central bus listener and sends Host-tagged topics plus Host resync to owners', async () => {
    const events = new EventEmitter()
    const stream = createEventsReadableStream({
      events,
      central: true,
      role: 'owner',
      scopeProjects: new Set(),
    })
    const reader = stream.getReader()
    expect(events.listenerCount('central-event')).toBe(1)
    expect((await readSse(reader)).event).toBe('ready')

    events.emit(
      'central-event',
      CentralEventSchema.parse({
        kind: 'event',
        host: 'host-a',
        project: 'project-x',
        instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
        sequence: 1,
        emittedAt: '2026-08-26T17:00:00.000Z',
        topic: 'run-change',
        data: { type: 'set', id: 'run-a', host: 'forged-host' },
      }),
    )
    expect(await readSse(reader)).toEqual({
      event: 'run-change',
      data: { type: 'set', id: 'run-a', host: 'host-a', project: 'project-x' },
    })

    events.emit(
      'central-event',
      CentralEventSchema.parse({
        kind: 'event',
        host: 'host-b',
        project: 'project-x',
        instanceEpoch: '123e4567-e89b-42d3-a456-426614174001',
        sequence: 1,
        emittedAt: '2026-08-26T17:00:00.000Z',
        topic: 'run-change',
        data: { type: 'set', id: 'run-b' },
      }),
    )
    expect(await readSse(reader)).toMatchObject({
      event: 'run-change',
      data: { host: 'host-b', project: 'project-x', id: 'run-b' },
    })

    events.emit(
      'central-event',
      CentralEventSchema.parse({
        kind: 'host-resync',
        host: 'host-a',
        reason: 'sequence_gap',
        emittedAt: '2026-08-26T17:00:01.000Z',
      }),
    )
    expect(await readSse(reader)).toEqual({
      event: 'host-resync',
      data: {
        host: 'host-a',
        reason: 'sequence_gap',
        emittedAt: '2026-08-26T17:00:01.000Z',
      },
    })

    await reader.cancel()
    expect(events.listenerCount('central-event')).toBe(0)
  })

  it('filters central viewers by exact Host and Project rather than Project name', async () => {
    const events = new EventEmitter()
    const stream = createEventsReadableStream({
      events,
      central: true,
      role: 'viewer',
      scopeProjects: new Set(['project-x']),
      scopeProjectRefs: [ProjectRefSchema.parse({ host: 'host-a', project: 'project-x' })],
    })
    const reader = stream.getReader()
    expect((await readSse(reader)).event).toBe('ready')
    expect(events.listenerCount('central-event')).toBe(1)
    const eventBase = {
      kind: 'event' as const,
      project: 'project-x',
      instanceEpoch: '123e4567-e89b-42d3-a456-426614174000',
      sequence: 1,
      emittedAt: '2026-08-26T17:00:00.000Z',
      topic: 'run-change' as const,
      data: { type: 'set', id: 'run-a' },
    }
    events.emit('central-event', CentralEventSchema.parse({ ...eventBase, host: 'host-b' }))
    events.emit('central-event', CentralEventSchema.parse({ ...eventBase, host: 'host-a' }))
    expect(await readSse(reader)).toMatchObject({
      event: 'run-change',
      data: { host: 'host-a', project: 'project-x' },
    })
    await reader.cancel()
  })

  it('preserves standalone viewer filtering and listener cleanup', async () => {
    const events = new EventEmitter()
    const stream = createEventsReadableStream({
      events,
      central: false,
      role: 'viewer',
      scopeProjects: new Set(['project-a']),
    })
    const reader = stream.getReader()
    expect((await readSse(reader)).event).toBe('ready')
    expect(events.listenerCount('anomaly')).toBe(1)

    events.emit('anomaly', { project: 'project-b', count: 9 })
    events.emit('anomaly', { project: 'project-a', count: 1 })
    expect(await readSse(reader)).toEqual({
      event: 'anomaly',
      data: { project: 'project-a', count: 1 },
    })

    await reader.cancel()
    expect(events.listenerCount('anomaly')).toBe(0)
    expect(events.listenerCount('run-change')).toBe(0)
  })
})
