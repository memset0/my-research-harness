// Owner-triggered central→host network probes (openspec traffic-tracking).
//
// Each probe measures the leg through the Project's own transport and needs
// nothing installed on the remote host:
//   * File Agent — sequential `GET /v1/capabilities` over one keep-alive mTLS
//     connection: the first call carries TCP+TLS setup, the rest are steady
//     round trips through whatever relay sits in front of the agent.
//   * SSH        — one `ssh … cat` session (setup time to the first echo, then
//     one-byte echo round trips) and one `ssh … head -c N /dev/urandom`
//     download (throughput of an uncompressed SSH channel).
//   * native     — the service listens on central's own loopback: no network leg.
// A service re-fetch through the live forwarding target is delegated to the
// content gateway's probe hook, so it reuses its tunnels and credentials.

import 'server-only'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Agent, request } from 'node:https'
import { homedir } from 'node:os'
import type { Config, ProjectConfig } from '@memon/core'
import type { ProbeResult, ProbeStep, TrafficTransport } from './tracker'
import { serviceProbeHook, serviceTransportOf } from './transport'

export const AGENT_PROBE_REQUESTS = 6
export const SSH_ECHO_ROUNDS = 10
export const SSH_DOWNLOAD_BYTES = 4 * 1024 * 1024
export const SERVICE_FETCH_MAX_BYTES = 16 * 1024 * 1024
const STEP_TIMEOUT_MS = 30_000

export type ProbeSupport =
  | { transport: TrafficTransport; probe: 'agent' | 'ssh' | 'native' }
  | { transport: TrafficTransport; probe: 'none'; reason: string }

/** How (and whether) the central→host leg of a Project can be probed. */
export function probeSupportOf(project: ProjectConfig, config: Config): ProbeSupport {
  const transport = serviceTransportOf(project)
  if (transport === 'file-agent') {
    const name = project.access?.kind === 'agent' ? project.access.connection : ''
    if (!config.fileAgents?.[name])
      return { transport, probe: 'none', reason: `File Agent connection ${name} is not configured` }
    return { transport, probe: 'agent' }
  }
  if (transport === 'ssh-tunnel') {
    if (project.execution?.kind !== 'ssh')
      return {
        transport,
        probe: 'none',
        reason: 'SSHFS storage without an SSH execution target has no probeable network transport',
      }
    return { transport, probe: 'ssh' }
  }
  return { transport, probe: 'native' }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function latencyStep(label: string, setupMs: number | null, rounds: number[]): ProbeStep {
  return {
    label,
    ok: rounds.length > 0,
    setupMs,
    medianMs: median(rounds),
    minMs: rounds.length ? Math.min(...rounds) : null,
    maxMs: rounds.length ? Math.max(...rounds) : null,
    samples: rounds.length,
  }
}

export interface AgentProbeDeps {
  readFile?: (path: string) => Promise<Buffer>
  requestOnce?: (url: URL, agent: Agent, headers: Record<string, string>) => Promise<number>
}

/** One GET over the shared keep-alive agent; resolves with the HTTP status after the body. */
function httpsGet(url: URL, agent: Agent, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const call = request(url, { method: 'GET', agent, headers }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? 0))
      response.once('error', reject)
    })
    call.setTimeout(STEP_TIMEOUT_MS, () => call.destroy(new Error('Timed out')))
    call.once('error', reject)
    call.end()
  })
}

