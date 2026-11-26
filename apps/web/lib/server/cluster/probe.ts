import 'server-only'
import { spawn } from 'node:child_process'
import {
  allocatableGpuIndices,
  formatIsoLocal,
  isNodeExpired,
  type NodeDefinition,
  nodeCommandInvocation,
} from '@memon/core'
import type {
  ClusterGpuDto,
  ClusterGroupDto,
  ClusterNodeDto,
  ClusterTaskDto,
} from '@/lib/dto/clusters'

const APPS_MARKER = '__MEMON_APPS__'
export const PROBE_LINE = [
  'nvidia-smi --query-gpu=index,uuid,name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits;',
  `echo ${APPS_MARKER};`,
  'nvidia-smi --query-compute-apps=gpu_uuid --format=csv,noheader',
].join(' ')

export const PROBE_TIMEOUT_MS = 45_000
export const PROBE_TTL_MS = 45_000
export const PROBE_CONCURRENCY = 2
const MAX_OUTPUT_BYTES = 256 * 1024
const MAX_ERROR_CHARS = 300

export interface ProbedGpu {
  index: number
  uuid: string
  name: string
  memoryUsedMib: number | null
  memoryTotalMib: number | null
  utilizationPct: number | null
  processes: number
}

export type ProbeResult =
  | { ok: true; at: number; gpus: ProbedGpu[] }
  | { ok: false; at: number; error: string }

const numberOrNull = (field: string | undefined) => {
  const value = Number(field)
  return field === undefined || field === '' || Number.isNaN(value) ? null : value
}

export function parseProbeOutput(stdout: string): ProbedGpu[] {
  const markerAt = stdout.indexOf(APPS_MARKER)
  if (markerAt < 0) throw new Error('probe output has no compute-apps section')
  const gpuLines = stdout
    .slice(0, markerAt)
    .split('\n')
    .map((line) => line.trim())
  const appLines = stdout.slice(markerAt + APPS_MARKER.length).split('\n')
  const processes = new Map<string, number>()
  for (const line of appLines) {
    const uuid = line.trim()
    if (uuid.startsWith('GPU-')) processes.set(uuid, (processes.get(uuid) ?? 0) + 1)
  }
  const gpus: ProbedGpu[] = []
  for (const line of gpuLines) {
    if (line === '') continue
    const [index, uuid, name, used, total, util] = line.split(',').map((field) => field.trim())
    const parsedIndex = Number(index)
    if (!Number.isInteger(parsedIndex) || !uuid) throw new Error(`unexpected GPU line: ${line}`)
    gpus.push({
      index: parsedIndex,
      uuid,
      name: name ?? '',
      memoryUsedMib: numberOrNull(used),
      memoryTotalMib: numberOrNull(total),
      utilizationPct: numberOrNull(util),
      processes: processes.get(uuid) ?? 0,
    })
  }
  if (gpus.length === 0) throw new Error('probe reported no GPUs')
  return gpus.sort((a, b) => a.index - b.index)
}

/** Strip connection details a transport error message may echo. */
function redact(message: string, node: NodeDefinition): string {
  const secrets =
    node.transport.kind === 'ssh'
      ? [node.transport.target, node.transport.target.split('@').pop() ?? '']
      : [node.transport.via]
  let out = message
  for (const secret of secrets) if (secret) out = out.split(secret).join('<transport>')
  const trimmed = out.trim()
  return trimmed.length > MAX_ERROR_CHARS ? `…${trimmed.slice(-MAX_ERROR_CHARS)}` : trimmed
}

export function runProbe(
  node: NodeDefinition,
  timeoutMs = PROBE_TIMEOUT_MS,
  now: () => number = Date.now,
): Promise<ProbeResult> {
  const invocation = nodeCommandInvocation(node, [PROBE_LINE])
  return new Promise((resolve) => {
    const child = spawn(invocation.file, invocation.args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: ProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const fail = (error: string) => finish({ ok: false, at: now(), error: redact(error, node) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(`probe timed out after ${Math.round(timeoutMs / 1000)} s`)
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        fail('probe output exceeded its limit')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => fail(`cannot start transport: ${err.message}`))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        fail(stderr.trim() || `probe exited with status ${code}`)
        return
      }
      try {
        finish({ ok: true, at: now(), gpus: parseProbeOutput(stdout) })
      } catch (err) {
        fail((err as Error).message)
      }
    })
  })
}

