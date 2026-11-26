import { allocatableGpuIndices, formatIsoLocal, loadNodes, type NodeDefinition } from '@memon/core'
import {
  createHerdr,
  type Herdr,
  holdJob,
  type LaunchTemplate,
  launchTemplate,
  parseSnapshot,
  parseSteps,
  SNAPSHOT_LINE,
  stepsToCancel,
  terminalName,
} from './herdr'
import { isIdle, type PoolNode, planGrants } from './planner'
import { gpuPoolDatabasePath, TicketStore } from './store'
import type { GpuSnapshot, Ticket, TicketRequest } from './types'

export class TicketError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

export const MIN_DURATION_S = 60
export const MAX_DURATION_S = 30 * 24 * 3600
const BASE_DELAY_MS = 15_000
const MAX_DELAY_MS = 5 * 60_000

export interface UnticketedUse {
  node: string
  gpu: number
  processes: number
  at: string
}

export interface BrokerDeps {
  store: TicketStore
  herdr: Herdr
  nodes: () => Promise<NodeDefinition[]>
  now?: () => Date
  log?: (message: string) => void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function parseTicketRequest(body: unknown): TicketRequest {
  const bad = (message: string) => new TicketError('BAD_REQUEST', message)
  if (!isRecord(body)) throw bad('request body must be a JSON object')
  const known = new Set(['project', 'gpus', 'whole_node', 'gpu_type', 'duration_s', 'label', 'run'])
  for (const key of Object.keys(body)) if (!known.has(key)) throw bad(`unknown field "${key}"`)
  const { project, gpus, whole_node, gpu_type, duration_s, label, run } = body
  if (typeof project !== 'string' || !/^[A-Za-z0-9._/-]{1,128}$/.test(project))
    throw bad('project must be a project name (letters, digits, . _ / -)')
  if (
    typeof duration_s !== 'number' ||
    !Number.isInteger(duration_s) ||
    duration_s < MIN_DURATION_S ||
    duration_s > MAX_DURATION_S
  )
    throw bad(`duration_s must be an integer between ${MIN_DURATION_S} and ${MAX_DURATION_S}`)
  const whole = whole_node === true
  if (whole_node !== undefined && typeof whole_node !== 'boolean')
    throw bad('whole_node must be a boolean')
  if (whole === (gpus !== undefined)) throw bad('name exactly one of gpus or whole_node')
  if (
    gpus !== undefined &&
    (typeof gpus !== 'number' || !Number.isInteger(gpus) || gpus < 1 || gpus > 64)
  )
    throw bad('gpus must be an integer between 1 and 64')
  if (
    gpu_type !== undefined &&
    (typeof gpu_type !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(gpu_type))
  )
    throw bad('gpu_type must be a short name such as H200')
  if (label !== undefined && (typeof label !== 'string' || label.length === 0 || label.length > 64))
    throw bad('label must be 1–64 characters')
  if (run !== undefined && (typeof run !== 'string' || run.trim() === '' || run.length > 8192))
    throw bad('run must be a non-empty shell line')
  return {
    project,
    durationS: duration_s,
    ...(whole ? { wholeNode: true } : { gpus: gpus as number }),
    ...(gpu_type !== undefined ? { gpuType: gpu_type as string } : {}),
    ...(label !== undefined ? { label: label as string } : {}),
    ...(run !== undefined ? { run: run as string } : {}),
  }
}

export class TicketBroker {
  unticketed: UnticketedUse[] = []
  lastTick: { at: string; error: string | null } | null = null
  private chain: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null
  private delay = BASE_DELAY_MS
  private readonly now: () => Date
  private readonly log: (message: string) => void

  constructor(private readonly deps: BrokerDeps) {
    this.now = deps.now ?? (() => new Date())
    this.log = deps.log ?? ((message) => console.warn(`[gpu-pool] ${message}`))
  }

  async request(body: unknown): Promise<Ticket> {
    const ticket = await this.deps.store.create(parseTicketRequest(body), this.now())
    this.kick()
    return ticket
  }

  list(): Promise<Ticket[]> {
    return this.deps.store.list()
  }

  dirty() {
    return this.deps.store.dirty()
  }

  async get(id: string): Promise<Ticket> {
    const ticket = await this.deps.store.get(id)
    if (!ticket) throw new TicketError('NOT_FOUND', `ticket ${id} does not exist`)
    return ticket
  }