export async function probeFileAgent(
  project: ProjectConfig,
  config: Config,
  deps: AgentProbeDeps = {},
): Promise<ProbeStep[]> {
  if (project.access?.kind !== 'agent') return []
  const connection = config.fileAgents?.[project.access.connection]
  if (!connection) return [{ label: 'File Agent round trips', ok: false, note: 'Not configured' }]
  const read = deps.readFile ?? ((path: string) => readFile(path))
  const [ca, cert, key] = await Promise.all([
    read(connection.caFile),
    read(connection.certificateFile),
    read(connection.keyFile),
  ])
  const agent = new Agent({
    keepAlive: true,
    maxSockets: 1,
    ca,
    cert,
    key,
    minVersion: 'TLSv1.3',
    rejectUnauthorized: true,
  })
  const url = new URL('/v1/capabilities', connection.endpoint)
  url.searchParams.set('project', project.access.project)
  const headers = { 'x-memon-expected-source-identity': project.access.sourceIdentity }
  const once = deps.requestOnce ?? httpsGet
  const times: number[] = []
  let note: string | undefined
  try {
    for (let i = 0; i < AGENT_PROBE_REQUESTS; i++) {
      const t0 = performance.now()
      const status = await once(url, agent, headers)
      times.push(performance.now() - t0)
      if (status >= 400) {
        note = `Agent answered HTTP ${status}`
        break
      }
    }
  } catch (error) {
    note = (error as Error).message
  } finally {
    agent.destroy()
  }
  const [first, ...rest] = times
  return [
    {
      ...latencyStep('File Agent round trips', first ?? null, rest),
      ...(note ? { ok: false, note } : { note: 'First request includes TCP and TLS setup' }),
    },
  ]
}

export interface SshProbeDeps {
  spawnSsh?: (args: string[]) => import('node:child_process').ChildProcessWithoutNullStreams
}

