// The node's outbound connection to the hub: dial `node.hub_url` + the connect
// path with a Bearer token, announce hello, answer RPC by dispatching onto the
// route handlers, relay runtime events, and reconnect with exponential backoff.
// See openspec/changes/add-hub-node-split (hub-node-transport).

import type { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { wsToFrameSocket } from '../hub-node/connection'
import type { NodeHello, RpcRequest } from '../hub-node/protocol'
import { dispatchRpc, type DispatchResult } from './dispatch'
import { NodeLink } from './node-link'

export const DEFAULT_CONNECT_PATH = '/api/hub/nodes/connect'

// Runtime topics relayed to the hub (mirror lib/runtime.ts emitters).
const RELAY_TOPICS = ['run-change', 'experiment-change', 'anomaly', 'code-reviews-change'] as const

export interface NodeClientOpts {
  /** Hub base URL, e.g. `ws://localhost:3737` (connect path is appended). */
  hubUrl: string
  name: string
  authToken: string
  capabilities: { tmux: boolean; projects: boolean }
  projects: string[]
  /** Runtime event emitter (rt.events) whose topics are relayed to the hub. */
  events?: EventEmitter
  /** Override the RPC dispatcher (tests inject a stub); defaults to dispatchRpc. */
  dispatch?: (req: RpcRequest) => Promise<DispatchResult>
  connectPath?: string
  backoffStartMs?: number
  backoffMaxMs?: number
}

export interface NodeClient {
  stop(): void
}

export function startNodeClient(opts: NodeClientOpts): NodeClient {
  const dispatch = opts.dispatch ?? dispatchRpc
  const connectPath = opts.connectPath ?? DEFAULT_CONNECT_PATH
  const url = opts.hubUrl.replace(/\/+$/, '') + connectPath
  const startMs = opts.backoffStartMs ?? 1000
  const maxMs = opts.backoffMaxMs ?? 30_000

  let stopped = false
  let backoff = startMs
  let ws: WebSocket | null = null
  let link: NodeLink | null = null

  // Attach event-relay listeners ONCE; they forward to whichever link is live.
  const relays: Array<[string, (d: unknown) => void]> = []
  if (opts.events) {
    for (const topic of RELAY_TOPICS) {
      const fn = (data: unknown) => link?.relayEvent(topic, data)
      opts.events.on(topic, fn)
      relays.push([topic, fn])
    }
  }

  function dial(): void {
    if (stopped) return
    const sock = new WebSocket(url, { headers: { authorization: `Bearer ${opts.authToken}` } })
    ws = sock
    sock.on('open', () => {
      backoff = startMs
      const hello: NodeHello = {
        kind: 'hello',
        name: opts.name,
        capabilities: opts.capabilities,
        projects: opts.projects,
      }
      link = new NodeLink(wsToFrameSocket(sock), { hello, dispatch })
      console.log(`[node] connected to hub as "${opts.name}" (${url})`)
    })
    sock.on('close', () => {
      link = null
      ws = null
      if (stopped) return
      const wait = backoff
      backoff = Math.min(backoff * 2, maxMs)
      setTimeout(dial, wait)
    })
    sock.on('error', (err: Error) => {
      // 'close' fires after 'error' and drives the reconnect.
      console.error(`[node] hub ws error: ${err.message}`)
    })
  }

  dial()

  return {
    stop() {
      stopped = true
      if (opts.events) for (const [t, fn] of relays) opts.events.off(t, fn)
      ws?.close()
    },
  }
}
