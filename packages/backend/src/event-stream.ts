import {
  type BackendEventFrame,
  BackendEventFrameSchema,
  BackendProjectEventFrameSchema,
  InstanceEpochSchema,
} from '@memon/core'

export const DEFAULT_BACKEND_EVENT_HEARTBEAT_MS = 15_000
export const DEFAULT_MAX_BACKEND_EVENT_FRAME_BYTES = 64 * 1024

export interface BackendEventTimer {
  setInterval(callback: () => void, intervalMs: number): unknown
  clearInterval(handle: unknown): void
}

export interface BackendEventStreamOptions {
  instanceEpoch: string
  heartbeatIntervalMs?: number
  maxFrameBytes?: number
  timer?: BackendEventTimer
  now?: () => string
  initialSequence?: number
}

export interface BackendProjectEventInput {
  project: unknown
  topic: unknown
  data: unknown
}

export type BackendEventSubscriber = (serializedSseFrame: string) => boolean

export class BackendEventStreamError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_EVENT'
      | 'FRAME_TOO_LARGE'
      | 'SEQUENCE_EXHAUSTED'
      | 'SERIALIZATION_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'BackendEventStreamError'
  }
}

const DEFAULT_TIMER: BackendEventTimer = {
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return value
}

function initialSequence(value: number | undefined): number {
  const sequence = value ?? 0
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error('initialSequence must be a non-negative safe integer')
  }
  return sequence
}

/**
 * One epoch-scoped Backend event broadcaster. Project events advance the safe
 * monotonic sequence; heartbeats report the current sequence without creating
 * artificial gaps for clients that did not observe another client's heartbeat.
 */
export class BackendEventStream {
  readonly instanceEpoch: ReturnType<typeof InstanceEpochSchema.parse>

  private readonly heartbeatIntervalMs: number
  private readonly maxFrameBytes: number
  private readonly timer: BackendEventTimer
  private readonly now: () => string
  private readonly subscribers = new Set<BackendEventSubscriber>()
  private heartbeatTimer: unknown | null = null
  private sequence: number

  constructor(options: BackendEventStreamOptions) {
    this.instanceEpoch = InstanceEpochSchema.parse(options.instanceEpoch)
    this.heartbeatIntervalMs = positiveInteger(
      options.heartbeatIntervalMs ?? DEFAULT_BACKEND_EVENT_HEARTBEAT_MS,
      'heartbeatIntervalMs',
    )
    this.maxFrameBytes = positiveInteger(
      options.maxFrameBytes ?? DEFAULT_MAX_BACKEND_EVENT_FRAME_BYTES,
      'maxFrameBytes',
    )
    this.timer = options.timer ?? DEFAULT_TIMER
    this.now = options.now ?? (() => new Date().toISOString())
    this.sequence = initialSequence(options.initialSequence)
  }

  get currentSequence(): number {
    return this.sequence
  }

  get subscriberCount(): number {
    return this.subscribers.size
  }

  subscribe(subscriber: BackendEventSubscriber): () => void {
    const initialHeartbeat = this.serializeHeartbeat()
    this.subscribers.add(subscriber)
    if (this.subscribers.size === 1) this.startHeartbeat()
    this.deliverOne(subscriber, initialHeartbeat)

    let active = true
    return () => {
      if (!active) return
      active = false
      this.subscribers.delete(subscriber)
      if (this.subscribers.size === 0) this.stopHeartbeat()
    }
  }

  publish(input: BackendProjectEventInput): BackendEventFrame {
    if (this.sequence >= Number.MAX_SAFE_INTEGER) {
      throw new BackendEventStreamError(
        'SEQUENCE_EXHAUSTED',
        'Backend event sequence is exhausted for this instance epoch',
      )
    }

    const parsed = BackendProjectEventFrameSchema.safeParse({
      kind: 'event',
      instanceEpoch: this.instanceEpoch,
      sequence: this.sequence + 1,
      emittedAt: this.now(),
      project: input.project,
      topic: input.topic,
      data: input.data,
    })
    if (!parsed.success) {
      throw new BackendEventStreamError('INVALID_EVENT', 'Backend Project event is invalid')
    }

    const serialized = this.serialize(parsed.data)
    this.sequence = parsed.data.sequence
    this.broadcast(serialized)
    return parsed.data
  }

  close(): void {
    this.subscribers.clear()
    this.stopHeartbeat()
  }

  private serializeHeartbeat(): string {
    const frame = BackendEventFrameSchema.parse({
      kind: 'heartbeat',
      instanceEpoch: this.instanceEpoch,
      sequence: this.sequence,
      emittedAt: this.now(),
    })
    return this.serialize(frame)
  }

  private serialize(frame: BackendEventFrame): string {
    let payload: string
    try {
      payload = JSON.stringify(frame)
    } catch {
      throw new BackendEventStreamError(
        'SERIALIZATION_FAILED',
        'Backend event is not JSON serializable',
      )
    }
    const serialized = `event: ${frame.kind}\nid: ${frame.instanceEpoch}:${frame.sequence}\ndata: ${payload}\n\n`
    if (Buffer.byteLength(serialized) > this.maxFrameBytes) {
      throw new BackendEventStreamError(
        'FRAME_TOO_LARGE',
        `Backend event frame exceeds ${this.maxFrameBytes} bytes`,
      )
    }
    return serialized
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer !== null) return
    this.heartbeatTimer = this.timer.setInterval(() => {
      if (this.subscribers.size === 0) {
        this.stopHeartbeat()
        return
      }
      try {
        this.broadcast(this.serializeHeartbeat())
      } catch {
        // A bad injected clock must not crash the Backend process. Project
        // events still validate and surface an explicit error to their caller.
      }
    }, this.heartbeatIntervalMs)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return
    this.timer.clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private broadcast(serialized: string): void {
    for (const subscriber of [...this.subscribers]) this.deliverOne(subscriber, serialized)
  }

  private deliverOne(subscriber: BackendEventSubscriber, serialized: string): void {
    try {
      if (subscriber(serialized) === false) this.subscribers.delete(subscriber)
    } catch {
      this.subscribers.delete(subscriber)
    }
    if (this.subscribers.size === 0) this.stopHeartbeat()
  }
}
