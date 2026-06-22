// @vitest-environment node
//
// Smoke test over a REAL ws server+client: verifies wsToFrameSocket + the dial
// + hello + RPC round-trip + event relay against an actual WebSocket (the
// in-memory pair is covered in hub-node/transport.test.ts).

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { wsToFrameSocket } from '../hub-node/connection'
import { HubLink, NodeRegistry } from '../hub/registry'
import { startNodeClient, type NodeClient } from './hub-client'

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

let client: NodeClient | undefined
let wss: WebSocketServer | undefined
afterEach(() => {
  client?.stop()
  wss?.close()
  client = undefined
  wss = undefined
})

describe('startNodeClient (real ws)', () => {
  it('dials, registers, round-trips RPC, relays events', async () => {
    const reg = new NodeRegistry()
    const relayed: Array<{ topic: string; data: unknown }> = []
    reg.setEventSink((_node, topic, data) => relayed.push({ topic, data }))

    wss = new WebSocketServer({ port: 0 })
    await new Promise<void>((r) => wss!.on('listening', () => r()))
    const port = (wss.address() as { port: number }).port

    let link: HubLink | undefined
    wss.on('connection', (ws) => {
      void reg.attach(wsToFrameSocket(ws)).then((l) => {
        link = l
      })
    })

    const events = new EventEmitter()
    client = startNodeClient({
      hubUrl: `ws://localhost:${port}`,
      name: 'm2',
      authToken: 'tok',
      capabilities: { tmux: true, projects: true },
      projects: ['project-a'],
      events,
      dispatch: async (req) => ({ status: 200, body: JSON.stringify({ path: req.path, q: req.query }) }),
    })

    await waitFor(() => link !== undefined)
    expect(link!.name).toBe('m2')
    expect(link!.projects).toEqual(['project-a'])

    const res = await link!.call({ method: 'GET', path: '/api/runs', query: { project: 'project-a' } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ path: '/api/runs', q: { project: 'project-a' } })

    events.emit('run-change', { id: 'r1' })
    await waitFor(() => relayed.length > 0)
    expect(relayed).toEqual([{ topic: 'run-change', data: { id: 'r1' } }])
  })
})
