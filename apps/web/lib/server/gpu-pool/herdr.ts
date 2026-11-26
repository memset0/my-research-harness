import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { GpuSnapshot } from './types'

/** memon's own herdr client; never another installation's. */
export function hcPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.MEMON_HC || path.join(os.homedir(), '.local', 'share', 'memon', 'herdr-core', 'bin', 'hc')
  )
}

export interface HcResult {
  code: number
  stdout: string
  stderr: string
}

export interface HerdrTerminal {
  address: string
  name: string | null
  state: string
  exitCode: number | null
}

export interface Herdr {
  machines(): Promise<Array<{ name: string; state: string }>>
  exec(machine: string, argv: string[], timeoutS?: number): Promise<HcResult>
  runBackground(
    machine: string,
    argv: string[],
    options: { name: string; labels: Record<string, string> },
  ): Promise<string>
  terminals(ticketId: string): Promise<HerdrTerminal[]>
  kill(address: string): Promise<void>
  remove(address: string): Promise<void>
}

const MAX_OUTPUT = 1024 * 1024

export function runHc(args: string[], hc = hcPath(), timeoutMs = 120_000): Promise<HcResult> {
  return new Promise((resolve) => {
    const child = spawn(hc, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        code: code ?? 128 + (signal ? (os.constants.signals[signal] ?? 0) : 0),
        stdout,
        stderr,
      })
    })
  })
}

function json<T>(result: HcResult, what: string): T {
  if (result.code !== 0)
    throw new Error(`hc ${what} failed (${result.code}): ${result.stderr.trim()}`)
  return JSON.parse(result.stdout) as T
}

export function createHerdr(hc = hcPath()): Herdr {
  return {
    async machines() {
      const out = json<{ machines: Array<{ name: string; state: string }> }>(
        await runHc(['machine', 'ls', '--json'], hc),
        'machine ls',
      )
      return out.machines.map(({ name, state }) => ({ name, state }))
    },
    exec(machine, argv, timeoutS = 60) {
      return runHc(
        ['exec', '--on', machine, '--timeout', String(timeoutS), '--', ...argv],
        hc,
        (timeoutS + 30) * 1000,
      )
    },
    async runBackground(machine, argv, { name, labels }) {
      const args = ['run', '--on', machine, '--bg', '--name', name, '--json']
      for (const [key, value] of Object.entries(labels)) args.push('--label', `${key}=${value}`)
      const out = json<{ address: string }>(await runHc([...args, '--', ...argv], hc), 'run')
      return out.address
    },
    async terminals(ticketId) {
      const out = json<{ terminals: Array<Record<string, unknown>> }>(
        await runHc(['ls', '--all', '--label', `ticket=${ticketId}`, '--json'], hc),
        'ls',
      )
      return out.terminals.map((t) => ({
        address: String(t.address),
        name: typeof t.name === 'string' ? t.name : null,
        state: String(t.state),
        exitCode: typeof t.exit_code === 'number' ? t.exit_code : null,
      }))
    },
    async kill(address) {
      const result = await runHc(['kill', address, '--json'], hc)
      if (
        result.code !== 0 &&
        !/not_found|was removed|not live|finished/i.test(result.stdout + result.stderr)
      )
        throw new Error(
          `hc kill ${address} failed: ${result.stderr.trim() || result.stdout.trim()}`,
        )
    },
    async remove(address) {
      const result = await runHc(['rm', address, '--json'], hc)
      if (result.code !== 0 && !/not_found|was removed/i.test(result.stdout + result.stderr))
        throw new Error(`hc rm ${address} failed: ${result.stderr.trim() || result.stdout.trim()}`)
    },
  }
}

// ---------------------------------------------------------------- launch ---

/** The Slurm job a node's `enter` prefix steps into, or null for non-Slurm nodes. */
export function holdJob(enter: string[] | undefined): string | null {
  if (!enter || path.basename(enter[0] ?? '') !== 'srun') return null
  for (let i = 1; i < enter.length; i += 1) {
    const arg = enter[i] as string
    const inline = /^--jobid=(\d+)$/.exec(arg)
    if (inline) return inline[1] as string
    if (arg === '--jobid' && /^\d+$/.test(enter[i + 1] ?? '')) return enter[i + 1] as string
  }
  return null
}

