// @vitest-environment node
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { LookedUpAccount } from '../auth/identity'
import { __resetForTests } from '../auth/rate-limit'
import { createTicketAttachGateway } from './attach-gateway'
import { type TicketBroker, TicketError } from './broker'

const ADA: LookedUpAccount = { id: 2, username: 'ada', level: 'admin', disabled: false, grants: [] }
const BOB: LookedUpAccount = { id: 3, username: 'bob', level: 'admin', disabled: false, grants: [] }
const USER: LookedUpAccount = { id: 4, username: 'uma', level: 'user', disabled: false, grants: [] }
const TOKENS: Record<string, LookedUpAccount> = { mtk_ada: ADA, mtk_bob: BOB, mtk_uma: USER }

let server: Server
let port: number

beforeEach(async () => {
  __resetForTests()
  const broker = {
    async attachTarget(id: string, actor: { accountId: number }, task: string | null) {
      if (id === 'tk_released000') throw new TicketError('CONFLICT', 'ticket is RELEASED')
      if (actor.accountId !== 2) throw new TicketError('NOT_FOUND', `ticket ${id} does not exist`)
      return { address: `node-01/${task ?? 'shell'}`, task: task ?? 'sh-1' }
    },
  } as unknown as TicketBroker
  const gateway = createTicketAttachGateway({
    runtimeAuth: {
      username: 'owner',
      password: 'pw',
      sessionSecret: 'secret',
      accounts: {
        byId: async () => null,
        byToken: async (value) => TOKENS[value] ?? null,
      },
    },
    broker: () => broker,
    // Echo instead of `hc attach`: proves the PTY relay both ways.
    attachCommand: () => ['sh', '-c', 'stty -echo; head -n1; exit 3'],
  })
  server = createServer((_req, res) => res.end())
  server.on('upgrade', async (req, socket, head) => {
    if (!(await gateway.upgrade(req, socket, head))) socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function open(path: string, token: string) {
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

function refusal(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('error', () => resolve(-1))
  })
}

describe('ticket attach gateway', () => {
  it('relays a terminal both ways for the owner and reports its exit', async () => {
    const ws = open('/api/gpu-pool/tickets/tk_7h3q9m2xw4ra/attach?task=train', 'mtk_ada')
    let output = ''
    const exit = await new Promise<number>((resolve, reject) => {
      ws.on('open', () => ws.send(Buffer.from('hello\n'), { binary: true }))
      ws.on('message', (data, isBinary) => {
        if (isBinary) output += data.toString()
        else resolve((JSON.parse(data.toString()) as { code: number }).code)
      })
      ws.on('error', reject)
    })
    expect(output).toContain('hello')
    expect(exit).toBe(3)
  })

  it('refuses other admins, non-cluster accounts, bad tokens and released tickets', async () => {
    const path = '/api/gpu-pool/tickets/tk_7h3q9m2xw4ra/attach'
    expect(await refusal(open(path, 'mtk_bob'))).toBe(404)
    expect(await refusal(open(path, 'mtk_uma'))).toBe(403)
    expect(await refusal(open(path, 'mtk_nope'))).toBe(401)
    expect(await refusal(open('/api/gpu-pool/tickets/tk_released000/attach', 'mtk_ada'))).toBe(409)
  })
})
