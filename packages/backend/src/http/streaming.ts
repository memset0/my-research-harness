// Server-sent events, log streams and byte-range resources.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import { BackendLogStreamEventSchema } from '@memon/core'
import type { BackendEventStream } from '../event-stream.js'
import type { BackendByteResource, BackendStreamService } from '../stream-service.js'
import { MAX_BACKEND_CONTROL_JSON_BYTES } from './paths.js'

export function writeEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  eventStream: BackendEventStream,
): void {
  response.writeHead(200, {
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  })
  response.flushHeaders()

  let cleaned = false
  let unsubscribe = () => {}
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    unsubscribe()
    request.off('aborted', cleanup)
    response.off('close', cleanup)
    response.off('error', cleanup)
  }

  request.once('aborted', cleanup)
  response.once('close', cleanup)
  response.once('error', cleanup)
  unsubscribe = eventStream.subscribe((serialized) => {
    if (cleaned || response.destroyed) return false
    if (response.write(serialized)) return true

    // Never build an unbounded application queue behind a slow client. End
    // this stream and let central reconnect/resync from epoch + sequence.
    queueMicrotask(() => {
      cleanup()
      response.end()
    })
    return false
  })
  if (cleaned) unsubscribe()
}

interface ParsedByteRange {
  start: number
  end: number
}

function parseByteRange(header: string, size: number): ParsedByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return null
  const [, startText = '', endText = ''] = match
  if (startText === '' && endText === '') return null
  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(startText)
  const requestedEnd = endText === '' ? size - 1 : Number(endText)
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= size ||
    requestedEnd < start
  ) {
    return null
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function headerMatchesEtag(value: string | undefined, etag: string): boolean {
  if (!value) return false
  return value
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag)
}

function notModified(request: IncomingMessage, resource: BackendByteResource): boolean {
  const noneMatch = request.headers['if-none-match']
  if (typeof noneMatch === 'string') return headerMatchesEtag(noneMatch, resource.etag)
  const modifiedSince = request.headers['if-modified-since']
  if (typeof modifiedSince !== 'string') return false
  const timestamp = Date.parse(modifiedSince)
  return (
    Number.isFinite(timestamp) &&
    Math.floor(resource.mtimeMs / 1000) <= Math.floor(timestamp / 1000)
  )
}

function ifRangeAllows(request: IncomingMessage, resource: BackendByteResource): boolean {
  const value = request.headers['if-range']
  if (typeof value !== 'string') return true
  if (value.startsWith('W/')) return false
  if (value.startsWith('"')) return value === resource.etag
  const timestamp = Date.parse(value)
  return (
    Number.isFinite(timestamp) &&
    Math.floor(resource.mtimeMs / 1000) <= Math.floor(timestamp / 1000)
  )
}

function byteResourceHeaders(resource: BackendByteResource): Record<string, string> {
  return {
    ...(resource.contentSecurityPolicy
      ? { 'content-security-policy': resource.contentSecurityPolicy }
      : {}),
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache',
    'content-type': resource.contentType,
    etag: resource.etag,
    'last-modified': new Date(resource.mtimeMs).toUTCString(),
    'x-content-type-options': 'nosniff',
    'x-memon-resource-version': resource.version,
  }
}

function requestAbortController(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('Backend downstream disconnected'))
  request.once('aborted', abort)
  response.once('close', abort)
  return {
    signal: controller.signal,
    cleanup: () => {
      request.off('aborted', abort)
      response.off('close', abort)
    },
  }
}

function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || response.destroyed) return Promise.resolve(false)
  return new Promise((resolveDrain) => {
    const cleanup = () => {
      response.off('drain', onDrain)
      response.off('close', onClose)
      signal.removeEventListener('abort', onClose)
    }
    const onDrain = () => {
      cleanup()
      resolveDrain(true)
    }
    const onClose = () => {
      cleanup()
      resolveDrain(false)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    signal.addEventListener('abort', onClose, { once: true })
  })
}

export class BackendStreamDeadlineError extends Error {}

export function withStreamControlDeadline<T>(
  operation: Promise<T>,
  request: IncomingMessage,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolveOperation, rejectOperation) => {
    const timer = setTimeout(() => {
      cleanup()
      rejectOperation(new BackendStreamDeadlineError('Backend stream control deadline exceeded'))
    }, timeoutMs)
    timer.unref?.()
    const onAbort = () => {
      cleanup()
      rejectOperation(new BackendStreamDeadlineError('Backend stream request aborted'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      request.off('aborted', onAbort)
    }
    request.once('aborted', onAbort)
    operation.then(
      (value) => {
        cleanup()
        resolveOperation(value)
      },
      (error) => {
        cleanup()
        rejectOperation(error)
      },
    )
  })
}

export async function streamLogEvents(
  request: IncomingMessage,
  response: ServerResponse,
  service: BackendStreamService,
  project: string,
  resource: string,
): Promise<void> {
  const abort = requestAbortController(request, response)
  response.writeHead(200, {
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  })
  response.flushHeaders()
  try {
    for await (const event of service.streamLog(project, resource, abort.signal)) {
      if (abort.signal.aborted || response.destroyed) return
      const parsed = BackendLogStreamEventSchema.parse(event)
      const frame = `event: ${parsed.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`
      if (Buffer.byteLength(frame) > MAX_BACKEND_CONTROL_JSON_BYTES) {
        const bounded = 'event: error\ndata: {"message":"Backend log event exceeds limit"}\n\n'
        response.write(bounded)
        return
      }
      if (!response.write(frame) && !(await waitForDrain(response, abort.signal))) return
    }
  } catch {
    if (!abort.signal.aborted && !response.destroyed) {
      response.write('event: error\ndata: {"message":"Backend log stream is unavailable"}\n\n')
    }
  } finally {
    abort.cleanup()
    if (!response.destroyed && !response.writableEnded) response.end()
  }
}

export async function streamByteResource(
  request: IncomingMessage,
  response: ServerResponse,
  service: BackendStreamService,
  resource: BackendByteResource,
): Promise<void> {
  const headers = byteResourceHeaders(resource)
  if (notModified(request, resource)) {
    response.writeHead(304, headers)
    response.end()
    return
  }
  const rangeHeader = request.headers.range
  let range: ParsedByteRange | undefined
  if (typeof rangeHeader === 'string' && ifRangeAllows(request, resource)) {
    const parsed = parseByteRange(rangeHeader, resource.size)
    if (!parsed) {
      response.writeHead(416, {
        ...headers,
        'content-length': '0',
        'content-range': `bytes */${resource.size}`,
      })
      response.end()
      return
    }
    range = parsed
  }
  const contentLength = range ? range.end - range.start + 1 : resource.size
  response.writeHead(range ? 206 : 200, {
    ...headers,
    'content-length': String(contentLength),
    ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${resource.size}` } : {}),
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const abort = requestAbortController(request, response)
  try {
    await pipeline(service.openByteStream(resource, range), response, { signal: abort.signal })
  } catch {
    if (!abort.signal.aborted && !response.destroyed) response.destroy()
  } finally {
    abort.cleanup()
  }
}
