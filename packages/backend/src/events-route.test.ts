import type { AddressInfo } from 'node:net'
import {
  type BackendCapabilities,
  BackendErrorResponseSchema,
  BackendEventFrameSchema,
  BackendMetadataSchema,
} from '@memon/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackendEventStream, type BackendEventTimer } from './event-stream.js'
import {
  BACKEND_EVENTS_PATH,
  BACKEND_META_PATH,
  type BackendServerOptions,
  createBackendServer,
} from './server.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const EPOCH = '123e4567-e89b-42d3-a456-426614174000'
const NOW = '2026-08-26T16:30:00.000Z'

const CAPABILITIES = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
} satisfies BackendCapabilities

class TrackingTimer implements BackendEventTimer {
  handle: { active: boolean } | null = null
  clearCalls = 0

  setInterval = (): { active: boolean } => {
    this.handle = { active: true }
    return this.handle
  }

  clearInterval = (handle: unknown): void => {
    const timer = handle as { active: boolean }
    if (timer.active) this.clearCalls += 1
    timer.active = false
  }
}

const openServers = new Set<ReturnType<typeof createBackendServer>>()

afterEach(async () => {
  await Promise.all(
    [...openServers].map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
  openServers.clear()
})

async function startBackend(options: BackendServerOptions): Promise<string> {
  const server = createBackendServer(options)
  openServers.add(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

function options(eventStream: BackendEventStream): BackendServerOptions {
  return {
    hostId: 'host-a',
    serviceTokens: { current: TOKEN },
    capabilities: CAPABILITIES,
    revision: '0123456789abcdef',
    instanceEpoch: EPOCH,
    eventStream,
  }
}

async function readSseFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  while (!buffered.includes('\n\n')) {
    const next = await reader.read()
    if (next.done) throw new Error('SSE stream ended before a complete frame')
    buffered += decoder.decode(next.value, { stream: true })
  }
  return buffered.slice(0, buffered.indexOf('\n\n') + 2)
}

function parseSseFrame(serialized: string) {
  const dataLine = serialized.split('\n').find((line) => line.startsWith('data: '))
  if (!dataLine) throw new Error('SSE frame has no data line')
  return BackendEventFrameSchema.parse(JSON.parse(dataLine.slice('data: '.length)))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition did not become true')
}

describe('authenticated Backend event SSE route', () => {
  it('authenticates before route handling and permits only GET', async () => {
    const stream = new BackendEventStream({ instanceEpoch: EPOCH, now: () => NOW })
    const subscribe = vi.spyOn(stream, 'subscribe')
    const origin = await startBackend(options(stream))

    const unauthorized = await fetch(`${origin}${BACKEND_EVENTS_PATH}`)
    expect(unauthorized.status).toBe(401)
    expect(BackendErrorResponseSchema.parse(await unauthorized.json()).error.code).toBe(
      'UNAUTHORIZED',
    )
    expect(subscribe).not.toHaveBeenCalled()

    const wrongMethod = await fetch(`${origin}${BACKEND_EVENTS_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('GET')
    expect(subscribe).not.toHaveBeenCalled()
  })

  it('streams the metadata epoch and cleans the heartbeat timer on client disconnect', async () => {
    const timer = new TrackingTimer()
    const stream = new BackendEventStream({
      instanceEpoch: EPOCH,
      heartbeatIntervalMs: 123,
      timer,
      now: () => NOW,
    })
    const origin = await startBackend(options(stream))
    const metadataResponse = await fetch(`${origin}${BACKEND_META_PATH}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    const metadata = BackendMetadataSchema.parse(await metadataResponse.json())
    const response = await fetch(`${origin}${BACKEND_EVENTS_PATH}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    const reader = response.body!.getReader()
    expect(parseSseFrame(await readSseFrame(reader))).toMatchObject({
      kind: 'heartbeat',
      instanceEpoch: metadata.instanceEpoch,
      sequence: 0,
    })

    stream.publish({
      project: 'project-a',
      topic: 'run-change',
      data: { id: 'run-a', type: 'set' },
    })
    expect(parseSseFrame(await readSseFrame(reader))).toMatchObject({
      kind: 'event',
      instanceEpoch: EPOCH,
      sequence: 1,
      project: 'project-a',
      topic: 'run-change',
    })

    await reader.cancel()
    await waitFor(() => stream.subscriberCount === 0)
    expect(timer.handle?.active).toBe(false)
    expect(timer.clearCalls).toBe(1)
  })
})
