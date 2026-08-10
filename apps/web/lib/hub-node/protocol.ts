// RPC envelope for the hub <-> node WebSocket (one persistent socket per node).
// See openspec/changes/add-hub-node-split (hub-node-transport). The hub frames
// proxied browser requests as `req`; the headless node replies with `res` for
// the matching `id`, and pushes `event` frames (relayed runtime events) plus a
// one-time `hello` right after the handshake.

/** Hub -> node: a proxied browser request to run against the node's handlers. */
export interface RpcRequest {
  kind: 'req'
  /** Correlation id, unique per in-flight request on this socket. */
  id: number
  method: string
  /** Path without query string, e.g. `/api/runs`. */
  path: string
  query?: Record<string, string>
  /** Raw request body for write methods (already serialized). */
  body?: string
  headers?: Record<string, string>
}

/** Node -> hub: the response to a prior {@link RpcRequest} with the same id. */
export interface RpcResponse {
  kind: 'res'
  id: number
  status: number
  /** Raw response body (usually JSON text). */
  body: string
  /** Binary responses are base64 inside the JSON WebSocket envelope. */
  bodyEncoding?: 'base64'
  headers?: Record<string, string>
}

/** Node -> hub: a relayed runtime event, fanned out to browsers via SSE. */
export interface RpcEvent {
  kind: 'event'
  /** `run-change` | `experiment-change` | `anomaly` | `code-reviews-change` */
  topic: string
  data: unknown
}

/** Node -> hub: sent once right after the handshake to advertise the node. */
export interface NodeHello {
  kind: 'hello'
  name: string
  capabilities: { tmux: boolean; projects: boolean }
  /** Project names this node serves (for the hub's project->node routing). */
  projects: string[]
}

export type HubToNode = RpcRequest
export type NodeToHub = RpcResponse | RpcEvent | NodeHello
export type Frame = HubToNode | NodeToHub

export function encodeFrame(msg: Frame): string {
  return JSON.stringify(msg)
}

export function decodeFrame(raw: string): Frame {
  return JSON.parse(raw) as Frame
}