export const taskStepName = (ticketId: string) => `memon-task-${ticketId}`

/** `srun` arguments from the node's `enter`, renamed for the ticket's tasks. */
function taskSrun(enter: string[], ticketId: string): string[] {
  const out: string[] = []
  for (let i = 0; i < enter.length; i += 1) {
    const arg = enter[i] as string
    if (arg === '-J' || arg === '--job-name') {
      i += 1
      continue
    }
    if (arg.startsWith('--job-name=') || arg === '--pty' || /^-J.+/.test(arg)) continue
    out.push(arg)
  }
  return [...out, '-J', taskStepName(ticketId)]
}

export interface LaunchTemplate {
  machine: string
  /** Prefix for short commands: environment only. */
  exec: string[]
  /** Prefix for long tasks: environment plus the ticket's own Slurm step where the node has a hold. */
  run: string[]
  holdJob: string | null
}

export function launchTemplate(
  ticket: { id: string; grantedGpus: number[] },
  node: { id: string; enter?: string[] },
): LaunchTemplate {
  const env = [
    'env',
    `CUDA_VISIBLE_DEVICES=${ticket.grantedGpus.join(',')}`,
    `MEMON_TICKET=${ticket.id}`,
  ]
  const hold = holdJob(node.enter)
  return {
    machine: node.id,
    exec: env,
    run: hold ? [...env, ...taskSrun(node.enter as string[], ticket.id)] : env,
    holdJob: hold,
  }
}

/** Terminal name for a task: unique per ticket, within herdr's 1–32 `[a-z0-9_-]`. */
export function terminalName(ticketId: string, task: string): string {
  const clean =
    task
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+/, '') || 'task'
  return `${ticketId.toLowerCase()}-${clean}`.slice(0, 32)
}

// ---------------------------------------------------------------- steps ---

export interface SlurmStep {
  id: string
  name: string
}

export function parseSteps(scontrol: string): SlurmStep[] {
  const steps: SlurmStep[] = []
  for (const block of scontrol.split(/(?=StepId=)/)) {
    const id = /^StepId=(\S+)/.exec(block)?.[1]
    const name = /\bName=(\S+)/.exec(block)?.[1]
    if (id && name) steps.push({ id, name })
  }
  return steps
}

/** Only `<hold>.<n>` steps carrying exactly this ticket's task name; never the hold itself. */
export function stepsToCancel(steps: SlurmStep[], hold: string, ticketId: string): string[] {
  const pattern = new RegExp(`^${hold}\\.\\d+$`)
  return steps
    .filter((step) => pattern.test(step.id) && step.name === taskStepName(ticketId))
    .map((step) => step.id)
}

// ---------------------------------------------------------------- probe ---

const APPS = '__MEMON_APPS__'
export const SNAPSHOT_LINE = [
  'nvidia-smi --query-gpu=index,uuid,memory.used --format=csv,noheader,nounits;',
  `echo ${APPS};`,
  'nvidia-smi --query-compute-apps=gpu_uuid --format=csv,noheader',
].join(' ')

export function parseSnapshot(stdout: string): GpuSnapshot[] {
  const at = stdout.indexOf(APPS)
  if (at < 0) throw new Error('snapshot has no compute-apps section')
  const counts = new Map<string, number>()
  for (const line of stdout.slice(at + APPS.length).split('\n')) {
    const uuid = line.trim()
    if (uuid.startsWith('GPU-')) counts.set(uuid, (counts.get(uuid) ?? 0) + 1)
  }
  const gpus: GpuSnapshot[] = []
  for (const line of stdout.slice(0, at).split('\n')) {
    if (line.trim() === '') continue
    const [index, uuid, used] = line.split(',').map((field) => field.trim())
    const parsed = Number(index)
    if (!Number.isInteger(parsed) || !uuid) throw new Error(`unexpected GPU line: ${line}`)
    const memory = Number(used)
    gpus.push({
      index: parsed,
      memoryUsedMib: used === '' || Number.isNaN(memory) ? null : memory,
      processes: counts.get(uuid) ?? 0,
    })
  }
  if (gpus.length === 0) throw new Error('snapshot reported no GPUs')
  return gpus.sort((a, b) => a.index - b.index)
}
