import {
  type BackendEventFrame,
  BackendEventSchema,
  type CentralEvent,
  HostIdSchema,
  HostQualifiedBackendEventSchema,
  HostResyncEventSchema,
} from '@memon/core'
import type { BackendUpstream } from './backend-client'
import { BackendHeaderPolicyError, buildBackendRequestHeaders } from './backend-headers'
import {
  type BackendFetch,
  BackendRedirectPolicyError,
  fetchBackendWithoutRedirect,
} from './backend-url'

export const BACKEND_EVENTS_PATH = '/api/backend/v1/events'
export const DEFAULT_BACKEND_EVENT_RETRY_MS = 1_000
export const DEFAULT_MAX_BACKEND_SSE_FRAME_BYTES = 64 * 1024

export type BackendEventClientFailureState = 'offline' | 'authentication_failed' | 'misconfigured'

export class BackendEventClientError extends Error {
  constructor(
    public readonly state: BackendEventClientFailureState,
    message: string,
  ) {
    super(message)
    this.name = 'BackendEventClientError'
  }
}

export type CentralEventSink = (event: CentralEvent) => void | Promise<void>
export type BackendEventFailureSink = (error: BackendEventClientError) => void
export type BackendEventRetryWait = (delayMs: number, signal: AbortSignal) => Promise<void>

export interface BackendEventClientOptions {
  upstream: BackendUpstream
  sink: CentralEventSink
  onFailure?: BackendEventFailureSink
  fetchImpl?: BackendFetch
  retryDelayMs?: number
  retryWait?: BackendEventRetryWait
  maxFrameBytes?: number
  now?: () => string
}

function parserError(message: string): BackendEventClientError {
  return new BackendEventClientError('misconfigured', message)
}

/** Incremental, bounded parser for the data payloads of an SSE stream. */
export class BoundedBackendSseParser {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private buffered = ''

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_BACKEND_SSE_FRAME_BYTES) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
      throw new Error('maxFrameBytes must be a positive safe integer')
    }
  }

  push(chunk: Uint8Array): BackendEventFrame[] {
    try {
      this.buffered += this.decoder.decode(chunk, { stream: true })
    } catch {
      throw parserError('Backend event stream is not valid UTF-8')
    }
    return this.drain()
  }

  finish(): BackendEventFrame[] {
    try {
      this.buffered += this.decoder.decode()
    } catch {
      throw parserError('Backend event stream is not valid UTF-8')
    }
    const frames = this.drain()
    if (this.buffered.trim() !== '') {
      throw parserError('Backend event stream ended with a truncated SSE frame')
    }
    this.buffered = ''
    return frames
  }

  private drain(): BackendEventFrame[] {
    const frames: BackendEventFrame[] = []
    while (true) {
      const boundary = /\r?\n\r?\n/.exec(this.buffered)
      if (!boundary || boundary.index === undefined) break
      const consumedLength = boundary.index + boundary[0].length
      const rawFrame = this.buffered.slice(0, boundary.index)
      const serializedFrame = this.buffered.slice(0, consumedLength)
      this.buffered = this.buffered.slice(consumedLength)

      if (Buffer.byteLength(serializedFrame) > this.maxFrameBytes) {
        throw parserError('Backend SSE frame exceeds the size limit')
      }
      const frame = this.parseFrame(rawFrame)
      if (frame) frames.push(frame)
    }

    if (Buffer.byteLength(this.buffered) > this.maxFrameBytes) {
      throw parserError('Backend SSE frame exceeds the size limit')
    }
    return frames
  }

  private parseFrame(rawFrame: string): BackendEventFrame | null {
    const dataLines: string[] = []
    for (const line of rawFrame.split(/\r?\n/)) {
      if (line === '' || line.startsWith(':')) continue
      const separator = line.indexOf(':')
      const field = separator === -1 ? line : line.slice(0, separator)
      if (field !== 'data') continue
      let value = separator === -1 ? '' : line.slice(separator + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      dataLines.push(value)
    }
    if (dataLines.length === 0) return null

    let payload: unknown
    try {
      payload = JSON.parse(dataLines.join('\n'))
    } catch {
      throw parserError('Backend SSE data is not valid JSON')
    }
    const parsed = BackendEventSchema.safeParse(payload)
    if (!parsed.success) throw parserError('Backend SSE event failed runtime validation')
    return parsed.data
  }
}

