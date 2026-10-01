// Node <-> Fetch plumbing shared by every custom-server central gateway
// (remote Backend proxy and directly served Projects). Kept in one place so
// both gateways answer with identical framing, cookie handling, and
// backpressure behaviour.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

type RequestInitWithDuplex = RequestInit & { duplex?: 'half' }

/** Synthetic origin: gateways route by path, never by the browser Host header. */
export const CENTRAL_REQUEST_ORIGIN = 'http://central.invalid'

/**
 * One custom-server gateway attempt. Returns true when the gateway owns and
 * has answered the request, false to let Next handle it.
 */
export type CentralGatewayHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean>

export function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function incomingHeaders(request: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else {
      headers.set(name, value)
    }
  }
  return headers
}

export function requestUrl(request: IncomingMessage): URL | null {
  try {
    return new URL(request.url ?? '/', CENTRAL_REQUEST_ORIGIN)
  } catch {
    return null
  }
}

export function toWebRequest(request: IncomingMessage, signal: AbortSignal): Request {
  const method = request.method?.toUpperCase() ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(request)
  const init: RequestInitWithDuplex = {
    method,
    headers: incomingHeaders(request),
    signal,
    ...(body === null ? {} : { body: body as ReadableStream<Uint8Array>, duplex: 'half' }),
  }
  return new Request(new URL(request.url ?? '/', CENTRAL_REQUEST_ORIGIN), init)
}

/** Immediate JSON denial/failure written without touching any upstream. */
export function writeImmediate(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  headers: Record<string, string>,
  setCookies: readonly string[] = [],
  payload?: { code: string; message: string },
): void {
  request.resume()
  const body = JSON.stringify({
    error: payload ?? {
      code:
        status === 401
          ? 'UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 429
              ? 'RATE_LIMITED'
              : status === 405
                ? 'METHOD_NOT_ALLOWED'
                : 'BAD_GATEWAY',
      message:
        status === 401
          ? 'Authentication required'
          : status === 403
            ? 'Request is outside the authorized Host scope'
            : status === 429
              ? 'Too many authentication attempts'
              : status === 405
                ? 'Method not allowed'
                : 'Central gateway request failed',
    },
  })
  response.writeHead(status, {
    ...headers,
    ...(setCookies.length > 0 ? { 'Set-Cookie': [...setCookies] } : {}),
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(body)
}

function applyResponseHeaders(
  response: ServerResponse,
  headers: Headers,
  setCookies: readonly string[],
): void {
  for (const [name, value] of headers.entries()) response.setHeader(name, value)
  if (setCookies.length > 0) response.setHeader('Set-Cookie', [...setCookies])
}

// `Promise.withResolvers` is not in this project's ES2022 lib/Node baseline,
// so the executor form is required here.
function waitForDrain(response: ServerResponse, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const cleanup = () => {
      response.off('drain', onDrain)
      response.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onClose = () => {
      cleanup()
      reject(new Error('browser connection closed'))
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason)
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function pipeWebResponse(
  upstream: Response,
  response: ServerResponse,
  setCookies: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  response.statusCode = upstream.status
  response.statusMessage = upstream.statusText
  applyResponseHeaders(response, upstream.headers, setCookies)
  if (!upstream.body) {
    response.end()
    return
  }

  const reader = upstream.body.getReader()
  const onAbort = () => void reader.cancel(signal.reason).catch(() => undefined)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!response.write(Buffer.from(next.value))) await waitForDrain(response, signal)
    }
    response.end()
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (!response.destroyed) response.destroy(error as Error)
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
