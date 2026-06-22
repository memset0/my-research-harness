import { describe, expect, it } from 'vitest'
import {
  decodeFrame,
  encodeFrame,
  type NodeHello,
  type RpcEvent,
  type RpcRequest,
  type RpcResponse,
} from './protocol'

describe('rpc protocol frames', () => {
  it('round-trips a request frame', () => {
    const req: RpcRequest = {
      kind: 'req',
      id: 7,
      method: 'GET',
      path: '/api/runs',
      query: { project: 'a' },
    }
    expect(decodeFrame(encodeFrame(req))).toEqual(req)
  })

  it('round-trips a response frame', () => {
    const res: RpcResponse = { kind: 'res', id: 7, status: 200, body: '{"experiments":[]}' }
    expect(decodeFrame(encodeFrame(res))).toEqual(res)
  })

  it('round-trips an event frame', () => {
    const ev: RpcEvent = { kind: 'event', topic: 'run-change', data: { id: 'r1', type: 'set' } }
    expect(decodeFrame(encodeFrame(ev))).toEqual(ev)
  })

  it('round-trips a hello frame', () => {
    const hello: NodeHello = {
      kind: 'hello',
      name: 'nvl72',
      capabilities: { tmux: true, projects: true },
      projects: ['project-a', 'project-b'],
    }
    expect(decodeFrame(encodeFrame(hello))).toEqual(hello)
  })
})
