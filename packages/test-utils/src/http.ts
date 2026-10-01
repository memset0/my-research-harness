import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** Encode an actor context the way the backend actor header carries it. */
export function actorHeader(actor: unknown): string {
  return Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
}

export interface BackendRequestOptions<Actor = unknown> {
  actor?: Actor
  /** Send the service bearer token (default `true`). */
  service?: boolean
  method?: string
  /** JSON-encoded with `content-type: application/json` when present. */
  body?: unknown
  /** Origin override for this one request. */
  base?: string
}

export interface BackendRequestConfig {
  /** Read lazily so a `let origin` assigned in `beforeAll` works. */
  origin: () => string
  token: string
  /** Name of the actor-context header (`BACKEND_ACTOR_CONTEXT_HEADER`). */
  actorHeaderName: string
}

/** Build a `request(path, options)` helper bound to one backend under test. */
export function createBackendRequest<Actor = unknown>(config: BackendRequestConfig) {
  return function request(
    path: string,
    options: BackendRequestOptions<Actor> = {},
  ): Promise<Response> {
    const headers = new Headers()
    if (options.service !== false) headers.set('authorization', `Bearer ${config.token}`)
    if (options.actor) headers.set(config.actorHeaderName, actorHeader(options.actor))
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    return fetch(`${options.base ?? config.origin()}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  }
}

/**
 * Listen on an ephemeral loopback port and resolve the server's origin. When
 * `registry` is given the server is added to it so an `afterEach` can close it.
 */
export async function startBackend(server: Server, registry?: Set<Server>): Promise<string> {
  registry?.add(server)
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

/** Next.js route-handler context for a `[project]` segment (plus any others). */
export function paramsFor<Extra extends Record<string, string>>(
  project: string,
  extra?: Extra,
): { params: Promise<{ project: string } & Extra> } {
  return { params: Promise.resolve({ project, ...(extra as Extra) }) }
}