  async template(id: string): Promise<LaunchTemplate> {
    const ticket = await this.get(id)
    if (ticket.status !== 'GRANTED')
      throw new TicketError('CONFLICT', `ticket ${id} is ${ticket.status}, not GRANTED`)
    return launchTemplate(ticket, await this.node(ticket))
  }

  /** Runs one serialized operation after any in-flight tick or release. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work)
    this.chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  release(id: string): Promise<Ticket> {
    return this.serial(async () => {
      const ticket = await this.get(id)
      if (ticket.status === 'QUEUED') return this.deps.store.finish(id, 'RELEASED', this.now())
      if (ticket.status !== 'GRANTED')
        throw new TicketError('CONFLICT', `ticket ${id} is already ${ticket.status}`)
      try {
        await this.reclaim(ticket)
      } catch (err) {
        await this.deps.store.note(id, `release pending: ${(err as Error).message}`)
        throw new TicketError('UNAVAILABLE', `could not reclaim ${id}: ${(err as Error).message}`)
      }
      const done = await this.deps.store.finish(id, 'RELEASED', this.now())
      this.kick()
      return done
    })
  }

  tick(): Promise<void> {
    return this.serial(() => this.tickOnce())
  }

  start(): void {
    if (this.timer) return
    const loop = async () => {
      try {
        await this.tick()
        this.delay = BASE_DELAY_MS
      } catch (err) {
        this.delay = Math.min(this.delay * 2, MAX_DELAY_MS)
        this.log(`tick failed: ${(err as Error).message}`)
      }
      this.timer = setTimeout(loop, this.delay)
      this.timer.unref?.()
    }
    this.timer = setTimeout(loop, 0)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Run a tick soon without waiting for the next scheduled one. */
  private kick(): void {
    void this.tick().catch((err) => this.log(`tick failed: ${(err as Error).message}`))
  }

  private async node(ticket: Ticket): Promise<NodeDefinition> {
    const node = (await this.deps.nodes()).find((candidate) => candidate.id === ticket.node)
    if (!node) throw new TicketError('UNAVAILABLE', `node ${ticket.node} is no longer registered`)
    return node
  }

  private async snapshot(machine: string): Promise<GpuSnapshot[]> {
    const result = await this.deps.herdr.exec(machine, ['bash', '-c', SNAPSHOT_LINE], 60)
    if (result.code !== 0)
      throw new Error(`snapshot exited ${result.code}: ${result.stderr.trim()}`)
    return parseSnapshot(result.stdout)
  }

  private async reclaim(ticket: Ticket): Promise<void> {
    const node = await this.node(ticket)
    const machines = await this.deps.herdr.machines()
    if (!machines.some((m) => m.name === node.id && m.state === 'connected'))
      throw new Error(`herdr machine ${node.id} is not connected`)
    const hold = holdJob(node.enter)
    if (hold) {
      const listing = await this.deps.herdr.exec(node.id, ['scontrol', 'show', 'step', hold], 60)
      if (listing.code !== 0) throw new Error(`step listing failed: ${listing.stderr.trim()}`)
      const ids = stepsToCancel(parseSteps(listing.stdout), hold, ticket.id)
      if (ids.length > 0) {
        const cancel = await this.deps.herdr.exec(node.id, ['scancel', ...ids], 60)
        if (cancel.code !== 0) throw new Error(`scancel failed: ${cancel.stderr.trim()}`)
      }
    }
    for (const terminal of await this.deps.herdr.terminals(ticket.id))
      if (terminal.state === 'live') await this.deps.herdr.kill(terminal.address)
    for (const terminal of await this.deps.herdr.terminals(ticket.id))
      await this.deps.herdr.remove(terminal.address)
    const snapshot = await this.snapshot(node.id)
    for (const index of ticket.grantedGpus) {
      const gpu = snapshot.find((candidate) => candidate.index === index)
      if (!gpu || !isIdle(gpu))
        await this.deps.store.markDirty(node.id, index, `still busy after ${ticket.id}`, this.now())
    }
  }

  async startTask(ticket: Ticket, task: string, line: string): Promise<string> {
    const template = launchTemplate(ticket, await this.node(ticket))
    return this.deps.herdr.runBackground(template.machine, [...template.run, 'bash', '-c', line], {
      name: terminalName(ticket.id, task),
      labels: { ticket: ticket.id, task },
    })
  }

