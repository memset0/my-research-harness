// A tiny string-frame socket abstraction over the hub<->node WebSocket, so the
// link logic (RPC correlation, hello gating, event relay) is testable with an
// in-memory pair and production just plugs in a `ws` WebSocket.
// See openspec/changes/add-hub-node-split.

import type { WebSocket as WsSocket } from 'ws'

export interface FrameSocket {
  send(data: string): void
  close(): void
  onMessage(cb: (data: string) => void): void
  onClose(cb: () => void): void
}

/** Adapt a `ws` WebSocket (server- or client-side) to a FrameSocket. */
export function wsToFrameSocket(ws: WsSocket): FrameSocket {
  return {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onMessage: (cb) =>
      ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) =>
        cb(Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString()),
      ),
    onClose: (cb) => ws.on('close', cb),
  }
}

/**
 * Two cross-wired in-memory FrameSockets for tests: a frame `send` on one is
 * delivered (async, microtask — to mimic real ordering) to the other's message
 * handlers. Closing either closes both.
 */
export function makeSocketPair(): [FrameSocket, FrameSocket] {
  const ends = [
    { msg: [] as ((d: string) => void)[], close: [] as (() => void)[] },
    { msg: [] as ((d: string) => void)[], close: [] as (() => void)[] },
  ]
  let closed = false
  const make = (self: 0 | 1): FrameSocket => {
    const other = self === 0 ? 1 : 0
    return {
      send: (d) => {
        if (!closed) queueMicrotask(() => ends[other]!.msg.forEach((cb) => cb(d)))
      },
      close: () => {
        if (closed) return
        closed = true
        queueMicrotask(() => {
          ends[0]!.close.forEach((cb) => cb())
          ends[1]!.close.forEach((cb) => cb())
        })
      },
      onMessage: (cb) => ends[self]!.msg.push(cb),
      onClose: (cb) => ends[self]!.close.push(cb),
    }
  }
  return [make(0), make(1)]
}
