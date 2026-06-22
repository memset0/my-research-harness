// Hub side of the transport: a per-node link (id-correlated RPC over one WS,
// hello-gated, event relay) and the registry of connected nodes.
// See openspec/changes/add-hub-node-split (hub-node-transport).

import type { FrameSocket } from '../hub-node/connection'
import {
  decodeFrame,
  encodeFrame,
  type RpcRequest,
  type RpcResponse,
} from '../hub-node/protocol'

const DEFAULT_CALL_TIMEOUT_MS = 15_000

export interface HubLinkOpts {
  onEvent?: (topic: string, data: unknown) => void
  onClose?: () => void
  callTimeoutMs?: number
}

/** One connected node, as seen from the hub. Resolves `ready` after `hello`. */
export class HubLink {
  name = ''
  capabilities = { tmux: false, projects: false }
  projects: string[] = []
  readonly ready: Promise<void>

  private resolveReady!: () => void
  private rejectReady!: (e: Error) => void
  private gotHello = false
  private closed = false
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (r: RpcResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  constructor(
    private readonly socket: FrameSocket,
    private readonly opts: HubLinkOpts = {},
  ) {
    this.ready = new Promise<void>((res, rej) => {
      this.resolveReady = res
      this.rejectReady = rej
    })
    socket.onMessage((raw) => this.onMessage(raw))
    socket.onClose(() => this.onClosed())
  }

  private onMessage(raw: string): void {
    let frame
    try {
      frame = decodeFrame(raw)
    } catch {
      return
    }
    if (frame.kind === 'hello') {
      this.name = frame.name
      this.capabilities = frame.capabilities
      this.projects = frame.projects
      this.gotHello = true
      this.resolveReady()
    } else if (frame.kind === 'res') {
      const p = this.pending.get(frame.id)
      if (p) {
        clearTimeout(p.timer)
        this.pending.delete(frame.id)
        p.resolve(frame)
      }
    } else if (frame.kind === 'event') {
      this.opts.onEvent?.(frame.topic, frame.data)
    }
  }

  private onClosed(): void {
    if (this.closed) return
    this.closed = true
    const err = new Error('node connection closed')
    if (!this.gotHello) this.rejectReady(err)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
    this.opts.onClose?.()
  }

  /** Forward a request to the node and resolve with its response. */
  call(fields: Omit<RpcRequest, 'kind' | 'id'>): Promise<RpcResponse> {
    if (this.closed) return Promise.reject(new Error('node unavailable'))
    const id = this.nextId++
    const req: RpcRequest = { kind: 'req', id, ...fields }
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`node "${this.name}" timed out on ${fields.method} ${fields.path}`))
      }, this.opts.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.socket.send(encodeFrame(req))
      } catch (e) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(e as Error)
      }
    })
  }

  close(): void {
    this.socket.close()
  }
}

export type NodeEventSink = (node: string, topic: string, data: unknown) => void

/** The hub's in-memory map of connected nodes. */
export class NodeRegistry {
  private nodes = new Map<string, HubLink>()
  private eventSink?: NodeEventSink

  /** Where relayed node events go (wired to the browser SSE fan-out). */
  setEventSink(fn: NodeEventSink): void {
    this.eventSink = fn
  }

  /**
   * Wrap a freshly-upgraded socket, wait for its `hello`, and register it under
   * its node name (replacing any prior connection with the same name). Rejects
   * if the socket closes before sending `hello`.
   */
  async attach(socket: FrameSocket, opts?: { callTimeoutMs?: number }): Promise<HubLink> {
    const link: HubLink = new HubLink(socket, {
      callTimeoutMs: opts?.callTimeoutMs,
      onEvent: (topic, data) => this.eventSink?.(link.name, topic, data),
      onClose: () => {
        if (this.nodes.get(link.name) === link) this.nodes.delete(link.name)
      },
    })
    await link.ready
    const prev = this.nodes.get(link.name)
    if (prev && prev !== link) prev.close()
    this.nodes.set(link.name, link)
    return link
  }

  get(name: string): HubLink | undefined {
    return this.nodes.get(name)
  }
  list(): HubLink[] {
    return [...this.nodes.values()]
  }
  projectNodes(): HubLink[] {
    return this.list().filter((n) => n.capabilities.projects)
  }
  tmuxNodes(): HubLink[] {
    return this.list().filter((n) => n.capabilities.tmux)
  }
  /** The node that owns a project (first match), or undefined if none/offline. */
  forProject(project: string): HubLink | undefined {
    return this.list().find((n) => n.projects.includes(project))
  }
}