function defaultRetryWait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function normalizedError(error: unknown, signal: AbortSignal): BackendEventClientError {
  if (error instanceof BackendEventClientError) return error
  if (error instanceof BackendRedirectPolicyError || error instanceof BackendHeaderPolicyError) {
    return new BackendEventClientError('misconfigured', 'Backend event request policy failed')
  }
  return new BackendEventClientError(
    'offline',
    signal.aborted ? 'Backend event stream was cancelled' : 'Backend event stream failed',
  )
}

export class BackendEventClient {
  readonly hostId: string

  private readonly upstream: BackendUpstream
  private readonly sink: CentralEventSink
  private readonly onFailure: BackendEventFailureSink | undefined
  private readonly fetchImpl: BackendFetch | undefined
  private readonly retryDelayMs: number
  private readonly retryWait: BackendEventRetryWait
  private readonly maxFrameBytes: number
  private readonly now: () => string

  private desiredRunning = false
  private lifecycle: AbortController | null = null
  private running: Promise<void> | null = null
  private activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private lastEpoch: string | null = null
  private lastSequence: number | null = null

  constructor(options: BackendEventClientOptions) {
    this.hostId = HostIdSchema.parse(options.upstream.hostId)
    this.upstream = options.upstream
    this.sink = options.sink
    this.onFailure = options.onFailure
    this.fetchImpl = options.fetchImpl
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_BACKEND_EVENT_RETRY_MS
    if (!Number.isSafeInteger(this.retryDelayMs) || this.retryDelayMs <= 0) {
      throw new Error('retryDelayMs must be a positive safe integer')
    }
    this.retryWait = options.retryWait ?? defaultRetryWait
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_BACKEND_SSE_FRAME_BYTES
    if (!Number.isSafeInteger(this.maxFrameBytes) || this.maxFrameBytes <= 0) {
      throw new Error('maxFrameBytes must be a positive safe integer')
    }
    this.now = options.now ?? (() => new Date().toISOString())
  }

  get isRunning(): boolean {
    return this.desiredRunning
  }

  start(): void {
    if (this.desiredRunning) return
    this.desiredRunning = true
    const lifecycle = new AbortController()
    this.lifecycle = lifecycle
    this.running = this.run(lifecycle.signal)
  }

  async stop(): Promise<void> {
    this.desiredRunning = false
    this.lifecycle?.abort(new Error('Backend event client stopped'))
    this.lifecycle = null
    void this.activeReader?.cancel().catch(() => undefined)
    const running = this.running
    await running
    if (this.running === running) this.running = null
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (this.desiredRunning && !signal.aborted) {
      try {
        await this.connectOnce(signal)
      } catch (error) {
        if (!this.desiredRunning || signal.aborted) break
        this.reportFailure(normalizedError(error, signal))
      }

      if (!this.desiredRunning || signal.aborted) break
      try {
        await this.retryWait(this.retryDelayMs, signal)
      } catch {
        if (!this.desiredRunning || signal.aborted) break
      }
    }
  }

  private async connectOnce(signal: AbortSignal): Promise<void> {
    let response: Response
    try {
      response = await fetchBackendWithoutRedirect(
        `${this.upstream.baseUrl}${BACKEND_EVENTS_PATH}`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: buildBackendRequestHeaders(
            new Headers({ accept: 'text/event-stream', 'cache-control': 'no-cache' }),
            { serviceToken: this.upstream.serviceToken, actor: { role: 'owner' } },
          ),
          signal,
        },
        this.fetchImpl,
      )
    } catch (error) {
      throw normalizedError(error, signal)
    }

