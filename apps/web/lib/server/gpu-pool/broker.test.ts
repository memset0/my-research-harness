// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseNodes } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TicketBroker, TicketError } from './broker'
import type { HcResult, Herdr, HerdrTerminal } from './herdr'
import { TicketStore } from './store'

const NODES = parseNodes({
  schema_version: 1,
  nodes: {
    'node-01': {
      cluster: 'cluster-a',
      gpus: 4,
      gpu_type: 'GB200',
      allocation: 'node',
      available_until: '2099-01-01T00:00:00Z',
      ssh: { target: 'user@login.example' },
      enter: ['srun', '--jobid=12345', '--overlap', '-u', '--chdir=/tmp', '-N1', '-n1'],
    },
  },
})

class FakeHerdr implements Herdr {
  busy = new Set<number>()
  steps: Array<{ id: string; name: string }> = []
  terminalsByTicket = new Map<string, HerdrTerminal[]>()
  calls: string[][] = []
  connected = true

  async machines() {
    return [{ name: 'node-01', state: this.connected ? 'connected' : 'connecting' }]
  }

  async exec(_machine: string, argv: string[]): Promise<HcResult> {
    this.calls.push(argv)
    if (argv[0] === 'scontrol') {
      const stdout = this.steps.map((s) => `StepId=${s.id} UserId=1\n   Name=${s.name}`).join('\n')
      return { code: 0, stdout, stderr: '' }
    }
    if (argv[0] === 'scancel') {
      const cancelled = new Set(argv.slice(1))
      this.steps = this.steps.filter((s) => !cancelled.has(s.id))
      this.busy.clear()
      return { code: 0, stdout: '', stderr: '' }
    }
    const lines = [0, 1, 2, 3].map((i) => `${i}, GPU-${i}, ${this.busy.has(i) ? 40000 : 0}`)
    const apps = [...this.busy].map((i) => `GPU-${i}`)
    return { code: 0, stdout: [...lines, '__MEMON_APPS__', ...apps, ''].join('\n'), stderr: '' }
  }

  async runBackground(
    _machine: string,
    argv: string[],
    options: { name: string; labels: Record<string, string> },
  ) {
    this.calls.push(argv)
    const id = options.labels.ticket as string
    const address = `node-01/${options.name}`
    this.terminalsByTicket.set(id, [
      ...(this.terminalsByTicket.get(id) ?? []),
      { address, name: options.name, state: 'live', exitCode: null },
    ])
    const n = 20 + this.steps.length
    this.steps.push({ id: `12345.${n}`, name: argv[argv.indexOf('-J') + 1] as string })
    for (const gpu of [0, 1, 2, 3]) this.busy.add(gpu)
    return address
  }

  async terminals(ticketId: string) {
    return this.terminalsByTicket.get(ticketId) ?? []
  }

  async kill(address: string) {
    this.calls.push(['kill', address])
    for (const list of this.terminalsByTicket.values())
      for (const t of list) if (t.address === address) t.state = 'finished'
  }

  async remove(address: string) {
    this.calls.push(['rm', address])
    for (const [id, list] of this.terminalsByTicket)
      this.terminalsByTicket.set(
        id,
        list.filter((t) => t.address !== address),
      )
  }
}

let dir: string
let store: TicketStore
let herdr: FakeHerdr
let now: Date
let broker: TicketBroker

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memon-gpu-pool-'))
  store = new TicketStore(join(dir, 'pool.sqlite3'))
  herdr = new FakeHerdr()
  now = new Date('2026-12-01T00:00:00Z')
  broker = new TicketBroker({
    store,
    herdr,
    nodes: async () => NODES,
    now: () => now,
    log: () => {},
  })
})

afterEach(async () => {
  broker.stop()
  await store.close()
  await rm(dir, { recursive: true, force: true })
})

const request = (body: Record<string, unknown>) =>
  broker.request({ project: 'project-a', duration_s: 3600, ...body })

describe('TicketBroker', () => {
  it('validates requests', async () => {
    await expect(request({ gpus: 2, whole_node: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(
      broker.request({ project: 'project-a', gpus: 1, duration_s: 5 }),
    ).rejects.toBeInstanceOf(TicketError)
    expect(await store.list()).toEqual([])
  })

  it('grants a whole node, starts the command inside its own step, and reclaims it on release', async () => {
    const queued = await request({ whole_node: true, run: 'python train.py' })
    expect(queued).toMatchObject({ id: 'T0001', status: 'QUEUED' })
    await broker.tick()
    const granted = await broker.get('T0001')
    expect(granted).toMatchObject({ status: 'GRANTED', node: 'node-01', grantedGpus: [0, 1, 2, 3] })
    expect(granted.expiresAtMs).toBe(now.getTime() + 3600_000)
    const launched = herdr.calls.find((c) => c.includes('srun')) as string[]
    expect(launched.slice(0, 3)).toEqual([
      'env',
      'CUDA_VISIBLE_DEVICES=0,1,2,3',
      'MEMON_TICKET=T0001',
    ])
    expect(launched.slice(-5)).toEqual(['-J', 'memon-task-T0001', 'bash', '-c', 'python train.py'])

    herdr.steps.push({ id: '12345.18', name: 'herdr-core' })
    const released = await broker.release('T0001')
    expect(released.status).toBe('RELEASED')
    expect(herdr.calls).toContainEqual(['scancel', '12345.20'])
    expect(herdr.steps).toEqual([{ id: '12345.18', name: 'herdr-core' }])
    expect(await herdr.terminals('T0001')).toEqual([])
    expect(await store.dirty()).toEqual([])
  })

  it('refuses partial requests on whole-node nodes', async () => {
    await request({ gpus: 2 })
    await broker.tick()
    expect(await broker.get('T0001')).toMatchObject({ status: 'FAILED' })
  })

  it('expires tickets, and marks GPUs dirty when processes survive', async () => {
    await request({ whole_node: true })
    await broker.tick()
    herdr.busy.add(2)
    now = new Date(now.getTime() + 3601_000)
    await broker.tick()
    expect(await broker.get('T0001')).toMatchObject({ status: 'EXPIRED' })
    expect((await store.dirty()).map((d) => d.gpu)).toEqual([2])

    await request({ whole_node: true })
    await broker.tick()
    expect(await broker.get('T0002')).toMatchObject({ status: 'QUEUED' })
    herdr.busy.clear()
    await broker.tick()
    expect(await store.dirty()).toEqual([])
    expect(await broker.get('T0002')).toMatchObject({ status: 'GRANTED' })
  })

  it('keeps an expired ticket open while its node cannot be reached', async () => {
    await request({ whole_node: true })
    await broker.tick()
    herdr.connected = false
    now = new Date(now.getTime() + 3601_000)
    await broker.tick()
    const ticket = await broker.get('T0001')
    expect(ticket.status).toBe('GRANTED')
    expect(ticket.reason).toMatch(/expiry reclaim pending/)
  })

  it('reports unticketed GPU use without granting busy GPUs', async () => {
    herdr.busy.add(1)
    await request({ whole_node: true })
    await broker.tick()
    expect(broker.unticketed).toMatchObject([{ node: 'node-01', gpu: 1, processes: 1 }])
    expect(await broker.get('T0001')).toMatchObject({ status: 'QUEUED' })
  })

  it('refuses launch templates for tickets that are not granted', async () => {
    await request({ whole_node: true })
    await expect(broker.template('T0001')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(broker.get('T0099')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
