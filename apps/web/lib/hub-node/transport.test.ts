import { describe, expect, it } from 'vitest'
import { HubLink, NodeRegistry } from '../hub/registry'
import { NodeLink } from '../node/node-link'
import { makeSocketPair } from './connection'
import type { NodeHello } from './protocol'

const hello: NodeHello = {
  kind: 'hello',
  name: 'm2',
  capabilities: { tmux: true, projects: true },
  projects: ['p'],
}

describe('hub<->node transport', () => {
  it('hello + RPC round-trip + event relay', async () => {
    const [hubSock, nodeSock] = makeSocketPair()
    const events: Array<{ topic: string; data: unknown }> = []
    const hub = new HubLink(hubSock, { onEvent: (topic, data) => events.push({ topic, data }) })
    new NodeLink(nodeSock, {
      hello,
      dispatch: async (req) => ({ status: 200, body: JSON.stringify({ echoed: req.path, q: req.query }) }),
    })
    await hub.ready
    expect(hub.name).toBe('m2')
    expect(hub.capabilities).toEqual({ tmux: true, projects: true })
    expect(hub.projects).toEqual(['p'])

    const res = await hub.call({ method: 'GET', path: '/api/runs', query: { project: 'p' } })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ echoed: '/api/runs', q: { project: 'p' } })
  })

  it('relays node events to the hub', async () => {
    const [hubSock, nodeSock] = makeSocketPair()
    const events: Array<{ topic: string; data: unknown }> = []
    const hub = new HubLink(hubSock, { onEvent: (topic, data) => events.push({ topic, data }) })
    const node = new NodeLink(nodeSock, { hello, dispatch: async () => ({ status: 200, body: '{}' }) })
    await hub.ready
    node.relayEvent('run-change', { id: 'r1' })
    await new Promise((r) => setTimeout(r, 5))
    expect(events).toEqual([{ topic: 'run-change', data: { id: 'r1' } }])
  })

  it('call rejects once the node closes', async () => {
    const [hubSock, nodeSock] = makeSocketPair()
    const hub = new HubLink(hubSock)
    const node = new NodeLink(nodeSock, { hello, dispatch: async () => ({ status: 200, body: '{}' }) })
    await hub.ready
    node.close()
    await new Promise((r) => setTimeout(r, 5))
    await expect(hub.call({ method: 'GET', path: '/api/runs' })).rejects.toThrow(/unavailable/)
  })

  it('call times out when the node never responds', async () => {
    const [hubSock, nodeSock] = makeSocketPair()
    const hub = new HubLink(hubSock, { callTimeoutMs: 20 })
    new NodeLink(nodeSock, { hello, dispatch: () => new Promise<never>(() => {}) })
    await hub.ready
    await expect(hub.call({ method: 'GET', path: '/api/runs' })).rejects.toThrow(/timed out/)
  })

  it('NodeRegistry registers on hello, routes by project + capability, removes on close', async () => {
    const [hubSock, nodeSock] = makeSocketPair()
    const reg = new NodeRegistry()
    const node = new NodeLink(nodeSock, { hello, dispatch: async () => ({ status: 200, body: '{}' }) })
    const link = await reg.attach(hubSock)
    expect(link.name).toBe('m2')
    expect(reg.forProject('p')).toBe(link)
    expect(reg.tmuxNodes().map((n) => n.name)).toEqual(['m2'])
    expect(reg.projectNodes().map((n) => n.name)).toEqual(['m2'])
    node.close()
    await new Promise((r) => setTimeout(r, 5))
    expect(reg.get('m2')).toBeUndefined()
    expect(reg.forProject('p')).toBeUndefined()
  })
})