export type ProbeRunner = (node: NodeDefinition) => Promise<ProbeResult>

/** Per-node cache with in-flight dedupe and a global concurrency cap. */
export function createProbeCache(
  run: ProbeRunner = (node) => runProbe(node),
  options: { ttlMs?: number; concurrency?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? PROBE_TTL_MS
  const now = options.now ?? Date.now
  let slots = options.concurrency ?? PROBE_CONCURRENCY
  const waiting: Array<() => void> = []
  const results = new Map<string, ProbeResult>()
  const inFlight = new Map<string, Promise<ProbeResult>>()

  async function withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (slots === 0) await new Promise<void>((release) => waiting.push(release))
    else slots -= 1
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else slots += 1
    }
  }

  return function probe(node: NodeDefinition, refresh: boolean): Promise<ProbeResult> {
    const pending = inFlight.get(node.id)
    if (pending) return pending
    const cached = results.get(node.id)
    if (!refresh && cached && now() - cached.at < ttlMs) return Promise.resolve(cached)
    const started = withSlot(() => run(node))
      .then((result) => {
        results.set(node.id, result)
        return result
      })
      .finally(() => inFlight.delete(node.id))
    inFlight.set(node.id, started)
    return started
  }
}

function gpuRows(node: NodeDefinition, result: ProbeResult | null): ClusterGpuDto[] {
  const allocatable = allocatableGpuIndices(node)
  const isAllocatable = (index: number) => allocatable === null || allocatable.includes(index)
  if (result?.ok) {
    return result.gpus.map((gpu) => ({
      index: gpu.index,
      name: gpu.name || null,
      memory_used_mib: gpu.memoryUsedMib,
      memory_total_mib: gpu.memoryTotalMib,
      utilization_pct: gpu.utilizationPct,
      allocatable: isAllocatable(gpu.index),
      processes: gpu.processes,
    }))
  }
  return Array.from({ length: node.gpus ?? 0 }, (_, index) => ({
    index,
    name: null,
    memory_used_mib: null,
    memory_total_mib: null,
    utilization_pct: null,
    allocatable: isAllocatable(index),
    processes: null,
  }))
}

export function nodeDto(
  node: NodeDefinition,
  result: ProbeResult | null,
  nowMs: number,
): ClusterNodeDto {
  const expired = isNodeExpired(node, nowMs)
  return {
    id: node.id,
    gpu_type: node.gpuType ?? null,
    gpus: node.gpus ?? null,
    allocation: node.allocation,
    allocatable_gpus: allocatableGpuIndices(node),
    available_until: node.availableUntil,
    expired,
    transport: node.transport.kind,
    state: expired ? 'expired' : result?.ok ? 'ok' : 'unreachable',
    probed_at: result ? formatIsoLocal(new Date(result.at)) : null,
    error: result && !result.ok ? result.error : null,
    gpu_rows: expired ? [] : gpuRows(node, result),
  }
}

export async function buildOverview(
  nodes: NodeDefinition[],
  probe: (node: NodeDefinition, refresh: boolean) => Promise<ProbeResult>,
  options: { refresh: boolean; nowMs: number; tasks: ClusterTaskDto[] | null },
) {
  const results = await Promise.all(
    nodes.map((node) =>
      isNodeExpired(node, options.nowMs) ? Promise.resolve(null) : probe(node, options.refresh),
    ),
  )
  const groups = new Map<string, ClusterNodeDto[]>()
  nodes.forEach((node, index) => {
    const cluster = node.cluster ?? 'unassigned'
    groups.set(cluster, [
      ...(groups.get(cluster) ?? []),
      nodeDto(node, results[index] ?? null, options.nowMs),
    ])
  })
  const clusters: ClusterGroupDto[] = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cluster, clusterNodes]) => ({ cluster, nodes: clusterNodes }))
  return {
    now: formatIsoLocal(new Date(options.nowMs)),
    clusters,
    tasks: { available: options.tasks !== null, items: options.tasks ?? [] },
  }
}
