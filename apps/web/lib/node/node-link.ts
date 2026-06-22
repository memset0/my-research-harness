// Node side of the transport: announce `hello`, answer `req` frames by
// dispatching onto the node's route handlers, and relay runtime events.
// See openspec/changes/add-hub-node-split (hub-node-transport).

import type { FrameSocket } from '../hub-node/connection'
import { decodeFrame, encodeFrame, type NodeHello, type RpcRequest } from '../hub-node/protocol'
import type { DispatchResult } from './dispatch'

export interface NodeLinkOpts {
  hello: NodeHello
  dispatch: (req: RpcRequest) => Promise<DispatchResult>
  onClose?: () => void
}

export class NodeLink {
  private closed = false

  constructor(
    private readonly socket: FrameSocket,
    private readonly opts: NodeLinkOpts,
  ) {
    socket.onMessage((raw) => void this.onMessage(raw))
    socket.onClose(() => {
      if (this.closed) return
      this.closed = true
      opts.onClose?.()
    })
    // Advertise this node to the hub immediately.
    socket.send(encodeFrame(opts.hello))
  }

  private async onMessage(raw: string): Promise<void> {
    let frame
    try {
      frame = decodeFrame(raw)
    } catch {
      return
    }
    if (frame.kind !== 'req') return
    const req = frame as RpcRequest
    let result: DispatchResult
    try {
      result = await this.opts.dispatch(req)
    } catch (e) {
      result = {
        status: 500,
        body: JSON.stringify({ error: { message: (e as Error).message } }),
      }
    }
    if (this.closed) return
    try {
      this.socket.send(
        encodeFrame({
          kind: 'res',
          id: req.id,
          status: result.status,
          body: result.body,
          headers: result.headers,
        }),
      )
    } catch {
      /* socket gone between dispatch and reply */
    }
  }

  /** Push a runtime event to the hub (fanned out to browsers via SSE). */
  relayEvent(topic: string, data: unknown): void {
    if (this.closed) return
    try {
      this.socket.send(encodeFrame({ kind: 'event', topic, data }))
    } catch {
      /* socket gone */
    }
  }

  close(): void {
    this.socket.close()
  }
}