    if (signal.aborted) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendEventClientError('offline', 'Backend event stream was cancelled')
    }

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendEventClientError(
        'authentication_failed',
        'Backend rejected event-stream service authentication',
      )
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendEventClientError(
        response.status >= 500 ? 'offline' : 'misconfigured',
        `Backend event request failed with status ${response.status}`,
      )
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'text/event-stream' || !response.body) {
      await response.body?.cancel().catch(() => undefined)
      throw new BackendEventClientError(
        'misconfigured',
        'Backend event response is not an SSE stream',
      )
    }

    const parser = new BoundedBackendSseParser(this.maxFrameBytes)
    const reader = response.body.getReader()
    this.activeReader = reader
    const reconnect = this.lastEpoch !== null
    let firstFrame = true
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        for (const frame of parser.push(next.value)) {
          await this.acceptFrame(frame, reconnect && firstFrame)
          firstFrame = false
        }
      }
      for (const frame of parser.finish()) {
        await this.acceptFrame(frame, reconnect && firstFrame)
        firstFrame = false
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally {
      if (this.activeReader === reader) this.activeReader = null
      reader.releaseLock()
    }
    throw new BackendEventClientError('offline', 'Backend event stream ended')
  }

  private async acceptFrame(frame: BackendEventFrame, reconnect: boolean): Promise<void> {
    let resyncReason: 'reconnect' | 'instance_epoch_changed' | 'sequence_gap' | null = null
    if (this.lastEpoch !== null && this.lastSequence !== null) {
      if (frame.instanceEpoch !== this.lastEpoch) {
        resyncReason = 'instance_epoch_changed'
      } else {
        const expected = frame.kind === 'heartbeat' ? this.lastSequence : this.lastSequence + 1
        if (frame.sequence !== expected) resyncReason = 'sequence_gap'
        else if (reconnect) resyncReason = 'reconnect'
      }
    }

    if (resyncReason) {
      await this.sink(
        HostResyncEventSchema.parse({
          kind: 'host-resync',
          host: this.hostId,
          reason: resyncReason,
          emittedAt: this.now(),
        }),
      )
    }

    this.lastEpoch = frame.instanceEpoch
    this.lastSequence = frame.sequence
    if (frame.kind === 'heartbeat') return
    await this.sink(HostQualifiedBackendEventSchema.parse({ ...frame, host: this.hostId }))
  }

  private reportFailure(error: BackendEventClientError): void {
    try {
      this.onFailure?.(error)
    } catch {
      // A diagnostic callback is not allowed to take down another Host stream.
    }
  }
}

export interface CentralEventFanInOptions {
  sink: CentralEventSink
  onHostFailure?: (hostId: string, error: BackendEventClientError) => void
}

/** Lightweight lifecycle owner; each Host client retains isolated failure state. */
export class CentralEventFanIn {
  private readonly clients = new Map<string, BackendEventClient>()

  constructor(private readonly options: CentralEventFanInOptions) {}

  addHost(
    upstream: BackendUpstream,
    options: Omit<BackendEventClientOptions, 'upstream' | 'sink' | 'onFailure'> = {},
  ): BackendEventClient {
    if (this.clients.has(upstream.hostId)) {
      throw new Error(`Backend event Host ${upstream.hostId} is already registered`)
    }
    const client = new BackendEventClient({
      ...options,
      upstream,
      sink: this.options.sink,
      onFailure: (error) => {
        try {
          this.options.onHostFailure?.(upstream.hostId, error)
        } catch {
          // Failure reporting is isolated just like the Host client itself.
        }
      },
    })
    this.clients.set(client.hostId, client)
    return client
  }

  start(): void {
    for (const [hostId, client] of this.clients) {
      try {
        client.start()
      } catch (error) {
        try {
          this.options.onHostFailure?.(hostId, normalizedError(error, new AbortController().signal))
        } catch {
          // Continue starting every other Host even if diagnostics fail.
        }
      }
    }
  }

  async removeHost(hostId: string): Promise<void> {
    const client = this.clients.get(hostId)
    if (!client) return
    this.clients.delete(hostId)
    await client.stop()
  }

  async stop(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((client) => client.stop()))
  }
}
