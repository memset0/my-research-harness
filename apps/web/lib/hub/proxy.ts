// Hub data-plane: decide which connected node owns a browser /api request and
// forward it over the transport, plus the /api/projects fan-out+merge. The hub
// stores nothing — every call is proxied live. See add-hub-node-split
// (hub-data-proxy).

import type { HubLink, NodeRegistry } from './registry'

export interface ProxyRequest {
  method: string
  path: string
  query?: Record<string, string>
  body?: string
  headers?: Record<string, string>
}

export interface ProxyResult {
  status: number
  body: string
  headers?: Record<string, string>
}

// Paths the hub serves itself (never forwarded to a node): browser auth, the
// hub's own endpoints, the SSE stream (which relays node events via rt.events),
// and the ttyd terminal proxy.
const HUB_LOCAL = [/^\/api\/auth(\/|$)/, /^\/api\/hub(\/|$)/, /^\/api\/events(\?|$)/, /^\/api\/terminal(\/|$)/]

export function isHubLocal(path: string): boolean {
  return HUB_LOCAL.some((re) => re.test(path))
}

/** True for data `/api/*` requests the hub must forward to a node. */
export function isForwardable(path: string): boolean {
  return path.startsWith('/api/') && !isHubLocal(path)
}

/** Extract the target project from `?project=` or `/api/projects/<p>/...`. */
export function projectFromRequest(path: string, query?: Record<string, string>): string | null {
  if (query?.project) return query.project
  const m = /^\/api\/projects\/([^/?]+)(?:\/|$)/.exec(path)
  return m ? decodeURIComponent(m[1]!) : null
}

function jsonResult(status: number, obj: unknown): ProxyResult {
  return { status, body: JSON.stringify(obj), headers: { 'content-type': 'application/json' } }
}

/** Aggregate `/api/projects` across all projects-capable nodes, tagged by node. */
export async function fanOutProjects(registry: NodeRegistry): Promise<ProxyResult> {
  const nodes = registry.projectNodes()
  const merged: Array<Record<string, unknown>> = []
  await Promise.all(
    nodes.map(async (n) => {
      try {
        const res = await n.call({ method: 'GET', path: '/api/projects' })
        if (res.status !== 200) return
        const data = JSON.parse(res.body) as { projects?: Array<Record<string, unknown>> }
        for (const p of data.projects ?? []) merged.push({ ...p, node: n.name })
      } catch {
        /* node hiccup — omit its projects rather than fail the whole list */
      }
    }),
  )
  return jsonResult(200, { projects: merged })
}

async function broadcastFirstHit(nodes: HubLink[], req: ProxyRequest): Promise<ProxyResult> {
  let last: ProxyResult = jsonResult(404, { error: { message: 'not found on any connected node' } })
  for (const n of nodes) {
    try {
      const res = await n.call({ method: req.method, path: req.path, query: req.query })
      if (res.status !== 404) return { status: res.status, body: res.body, headers: res.headers }
      last = { status: res.status, body: res.body, headers: res.headers }
    } catch {
      /* try the next node */
    }
  }
  return last
}

/**
 * Forward a browser data request to the owning node and return its response.
 * Routing: `/api/projects` fans out; project-scoped routes go to the owning
 * node; with no project scope, a single node handles it, while multiple nodes
 * fall back to broadcast-first-hit (GET only — non-GET without scope is
 * ambiguous and rejected).
 */
export async function forwardRequest(registry: NodeRegistry, req: ProxyRequest): Promise<ProxyResult> {
  if (req.method === 'GET' && (req.path === '/api/projects' || req.path === '/api/projects/')) {
    return fanOutProjects(registry)
  }

  const project = projectFromRequest(req.path, req.query)
  let node: HubLink | undefined
  if (project) {
    node = registry.forProject(project)
    if (!node) {
      return jsonResult(503, { error: { message: `no connected node serves project "${project}"` } })
    }
  } else {
    const all = registry.list()
    if (all.length === 0) return jsonResult(503, { error: { message: 'no nodes connected' } })
    if (all.length === 1) {
      node = all[0]
    } else if (req.method === 'GET') {
      return broadcastFirstHit(all, req)
    } else {
      return jsonResult(409, {
        error: { message: 'ambiguous target node for a non-GET request without project scope' },
      })
    }
  }

  try {
    const res = await node!.call({
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      headers: req.headers,
    })
    return { status: res.status, body: res.body, headers: res.headers }
  } catch (e) {
    return jsonResult(503, { error: { message: `node "${node!.name}" unavailable: ${(e as Error).message}` } })
  }
}