  private async tickOnce(): Promise<void> {
    const now = this.now()
    const store = this.deps.store
    const open = await store.list(['QUEUED', 'GRANTED'])
    if (open.length === 0 && (await store.dirty()).length === 0) {
      this.unticketed = []
      this.lastTick = { at: formatIsoLocal(now), error: null }
      return
    }
    const nodes = await this.deps.nodes()
    const connected = new Set(
      (await this.deps.herdr.machines()).filter((m) => m.state === 'connected').map((m) => m.name),
    )

    for (const ticket of await store.list(['GRANTED'])) {
      if ((ticket.expiresAtMs ?? Number.POSITIVE_INFINITY) > now.getTime()) continue
      try {
        await this.reclaim(ticket)
        await store.finish(ticket.id, 'EXPIRED', now)
      } catch (err) {
        await store.note(ticket.id, `expiry reclaim pending: ${(err as Error).message}`)
      }
    }

    const snapshots = new Map<string, GpuSnapshot[] | null>()
    for (const node of nodes) {
      if (node.availableUntilMs <= now.getTime() || !connected.has(node.id)) {
        snapshots.set(node.id, null)
        continue
      }
      try {
        snapshots.set(node.id, await this.snapshot(node.id))
      } catch (err) {
        snapshots.set(node.id, null)
        this.log(`snapshot of ${node.id} failed: ${(err as Error).message}`)
      }
    }

    for (const dirty of await store.dirty()) {
      const gpu = snapshots.get(dirty.node)?.find((candidate) => candidate.index === dirty.gpu)
      if (gpu && isIdle(gpu)) await store.clearDirty(dirty.node, dirty.gpu)
    }

    const granted = await store.list(['GRANTED'])
    const held = new Map<string, Set<number>>()
    for (const ticket of granted) {
      if (!ticket.node) continue
      const set = held.get(ticket.node) ?? new Set<number>()
      for (const gpu of ticket.grantedGpus) set.add(gpu)
      held.set(ticket.node, set)
    }

    const pool: PoolNode[] = nodes.map((node) => ({
      id: node.id,
      gpuType: node.gpuType ?? null,
      allocation: node.allocation,
      allocatable: allocatableGpuIndices(node) ?? [],
      availableUntilMs: node.availableUntilMs,
      snapshot: snapshots.get(node.id) ?? null,
    }))

    const at = formatIsoLocal(this.now())
    this.unticketed = []
    for (const node of pool) {
      for (const gpu of node.snapshot ?? []) {
        if (!node.allocatable.includes(gpu.index) || gpu.processes === 0) continue
        if (held.get(node.id)?.has(gpu.index)) continue
        this.unticketed.push({ node: node.id, gpu: gpu.index, processes: gpu.processes, at })
      }
    }

    const plan = planGrants({
      queue: await store.list(['QUEUED']),
      nodes: pool,
      held,
      dirty: new Set((await store.dirty()).map((d) => `${d.node}:${d.gpu}`)),
      nowMs: now.getTime(),
    })
    for (const failure of plan.failures)
      await store.finish(failure.id, 'FAILED', now, failure.reason)
    for (const grant of plan.grants) {
      const ticket = await store.grant(grant.id, grant.node, grant.gpus, now)
      if (!ticket.run) continue
      try {
        await this.startTask(ticket, 'main', ticket.run)
      } catch (err) {
        await store.note(ticket.id, `start command failed: ${(err as Error).message}`)
      }
    }
    this.lastTick = { at: formatIsoLocal(this.now()), error: null }
  }
}

const KEY = Symbol.for('memon.gpuPool.broker')
type Holder = { [KEY]?: Map<string, TicketBroker> }

/** One broker per config directory per process; server.ts and Next bundles share it. */
export function getTicketBroker(configPath: string): TicketBroker {
  const holder = globalThis as Holder
  holder[KEY] ??= new Map()
  const path = gpuPoolDatabasePath(configPath)
  let broker = holder[KEY].get(path)
  if (!broker) {
    broker = new TicketBroker({
      store: new TicketStore(path),
      herdr: createHerdr(),
      nodes: () => loadNodes(),
    })
    holder[KEY].set(path, broker)
  }
  return broker
}
