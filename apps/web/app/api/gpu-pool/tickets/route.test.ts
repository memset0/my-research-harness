// @vitest-environment node
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const broker = {
  start: vi.fn(),
  list: vi.fn(),
  dirty: vi.fn(),
  request: vi.fn(),
  get: vi.fn(),
  template: vi.fn(),
  release: vi.fn(),
  unticketed: [],
  lastTick: null,
}

vi.mock('@/lib/server/runtime', () => ({
  getRuntime: async () => ({ configPath: '/tmp/x/config.yml' }),
}))
vi.mock('@/lib/server/gpu-pool/broker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/gpu-pool/broker')>()),
  getTicketBroker: () => broker,
}))

import { TicketError } from '@/lib/server/gpu-pool/broker'
import { POST as RELEASE } from './[id]/release/route'
import { GET as SHOW } from './[id]/route'
import { GET, POST } from './route'

const req = (role: string, method = 'GET', body?: unknown) =>
  new NextRequest('http://localhost/api/gpu-pool/tickets', {
    method,
    headers: { 'x-memon-role': role, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const ticket = {
  id: 'tk_7h3q9m2xw4ra',
  project: 'project-a',
  status: 'GRANTED',
  gpus: null,
  wholeNode: true,
  gpuType: null,
  durationS: 3600,
  label: null,
  run: null,
  node: 'node-01',
  grantedGpus: [0, 1],
  requestedAt: 'a',
  requestedAtMs: 0,
  grantedAt: 'b',
  expiresAt: 'c',
  expiresAtMs: 1,
  endedAt: null,
  reason: null,
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  for (const fn of Object.values(broker))
    if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
})

describe('/api/gpu-pool/tickets', () => {
  it('denies viewers and anonymous requests before touching the broker', async () => {
    for (const role of ['viewer', 'anon']) {
      expect((await GET(req(role))).status).toBe(403)
      expect((await POST(req(role, 'POST', {}))).status).toBe(403)
    }
    expect(broker.start).not.toHaveBeenCalled()
  })

  it('queues a request for the owner with 201', async () => {
    broker.request.mockResolvedValue({ ...ticket, status: 'QUEUED' })
    const response = await POST(
      req('owner', 'POST', { project: 'project-a', whole_node: true, duration_s: 3600 }),
    )
    expect(response.status).toBe(201)
    expect((await response.json()).ticket).toMatchObject({
      id: 'tk_7h3q9m2xw4ra',
      status: 'QUEUED',
      whole_node: true,
    })
  })

  it('maps broker errors to HTTP statuses', async () => {
    broker.request.mockRejectedValue(new TicketError('BAD_REQUEST', 'bad'))
    expect((await POST(req('owner', 'POST', {}))).status).toBe(400)
    broker.get.mockRejectedValue(new TicketError('NOT_FOUND', 'missing'))
    expect((await SHOW(req('owner'), params('tk_0000000000zz'))).status).toBe(404)
    broker.release.mockRejectedValue(new TicketError('CONFLICT', 'done'))
    expect((await RELEASE(req('owner', 'POST'), params('tk_7h3q9m2xw4ra'))).status).toBe(409)
  })

  it('includes the launch template for granted tickets', async () => {
    broker.get.mockResolvedValue(ticket)
    broker.template.mockResolvedValue({
      machine: 'node-01',
      exec: ['env'],
      run: ['env'],
      holdJob: null,
    })
    const body = await (await SHOW(req('owner'), params('tk_7h3q9m2xw4ra'))).json()
    expect(body.launch).toMatchObject({ machine: 'node-01' })
    expect(body.ticket.granted_gpus).toEqual([0, 1])
  })
})