function sshArgs(project: ProjectConfig, command: string[]): string[] {
  if (project.execution?.kind !== 'ssh') throw new Error('No SSH execution target')
  const execution = project.execution
  return [
    '-T',
    '-o',
    'BatchMode=yes',
    '-o',
    'Compression=no',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `UserKnownHostsFile=${execution.knownHostsFile ?? `${homedir()}/.ssh/known_hosts`}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=15',
    ...(execution.identityFile ? ['-i', execution.identityFile] : []),
    ...(execution.port ? ['-p', String(execution.port)] : []),
    '--',
    execution.target,
    ...command,
  ]
}

const defaultSpawnSsh = (args: string[]) =>
  spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

/** Setup time to the first echo, then one-byte echo round trips over the same session. */
export function probeSshEcho(project: ProjectConfig, deps: SshProbeDeps = {}): Promise<ProbeStep> {
  const child = (deps.spawnSsh ?? defaultSpawnSsh)(sshArgs(project, ['cat']))
  return new Promise((resolve) => {
    const rounds: number[] = []
    let setupMs: number | null = null
    let sentAt = 0
    let stderr = ''
    let settled = false
    const t0 = performance.now()
    const settle = (note?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdin.end()
      child.kill()
      resolve({
        ...latencyStep('SSH echo round trips', setupMs, rounds),
        ...(note ? { ok: rounds.length > 0, note } : { note: 'Setup is spawn → first echo' }),
      })
    }
    const timer = setTimeout(() => settle('Timed out'), STEP_TIMEOUT_MS)
    const send = () => {
      sentAt = performance.now()
      child.stdin.write('x')
    }
    child.stdout.on('data', (chunk: Buffer) => {
      for (let i = 0; i < chunk.length && !settled; i++) {
        const now = performance.now()
        if (setupMs === null) setupMs = now - t0
        else rounds.push(now - sentAt)
        if (rounds.length >= SSH_ECHO_ROUNDS) settle()
        else send()
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-300)
    })
    child.once('error', (error) => settle(error.message))
    child.once('exit', (code) => settle(stderr.trim() || `ssh exited with ${code}`))
    child.stdin.on('error', () => {})
    send()
  })
}

/** Bounded random-byte download over a fresh uncompressed SSH session. */
export function probeSshDownload(
  project: ProjectConfig,
  deps: SshProbeDeps = {},
): Promise<ProbeStep> {
  const child = (deps.spawnSsh ?? defaultSpawnSsh)(
    sshArgs(project, ['head', '-c', String(SSH_DOWNLOAD_BYTES), '/dev/urandom']),
  )
  child.stdin.end()
  return new Promise((resolve) => {
    const t0 = performance.now()
    let first: number | null = null
    let bytes = 0
    let stderr = ''
    let settled = false
    const settle = (ok: boolean, note?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      const end = performance.now()
      const transfer = first === null ? null : Math.max(end - first, 1)
      resolve({
        label: 'SSH download',
        ok,
        setupMs: first === null ? null : first - t0,
        bytes,
        throughputBps: transfer && bytes > 0 ? Math.round((bytes * 1000) / transfer) : null,
        note: note ?? 'Setup is spawn → first byte; throughput is measured after the first byte',
      })
    }
    const timer = setTimeout(() => settle(false, 'Timed out'), STEP_TIMEOUT_MS * 2)
    child.stdout.on('data', (chunk: Buffer) => {
      if (first === null) first = performance.now()
      bytes += chunk.length
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-300)
    })
    child.once('error', (error) => settle(false, error.message))
    child.once('close', (code) =>
      settle(
        code === 0 && bytes === SSH_DOWNLOAD_BYTES,
        code === 0 ? undefined : stderr.trim() || `ssh exited with ${code}`,
      ),
    )
  })
}

export interface ProbeRequest {
  host: string
  project: string
  document?: { kind: 'wiki' | 'report'; id: string }
  path?: string
}

export interface ProbeDeps extends AgentProbeDeps, SshProbeDeps {
  serviceFetch?: NonNullable<ReturnType<typeof serviceProbeHook>>['fetch']
}

export async function runProbe(
  config: Config,
  input: ProbeRequest,
  deps: ProbeDeps = {},
): Promise<ProbeResult> {
  const startedAt = Date.now()
  const t0 = performance.now()
  const project = config.projects.find(
    (p) => p.name === input.project && (p.host ?? '-') === input.host,
  )
  const result = (
    transport: ProbeResult['transport'],
    steps: ProbeStep[],
    target?: string,
  ): ProbeResult => ({
    id: randomUUID(),
    host: input.host,
    project: input.project,
    transport,
    startedAt,
    durationMs: performance.now() - t0,
    ...(target ? { target } : {}),
    steps,
  })
  if (!project)
    return result('unsupported', [{ label: 'Project', ok: false, note: 'Project not found' }])
  const support = probeSupportOf(project, config)
  const steps: ProbeStep[] = []
  let target: string | undefined
  if (support.probe === 'none') {
    steps.push({ label: 'Transport', ok: false, note: `Not probeable: ${support.reason}` })
  } else if (support.probe === 'agent') {
    const connection =
      project.access?.kind === 'agent' ? config.fileAgents?.[project.access.connection] : undefined
    if (connection) target = new URL(connection.endpoint).host
    steps.push(...(await probeFileAgent(project, config, deps)))
  } else if (support.probe === 'ssh') {
    if (project.execution?.kind === 'ssh') target = project.execution.target
    steps.push(await probeSshEcho(project, deps))
    steps.push(await probeSshDownload(project, deps))
  } else {
    steps.push({
      label: 'Transport',
      ok: true,
      note: 'Native: the service listens on central loopback, so there is no network leg',
    })
  }
  if (input.document) {
    const fetch = deps.serviceFetch ?? serviceProbeHook()?.fetch
    steps.push(
      fetch
        ? await fetch({
            host: input.host,
            project: input.project,
            kind: input.document.kind,
            id: input.document.id,
            path: input.path ?? '/',
            maxBytes: SERVICE_FETCH_MAX_BYTES,
            timeoutMs: STEP_TIMEOUT_MS * 2,
          })
        : {
            label: 'Service fetch',
            ok: false,
            note: 'The content gateway is not running in this process',
          },
    )
  }
  return result(support.transport, steps, target)
}
