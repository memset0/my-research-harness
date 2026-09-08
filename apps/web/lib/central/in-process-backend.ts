// Run the framework-neutral Backend request handler inside this process.
//
// A central instance that owns its Project filesystems still answers the exact
// same Backend API contract — route allow-list, actor-context authorization,
// read-only policy, DTO shaping and byte/stream semantics. Reusing the handler
// keeps one implementation of all of that; this module only adapts between
// `Request`/`Response` and the Node handler signature. No socket is opened and
// no listener exists: an in-process call cannot be reached from the network.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { PassThrough, Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { BackendHandler } from '@memon/backend'

export type InProcessBackendDispatch = (request: Request) => Promise<Response>

/** Statuses whose response must not carry a body (RFC 9110 6.4.1). */
const BODYLESS_STATUSES: Record<number, true> = { 204: true, 205: true, 304: true }

type NodeHeaderValue = string | number | readonly string[]

function toNodeRequest(request: Request): IncomingMessage {
  const url = new URL(request.url)
  const source = request.body
    ? Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>)
    : Readable.from([])
  const headers: Record<string, string> = {}
  for (const [name, value] of request.headers.entries()) headers[name] = value

  const incoming = source as unknown as IncomingMessage
  incoming.method = request.method.toUpperCase()
  incoming.url = `${url.pathname}${url.search}`
  incoming.headers = headers
  incoming.httpVersion = '1.1'
  incoming.httpVersionMajor = 1
  incoming.httpVersionMinor = 1
  // The handler reads only `remoteAddress` for diagnostics, and an in-process
  // call has no peer address other than this host.
  incoming.socket = { remoteAddress: '127.0.0.1' } as IncomingMessage['socket']
  if (request.signal.aborted) queueMicrotask(() => incoming.emit('aborted'))
  else {
    request.signal.addEventListener(
      'abort',
      () => {
        incoming.emit('aborted')
        source.destroy()
      },
      { once: true },
    )
  }
  return incoming
}

/**
 * `ServerResponse`-shaped sink. A PassThrough gives real Node backpressure,
 * `drain`/`close` events and `pipeline()` compatibility, so streaming byte and
 * event responses behave exactly as they do over a socket.
 */
class InProcessBackendResponse extends PassThrough {
  statusCode = 200
  statusMessage = ''
  headersSent = false

  private readonly outgoing = new Headers()
  // `Promise.withResolvers` is outside this project's ES2022 lib/Node
  // baseline, so the resolver is captured from the executor.
  private commitHeaders: () => void = () => {}
  private readonly commit = new Promise<void>((resolve) => {
    this.commitHeaders = resolve
  })

  setHeader(name: string, value: NodeHeaderValue): this {
    this.outgoing.delete(name)
    if (Array.isArray(value)) for (const item of value) this.outgoing.append(name, item)
    else this.outgoing.set(name, String(value))
    return this
  }

  getHeader(name: string): string | undefined {
    return this.outgoing.get(name) ?? undefined
  }

  hasHeader(name: string): boolean {
    return this.outgoing.has(name)
  }

  removeHeader(name: string): void {
    this.outgoing.delete(name)
  }

  writeHead(
    statusCode: number,
    statusMessageOrHeaders?: string | Record<string, NodeHeaderValue>,
    maybeHeaders?: Record<string, NodeHeaderValue>,
  ): this {
    this.statusCode = statusCode
    if (typeof statusMessageOrHeaders === 'string') this.statusMessage = statusMessageOrHeaders
    const headers =
      typeof statusMessageOrHeaders === 'string' ? maybeHeaders : statusMessageOrHeaders
    for (const [name, value] of Object.entries(headers ?? {})) this.setHeader(name, value)
    this.flushHeaders()
    return this
  }

  flushHeaders(): void {
    if (this.headersSent) return
    this.headersSent = true
    this.commitHeaders()
  }

  /** Resolves once the status line and headers are final. */
  committed(): Promise<void> {
    return this.commit
  }

  outgoingHeaders(): Headers {
    return this.outgoing
  }

  override _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.flushHeaders()
    super._transform(chunk, encoding, callback)
  }

  override _flush(callback: (error?: Error | null) => void): void {
    this.flushHeaders()
    callback()
  }
}

function commitFailure(response: InProcessBackendResponse, message: string): void {
  if (response.headersSent) {
    if (!response.writableEnded && !response.destroyed) response.end()
    return
  }
  const body = JSON.stringify({ error: { code: 'INTERNAL', message, retryable: false } })
  response.writeHead(500, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

/**
 * Adapt one Backend handler to a `Request` -> `Response` function. Response
 * headers become final as soon as the handler writes them, so streamed bodies
 * start flowing without buffering the whole payload.
 */
export function createInProcessBackendDispatch(handler: BackendHandler): InProcessBackendDispatch {
  return async (request) => {
    const nodeRequest = toNodeRequest(request)
    const response = new InProcessBackendResponse()
    void handler(nodeRequest, response as unknown as ServerResponse).then(
      () => commitFailure(response, 'Backend handler produced no response'),
      (error: unknown) =>
        commitFailure(response, error instanceof Error ? error.message : 'Backend request failed'),
    )
    await response.committed()

    const bodyless =
      BODYLESS_STATUSES[response.statusCode] === true || nodeRequest.method === 'HEAD'
    if (bodyless) response.resume()
    return new Response(
      bodyless ? null : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>),
      {
        status: response.statusCode,
        ...(response.statusMessage ? { statusText: response.statusMessage } : {}),
        headers: response.outgoingHeaders(),
      },
    )
  }
}
