// @vitest-environment node

import {
  type BackendEventFrame,
  BackendEventSchema,
  type BackendEventTopic,
  type CentralEvent,
  CentralEventSchema,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import type { BackendUpstream } from './backend-client'
import {
  BACKEND_EVENTS_PATH,
  BackendEventClient,
  BoundedBackendSseParser,
  CentralEventFanIn,
} from './backend-events'
import type { BackendFetch } from './backend-url'

const EPOCH_A = '123e4567-e89b-42d3-a456-426614174000'
const EPOCH_B = '123e4567-e89b-42d3-a456-426614174001'
const EMITTED_AT = '2026-08-26T17:00:00.000Z'
const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function upstream(hostId: string): BackendUpstream {
  return {
    hostId,
    transport: 'ssh',
    baseUrl: 'http://127.0.0.1:4738',
    serviceToken: TOKEN,
  }
}

function heartbeat(instanceEpoch: string, sequence: number): BackendEventFrame {
  return BackendEventSchema.parse({
    kind: 'heartbeat',
    instanceEpoch,
    sequence,
    emittedAt: EMITTED_AT,
  })
}

function projectEvent(
  instanceEpoch: string,
  sequence: number,
  project = 'project-x',
  topic: BackendEventTopic = 'run-change',
): BackendEventFrame {
  return BackendEventSchema.parse({
    kind: 'event',
    instanceEpoch,
    sequence,
    emittedAt: EMITTED_AT,
    project,
    topic,
    data: { id: `run-${sequence}`, type: 'set' },
  })
}

function sse(frame: BackendEventFrame, newline = '\n'): string {
  return `event: ${frame.kind}${newline}id: ${frame.instanceEpoch}:${frame.sequence}${newline}data: ${JSON.stringify(frame)}${newline}${newline}`
}

interface ControlledResponse {
  response: Response
  cancel: ReturnType<typeof vi.fn>
}

function eventResponse(frames: BackendEventFrame[], keepOpen = false): ControlledResponse {
  const cancel = vi.fn()
  const bytes = new TextEncoder().encode(frames.map((frame) => sse(frame)).join(''))
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      if (!keepOpen) controller.close()
    },
    cancel() {
      cancel()
    },
  })
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }),
    cancel,
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  throw new Error('condition did not become true')
}

