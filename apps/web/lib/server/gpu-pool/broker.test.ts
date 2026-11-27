// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseNodes, TICKET_ID_PATTERN } from '@memon/core'
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

  async ticketTerminals() {
    return new Map(this.terminalsByTicket)
  }

  async kill(address: string) {
    this.calls.push(['kill', address])
    for (const list of this.terminalsByTicket.values())
      for (const t of list) if (t.address === address) t.state = 'finished'
  }

  async read(address: string, lines: number) {
    this.calls.push(['read', address, String(lines)])
    return `screen of ${address}\n`
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
    expect(queued).toMatchObject({ status: 'QUEUED' })
    expect(queued.id).toMatch(TICKET_ID_PATTERN)
    await broker.tick()
    const granted = await broker.get(queued.id)
    expect(granted).toMatchObject({ status: 'GRANTED', node: 'node-01', grantedGpus: [0, 1, 2, 3] })
    expect(granted.expiresAtMs).toBe(now.getTime() + 3600_000)
    const launched = herdr.calls.find((c) => c.includes('srun')) as string[]
    expect(launched.slice(0, 3)).toEqual([
      'env',
      'CUDA_VISIBLE_DEVICES=0,1,2,3',
      `MEMON_TICKET=${queued.id}`,
    ])
    expect(launched.slice(-5)).toEqual([
      '-J',
      `memon-task-${queued.id}`,
      'bash',
      '-c',
      'python train.py',
    ])

    herdr.steps.push({ id: '12345.18', name: 'herdr-core' })
    const released = await broker.release(queued.id)
    expect(released.status).toBe('RELEASED')
    expect(herdr.calls).toContainEqual(['scancel', '12345.20'])
    expect(herdr.steps).toEqual([{ id: '12345.18', name: 'herdr-core' }])
    expect(await herdr.terminals(queued.id)).toEqual([])
    expect(await store.dirty()).toEqual([])
  })

  it('refuses partial requests on whole-node nodes', async () => {
    const { id } = await request({ gpus: 2 })
    await broker.tick()
    expect(await broker.get(id)).toMatchObject({ status: 'FAILED' })
  })

  it('expires tickets, and marks GPUs dirty when processes survive', async () => {
    const first = await request({ whole_node: true })
    await broker.tick()
    herdr.busy.add(2)
    now = new Date(now.getTime() + 3601_000)
    await broker.tick()
    expect(await broker.get(first.id)).toMatchObject({ status: 'EXPIRED' })
    expect((await store.dirty()).map((d) => d.gpu)).toEqual([2])

    const second = await request({ whole_node: true })
    expect(second.id).not.toBe(first.id)
    await broker.tick()
    expect(await broker.get(second.id)).toMatchObject({ status: 'QUEUED' })
    herdr.busy.clear()
    await broker.tick()
    expect(await store.dirty()).toEqual([])
    expect(await broker.get(second.id)).toMatchObject({ status: 'GRANTED' })
  })

  it('keeps an expired ticket open while its node cannot be reached', async () => {
    const { id } = await request({ whole_node: true })
    await broker.tick()
    herdr.connected = false
    now = new Date(now.getTime() + 3601_000)
    await broker.tick()
    const ticket = await broker.get(id)
    expect(ticket.status).toBe('GRANTED')
    expect(ticket.reason).toMatch(/expiry reclaim pending/)
  })

  it('reports unticketed GPU use without granting busy GPUs', async () => {
    herdr.busy.add(1)
    const { id } = await request({ whole_node: true })
    await broker.tick()
    expect(broker.unticketed).toMatchObject([{ node: 'node-01', gpu: 1, processes: 1 }])
    expect(await broker.get(id)).toMatchObject({ status: 'QUEUED' })
  })

  it('refuses launch templates for tickets that are not granted', async () => {
    const { id } = await request({ whole_node: true })
    await expect(broker.template(id)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(broker.get('tk_0000000000zz')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('TicketStore files', () => {
  it('creates the database and its WAL files owner-only', async () => {
    const { statSync, existsSync } = await import('node:fs')
    await store.list()
    for (const file of [store.path, `${store.path}-wal`, `${store.path}-shm`])
      if (existsSync(file)) expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(store.path).mode & 0o777).toBe(0o600)
  })

  it('replaces sequential ids of tickets stored before random ids', async () => {
    const sqlite3 = (await import('sqlite3')).default
    const path = join(dir, 'legacy.sqlite3')
    const legacy = new sqlite3.Database(path)
    await new Promise<void>((resolve, reject) =>
      legacy.exec(
        `CREATE TABLE tickets (
           seq INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, gpus INTEGER,
           whole_node INTEGER NOT NULL, gpu_type TEXT, duration_s INTEGER NOT NULL, label TEXT,
           run TEXT, status TEXT NOT NULL, node TEXT, granted_gpus TEXT NOT NULL DEFAULT '[]',
           requested_at TEXT NOT NULL, requested_at_ms INTEGER NOT NULL, granted_at TEXT,
           expires_at TEXT, expires_at_ms INTEGER, ended_at TEXT, reason TEXT);
         INSERT INTO tickets (project, whole_node, duration_s, status, requested_at, requested_at_ms)
           VALUES ('project-a', 1, 60, 'RELEASED', '2026-11-25T00:00:00+00:00', 0);`,
        (error) => (error ? reject(error) : resolve()),
      ),
    )
    await new Promise<void>((resolve) => legacy.close(() => resolve()))

    const upgraded = new TicketStore(path)
    try {
      const [migrated] = await upgraded.list()
      expect(migrated).toMatchObject({ project: 'project-a', status: 'RELEASED' })
      expect(migrated?.id).toMatch(TICKET_ID_PATTERN)
      expect(await upgraded.get('T0001')).toBeNull()
      const fresh = await upgraded.create(
        { project: 'project-a', wholeNode: true, durationS: 60 },
        new Date(),
      )
      expect((await upgraded.list()).map((ticket) => ticket.id)).toEqual([migrated?.id, fresh.id])
    } finally {
      await upgraded.close()
    }
  })
})

describe('ticket ownership and execution', () => {
  const ADA = { accountId: 2, username: 'ada', superAdmin: false }
  const BOB = { accountId: 3, username: 'bob', superAdmin: false }
  const ROOT = { accountId: 1, username: 'owner', superAdmin: true }
  const own = (actor: typeof ADA) => ({ accountId: actor.accountId, username: actor.username })

  it('lets only the owner act, and the super admin only with force', async () => {
    const { id } = await broker.request(
      { project: 'project-a', duration_s: 3600, whole_node: true },
      own(ADA),
    )
    await broker.tick()
    expect((await broker.get(id)).owner).toEqual({ accountId: 2, username: 'ada' })
    await expect(broker.release(id, BOB)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(broker.tasks(id, BOB)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(broker.release(id, ROOT)).rejects.toMatchObject({ code: 'OWNER_MISMATCH' })
    expect((await broker.get(id)).status).toBe('GRANTED')

    const released = await broker.release(id, ROOT, true)
    expect(released.status).toBe('RELEASED')
    expect(released.forced).toMatch(/^release by owner at /)
  })

  it('starts, lists, reads, waits on and kills tasks inside the ticket only', async () => {
    const { id } = await broker.request(
      { project: 'project-a', duration_s: 3600, whole_node: true },
      own(ADA),
    )
    await broker.tick()
    const started = await broker.startNamedTask(id, ADA, { name: 'train', command: 'python t.py' })
    expect(started).toMatchObject({ task: 'train', state: 'live' })
    const launched = herdr.calls.at(-1) as string[]
    expect(launched).toContain(`MEMON_TICKET=${id}`)
    expect(launched.slice(-3)).toEqual(['bash', '-c', 'python t.py'])
    await expect(
      broker.startNamedTask(id, ADA, { name: 'train', command: 'x' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      broker.startNamedTask(id, ADA, { name: 'Bad Name', command: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect((await broker.tasks(id, ADA)).map((t) => t.task)).toEqual(['train'])
    expect(await broker.taskLogs(id, ADA, 'train', 50)).toContain(started.address)
    await expect(broker.taskLogs(id, ADA, 'other', 50)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect((await broker.waitTask(id, ADA, 'train', 0)).state).toBe('live')
    expect((await broker.killTask(id, ADA, 'train')).state).toBe('finished')
    expect((await broker.waitTask(id, ADA, 'train', 5)).state).toBe('finished')

    const plan = await broker.execPlan(id, ADA, {
      command: 'nvidia-smi -L',
      timeoutS: 30,
      stdin: true,
    })
    expect(plan.slice(0, 6)).toEqual(['exec', '-i', '--on', 'node-01', '--timeout', '30'])
    expect(plan).toContain('CUDA_VISIBLE_DEVICES=0,1,2,3')
    expect(plan.slice(-3)).toEqual(['bash', '-c', 'nvidia-smi -L'])

    const shell = await broker.attachTarget(id, ADA, null)
    expect(shell.task).toMatch(/^sh-/)
    expect((await broker.attachTarget(id, ADA, 'train')).address).toBe(started.address)

    await broker.release(id, ADA)
    await expect(
      broker.execPlan(id, ADA, { command: 'ls', timeoutS: 5, stdin: false }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
