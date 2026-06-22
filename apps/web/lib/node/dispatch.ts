// The headless node's RPC dispatcher: resolve a hub-forwarded request to its
// App Router route module, invoke the handler directly (no Next server), and
// serialize the Response back into an RPC reply.
//
// App Router handlers are plain `(Request, ctx?) => Response` functions, so the
// node imports the matched `route.ts` and calls the method export with a
// synthetic `Request` + a `{ params }` context. See add-hub-node-split.

import type { RpcRequest } from '../hub-node/protocol'
import { resolveRoute } from './route-resolver'

type RouteHandler = (
  req: Request,
  ctx?: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response

// route.ts modules don't change within a process — cache the dynamic import.
const moduleCache = new Map<string, Record<string, unknown>>()

export interface DispatchResult {
  status: number
  body: string
  headers?: Record<string, string>
}

function jsonError(status: number, message: string): DispatchResult {
  return {
    status,
    body: JSON.stringify({ error: { message } }),
    headers: { 'content-type': 'application/json' },
  }
}

export async function dispatchRpc(req: RpcRequest): Promise<DispatchResult> {
  const route = resolveRoute(req.path)
  if (!route) return jsonError(404, `no route for ${req.path}`)

  let mod = moduleCache.get(route.filePath)
  if (!mod) {
    try {
      mod = (await import(route.filePath)) as Record<string, unknown>
    } catch (e) {
      return jsonError(500, `failed to load route ${req.path}: ${(e as Error).message}`)
    }
    moduleCache.set(route.filePath, mod)
  }

  const handler = mod[req.method] as RouteHandler | undefined
  if (typeof handler !== 'function') {
    return jsonError(405, `${req.method} not allowed on ${req.path}`)
  }

  const qs =
    req.query && Object.keys(req.query).length
      ? `?${new URLSearchParams(req.query).toString()}`
      : ''
  const url = `http://node.local${req.path}${qs}`
  const init: RequestInit = { method: req.method }
  if (req.headers) init.headers = req.headers
  if (req.body !== undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body
  }
  const request = new Request(url, init)
  const ctx = { params: Promise.resolve(route.params) }

  let res: Response
  try {
    res = await handler(request, ctx)
  } catch (e) {
    return jsonError(500, (e as Error).message)
  }

  const body = await res.text()
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k] = v
  })
  return { status: res.status, body, headers }
}