function waitForAbort(_delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

describe('BoundedBackendSseParser', () => {
  it('incrementally parses heartbeat/event frames across UTF-8 chunk boundaries', () => {
    const parser = new BoundedBackendSseParser()
    const text = `: proxy heartbeat\r\n\r\n${sse(heartbeat(EPOCH_A, 0), '\r\n')}${sse(
      projectEvent(EPOCH_A, 1),
    )}`
    const bytes = new TextEncoder().encode(text)
    const split = Math.floor(bytes.length / 2)

    const frames = [
      ...parser.push(bytes.slice(0, split)),
      ...parser.push(bytes.slice(split)),
      ...parser.finish(),
    ]
    expect(frames).toEqual([heartbeat(EPOCH_A, 0), projectEvent(EPOCH_A, 1)])
  })

  it('rejects oversized, malformed, and schema-invalid frames without buffering onward', () => {
    expect(() =>
      new BoundedBackendSseParser(128).push(new TextEncoder().encode(`data: ${'x'.repeat(200)}`)),
    ).toThrow(/size limit/)

    expect(() =>
      new BoundedBackendSseParser().push(new TextEncoder().encode('data: not-json\n\n')),
    ).toThrow(/valid JSON/)

    expect(() =>
      new BoundedBackendSseParser().push(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ ...projectEvent(EPOCH_A, 1), project: 'bad project' })}\n\n`,
        ),
      ),
    ).toThrow(/runtime validation/)
  })

  it('rejects a truncated final frame', () => {
    const parser = new BoundedBackendSseParser()
    parser.push(new TextEncoder().encode(`data: ${JSON.stringify(heartbeat(EPOCH_A, 0))}`))
    expect(() => parser.finish()).toThrow(/truncated/)
  })
})

describe('BackendEventClient', () => {
  it('attaches the exact Host to journal invalidations from one Backend', async () => {
    const controlled = eventResponse(
      [heartbeat(EPOCH_A, 0), projectEvent(EPOCH_A, 1, 'project-x', 'journal-change')],
      true,
    )
    const events: CentralEvent[] = []
    const client = new BackendEventClient({
      upstream: upstream('host-a'),
      sink: (event) => {
        events.push(CentralEventSchema.parse(event))
      },
      fetchImpl: vi.fn(async () => controlled.response),
      retryWait: waitForAbort,
    })

    client.start()
    await waitFor(() => events.length === 1)
    expect(events[0]).toMatchObject({
      kind: 'event',
      host: 'host-a',
      project: 'project-x',
      topic: 'journal-change',
    })
    await client.stop()
  })

  it('uses authenticated upstream policies and aborts/cancels on stop', async () => {
    const controlled = eventResponse([heartbeat(EPOCH_A, 0), projectEvent(EPOCH_A, 1)], true)
    const fetchImpl = vi.fn<BackendFetch>(async () => controlled.response)
    const sink = vi.fn<(event: CentralEvent) => void>()
    const client = new BackendEventClient({
      upstream: upstream('host-a'),
      sink,
      fetchImpl,
      retryWait: waitForAbort,
      now: () => EMITTED_AT,
    })

    client.start()
    await waitFor(() => sink.mock.calls.length === 1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(`http://127.0.0.1:4738${BACKEND_EVENTS_PATH}`)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'manual' })
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(headers.get('x-memon-actor-context')).toBeTruthy()
    expect(String(url)).not.toContain(TOKEN)

    await client.stop()
    expect(controlled.cancel).toHaveBeenCalledTimes(1)
    expect((init?.signal as AbortSignal).aborted).toBe(true)
  })

  it('accepts the first connection without resync and resyncs before reconnect events', async () => {
    const first = eventResponse([heartbeat(EPOCH_A, 0), projectEvent(EPOCH_A, 1)])
    const second = eventResponse([heartbeat(EPOCH_A, 1), projectEvent(EPOCH_A, 2)], true)
    const responses = [first.response, second.response]
    const events: CentralEvent[] = []
    const client = new BackendEventClient({
      upstream: upstream('host-a'),
      sink: (event) => {
        events.push(CentralEventSchema.parse(event))
      },
      fetchImpl: vi.fn(async () => responses.shift() ?? second.response),
      retryWait: async () => {},
      now: () => EMITTED_AT,
    })

    client.start()
    await waitFor(() => events.length === 3)
    expect(events.map((event) => event.kind)).toEqual(['event', 'host-resync', 'event'])
    expect(events[0]).toMatchObject({ host: 'host-a', project: 'project-x', sequence: 1 })
    expect(events[1]).toMatchObject({ host: 'host-a', reason: 'reconnect' })
    expect(events[2]).toMatchObject({ host: 'host-a', project: 'project-x', sequence: 2 })
    await client.stop()
  })

  it('emits epoch-change and sequence-gap resync before later incremental events', async () => {
    const controlled = eventResponse(
      [
        heartbeat(EPOCH_A, 0),
        projectEvent(EPOCH_A, 1),
        heartbeat(EPOCH_B, 0),
        projectEvent(EPOCH_B, 1),
        projectEvent(EPOCH_B, 3),
      ],
      true,
    )
    const events: CentralEvent[] = []
    const client = new BackendEventClient({
      upstream: upstream('host-a'),
      sink: (event) => {
        events.push(CentralEventSchema.parse(event))
      },
      fetchImpl: vi.fn(async () => controlled.response),
      retryWait: waitForAbort,
      now: () => EMITTED_AT,
    })

    client.start()
    await waitFor(() => events.length === 5)
    expect(events.map((event) => event.kind === 'host-resync' && event.reason)).toEqual([
      false,
      'instance_epoch_changed',
      false,
      'sequence_gap',
      false,
    ])
    expect(events[2]).toMatchObject({ host: 'host-a', instanceEpoch: EPOCH_B, sequence: 1 })
    expect(events[4]).toMatchObject({ host: 'host-a', instanceEpoch: EPOCH_B, sequence: 3 })
    await client.stop()
  })

  it('classifies authentication failure without throwing from start', async () => {
    const failures: string[] = []
    const client = new BackendEventClient({
      upstream: upstream('host-a'),
      sink: vi.fn(),
      onFailure: (error) => failures.push(error.state),
      fetchImpl: vi.fn(async () => new Response(null, { status: 401 })),
      retryWait: waitForAbort,
    })

    expect(() => client.start()).not.toThrow()
    await waitFor(() => failures.length === 1)
    expect(failures).toEqual(['authentication_failed'])
    await client.stop()
  })
})

describe('CentralEventFanIn', () => {
  it('keeps equal Project names Host-qualified across simultaneous streams', async () => {
    const a = eventResponse([heartbeat(EPOCH_A, 0), projectEvent(EPOCH_A, 1)], true)
    const b = eventResponse([heartbeat(EPOCH_B, 0), projectEvent(EPOCH_B, 1)], true)
    const events: CentralEvent[] = []
    const fanIn = new CentralEventFanIn({
      sink: (event) => {
        events.push(CentralEventSchema.parse(event))
      },
    })
    fanIn.addHost(upstream('host-a'), {
      fetchImpl: vi.fn(async () => a.response),
      retryWait: waitForAbort,
    })
    fanIn.addHost(upstream('host-b'), {
      fetchImpl: vi.fn(async () => b.response),
      retryWait: waitForAbort,
    })

    fanIn.start()
    await waitFor(() => events.length === 2)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: 'host-a', project: 'project-x' }),
        expect.objectContaining({ host: 'host-b', project: 'project-x' }),
      ]),
    )
    await fanIn.stop()
  })

  it('isolates one Host failure while another Host continues delivering', async () => {
    const healthy = eventResponse([heartbeat(EPOCH_B, 0), projectEvent(EPOCH_B, 1)], true)
    const events: CentralEvent[] = []
    const failures: string[] = []
    const fanIn = new CentralEventFanIn({
      sink: (event) => {
        events.push(CentralEventSchema.parse(event))
      },
      onHostFailure: (hostId) => failures.push(hostId),
    })
    fanIn.addHost(upstream('host-a'), {
      fetchImpl: vi.fn(async () => {
        throw new Error('offline')
      }),
      retryWait: waitForAbort,
    })
    fanIn.addHost(upstream('host-b'), {
      fetchImpl: vi.fn(async () => healthy.response),
      retryWait: waitForAbort,
    })

    expect(() => fanIn.start()).not.toThrow()
    await waitFor(() => failures.length === 1 && events.length === 1)
    expect(failures).toEqual(['host-a'])
    expect(events[0]).toMatchObject({ host: 'host-b', project: 'project-x' })
    await fanIn.stop()
  })
})
