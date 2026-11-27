import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { isTicketId } from '@memon/core'
import type { Command } from 'commander'
import { centralRequest } from '../lib/central-client.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'

interface Launch {
  machine: string
  exec: string[]
  run: string[]
  holdJob: string | null
}

interface TicketView {
  ticket: { id: string; status: string; [key: string]: unknown }
  launch: Launch | null
}

export interface TicketDeps {
  fetch: typeof fetch
  env: NodeJS.ProcessEnv
  /** Home directory holding `.config/memon` (tests); defaults to the user's. */
  home?: string
  /** Runs memon's herdr client with inherited stdio; resolves to its exit status. */
  hc: (args: string[]) => Promise<number>
  /** Runs memon's herdr client and captures stdout. */
  hcCapture: (args: string[]) => Promise<{ code: number; stdout: string }>
  out: (text: string) => void
  isTty: boolean
}

export function hcPath(env: NodeJS.ProcessEnv): string {
  return (
    env.MEMON_HC || path.join(os.homedir(), '.local', 'share', 'memon', 'herdr-core', 'bin', 'hc')
  )
}

function defaultDeps(): TicketDeps {
  const env = process.env
  const hc = hcPath(env)
  return {
    fetch,
    env,
    hc: (args) =>
      new Promise((resolve) => {
        const child = spawn(hc, args, { stdio: 'inherit' })
        child.on('error', (err) =>
          emitErrorAndExit(
            'TRANSPORT_UNAVAILABLE',
            `cannot start ${hc}: ${err.message}`,
            undefined,
            EXIT.GENERIC,
          ),
        )
        child.on('exit', (code, signal) =>
          resolve(code ?? 128 + (signal ? (os.constants.signals[signal] ?? 0) : 0)),
        )
      }),
    hcCapture: (args) =>
      new Promise((resolve) => {
        const child = spawn(hc, args, { stdio: ['ignore', 'pipe', 'inherit'] })
        let stdout = ''
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString()
        })
        child.on('error', (err) =>
          emitErrorAndExit(
            'TRANSPORT_UNAVAILABLE',
            `cannot start ${hc}: ${err.message}`,
            undefined,
            EXIT.GENERIC,
          ),
        )
        child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
      }),
    out: (text) => process.stdout.write(text),
    isTty: process.stdin.isTTY === true && process.stdout.isTTY === true,
  }
}

export function parseDuration(text: string): number {
  const match = /^(\d+)([smhd])$/.exec(text.trim())
  if (!match) emitErrorAndExit('BAD_REQUEST', `duration "${text}" must look like 90m, 6h or 2d`)
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd']
  return Number(match[1]) * unit
}

async function central(
  deps: TicketDeps,
  method: string,
  route: string,
  body?: unknown,
): Promise<unknown> {
  return centralRequest(deps, method, `/api/gpu-pool/tickets${route}`, body)
}

function checkId(id: string): string {
  if (!isTicketId(id))
    emitErrorAndExit('BAD_REQUEST', `"${id}" is not a ticket id (tk_ followed by 12 characters)`)
  return id
}

async function granted(deps: TicketDeps, id: string): Promise<TicketView & { launch: Launch }> {
  const view = (await central(deps, 'GET', `/${checkId(id)}`)) as TicketView
  if (view.ticket.status !== 'GRANTED' || !view.launch)
    emitErrorAndExit('CONFLICT', `ticket ${id} is ${view.ticket.status}, not GRANTED`)
  return view as TicketView & { launch: Launch }
}

export function terminalName(ticketId: string, task: string): string {
  const clean =
    task
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+/, '') || 'task'
  return `${ticketId.toLowerCase()}-${clean}`.slice(0, 32)
}

const line = (words: string[]) => {
  if (words.length === 0) emitErrorAndExit('BAD_REQUEST', 'give the command after --')
  return words.join(' ')
}

async function terminalAddress(deps: TicketDeps, id: string, task: string): Promise<string> {
  const listed = await deps.hcCapture(['ls', '--all', '--label', `ticket=${id}`, '--json'])
  const name = terminalName(id, task)
  const terminals =
    listed.code === 0
      ? (JSON.parse(listed.stdout).terminals as Array<{ address: string; name?: string }>)
      : []
  const found = terminals.find((t) => t.name === name)
  if (!found) emitErrorAndExit('NOT_FOUND', `ticket ${id} has no task "${task}"`)
  return found.address
}

export async function runTicket(
  action: string,
  args: string[],
  opts: Record<string, unknown>,
  deps = defaultDeps(),
): Promise<number> {
  const print = (value: unknown) => deps.out(`${JSON.stringify(value)}\n`)
  switch (action) {
    case 'request': {
      if (typeof opts.project !== 'string') emitErrorAndExit('BAD_REQUEST', '--project is required')
      if (typeof opts.duration !== 'string')
        emitErrorAndExit('BAD_REQUEST', '--duration is required')
      const body: Record<string, unknown> = {
        project: opts.project,
        duration_s: parseDuration(opts.duration),
      }
      if (opts.wholeNode) body.whole_node = true
      if (opts.gpus !== undefined) body.gpus = Number(opts.gpus)
      if (opts.gpuType !== undefined) body.gpu_type = opts.gpuType
      if (opts.label !== undefined) body.label = opts.label
      if (args.length > 0) body.run = args.join(' ')
      print(await central(deps, 'POST', '', body))
      return EXIT.SUCCESS
    }
    case 'list':
      print(await central(deps, 'GET', ''))
      return EXIT.SUCCESS
    case 'show':
      print(await central(deps, 'GET', `/${checkId(args[0] ?? '')}`))
      return EXIT.SUCCESS
    case 'release':
      print(await central(deps, 'POST', `/${checkId(args[0] ?? '')}/release`))
      return EXIT.SUCCESS
    case 'exec': {
      const [id, ...rest] = args
      const { launch } = await granted(deps, id ?? '')
      const stdin = deps.isTty ? [] : ['-i']
      return deps.hc([
        'exec',
        ...stdin,
        '--on',
        launch.machine,
        '--timeout',
        String(opts.timeout ?? 600),
        '--',
        ...launch.exec,
        'bash',
        '-c',
        line(rest),
      ])
    }
    case 'run': {
      const [id, ...rest] = args
      const { launch } = await granted(deps, id ?? '')
      const task = typeof opts.name === 'string' ? opts.name : `task-${Date.now().toString(36)}`
      const result = await deps.hcCapture([
        'run',
        '--on',
        launch.machine,
        '--bg',
        '--name',
        terminalName(id as string, task),
        '--label',
        `ticket=${id}`,
        '--label',
        `task=${task}`,
        '--json',
        '--',
        ...launch.run,
        'bash',
        '-c',
        line(rest),
      ])
      if (result.code !== 0)
        emitErrorAndExit(
          'TASK_START_FAILED',
          `could not start task ${task}`,
          undefined,
          EXIT.GENERIC,
        )
      print({ ticket: id, task, terminal: JSON.parse(result.stdout).address })
      return EXIT.SUCCESS
    }
    case 'ps': {
      const id = checkId(args[0] ?? '')
      const listed = await deps.hcCapture(['ls', '--all', '--label', `ticket=${id}`, '--json'])
      if (listed.code !== 0) return listed.code
      deps.out(listed.stdout.endsWith('\n') ? listed.stdout : `${listed.stdout}\n`)
      return EXIT.SUCCESS
    }
    case 'logs':
    case 'wait':
    case 'kill':
    case 'attach': {
      const id = checkId(args[0] ?? '')
      if (action === 'attach' && !deps.isTty)
        emitErrorAndExit('BAD_REQUEST', 'attach needs a terminal')
      if (action === 'attach' && !args[1]) {
        const { launch } = await granted(deps, id)
        const name = terminalName(id, 'shell')
        const started = await deps.hcCapture([
          'run',
          '--on',
          launch.machine,
          '--bg',
          '--name',
          name,
          '--label',
          `ticket=${id}`,
          '--label',
          'task=shell',
          '--json',
          '--',
          ...launch.exec,
          'bash',
          '-l',
        ])
        if (started.code !== 0)
          emitErrorAndExit('TASK_START_FAILED', 'could not start a shell', undefined, EXIT.GENERIC)
        return deps.hc(['attach', JSON.parse(started.stdout).address])
      }
      if (!args[1])
        emitErrorAndExit('BAD_REQUEST', `name the task: memon ticket ${action} ${id} <task>`)
      const address = await terminalAddress(deps, id, args[1])
      if (action === 'logs') return deps.hc(['read', address, '--lines', String(opts.lines ?? 200)])
      if (action === 'wait')
        return deps.hc(['wait', address, '--timeout', String(opts.timeout ?? 3600)])
      if (action === 'kill') return deps.hc(['kill', address])
      return deps.hc(['attach', address])
    }
    default:
      emitErrorAndExit('BAD_REQUEST', `unknown ticket action ${action}`)
  }
}

export function registerTicketCommands(program: Command): void {
  const ticket = program
    .command('ticket')
    .description('request GPUs from memon central and use them through a ticket')
  const act =
    (action: string) =>
    async (...input: unknown[]) => {
      const command = input[input.length - 1] as Command
      const opts = command.opts() as Record<string, unknown>
      const args = input
        .slice(0, -2)
        .flatMap((value) =>
          Array.isArray(value) ? value : value === undefined ? [] : [value],
        ) as string[]
      process.exitCode = await runTicket(action, args, opts)
    }
  ticket
    .command('request')
    .description('queue a GPU request; prints the ticket and its random id (tk_…)')
    .requiredOption('--project <name>', 'project the GPUs are for')
    .requiredOption('--duration <d>', 'how long, e.g. 90m, 6h, 2d')
    .option('--gpus <n>', 'number of GPUs')
    .option('--whole-node', 'a whole node instead of a GPU count')
    .option('--gpu-type <type>', 'GPU type, e.g. H200')
    .option('--label <text>', 'free-form label')
    .argument(
      '[command...]',
      'optional command started as task "main" when granted, given after --',
    )
    .action(act('request'))
  ticket
    .command('list')
    .description('list tickets, dirty GPUs and unticketed GPU use')
    .action(act('list'))
  ticket
    .command('show')
    .argument('<id>')
    .description('show one ticket and its launch details')
    .action(act('show'))
  ticket
    .command('release')
    .argument('<id>')
    .description('release a ticket: stop its tasks and free its GPUs')
    .action(act('release'))
  ticket
    .command('exec')
    .argument('<id>')
    .argument('<command...>', 'short command, given after --')
    .option('--timeout <s>', 'seconds before it is ended (max 600)', '600')
    .description('run a short command on the ticket’s GPUs; exits with its status')
    .action(act('exec'))
  ticket
    .command('run')
    .argument('<id>')
    .argument('<command...>', 'long task, given after --')
    .option('--name <task>', 'task name (default: generated)')
    .description('start a long task in a persistent terminal on the ticket’s GPUs')
    .action(act('run'))
  ticket.command('ps').argument('<id>').description('list the ticket’s tasks').action(act('ps'))
  ticket
    .command('logs')
    .argument('<id>')
    .argument('<task>')
    .option('--lines <n>', 'history lines', '200')
    .description('print a task’s screen and history')
    .action(act('logs'))
  ticket
    .command('wait')
    .argument('<id>')
    .argument('<task>')
    .option('--timeout <s>', 'seconds before it checks in', '3600')
    .description('wait until a task stops')
    .action(act('wait'))
  ticket
    .command('kill')
    .argument('<id>')
    .argument('<task>')
    .description('end a task')
    .action(act('kill'))
  ticket
    .command('attach')
    .argument('<id>')
    .argument('[task]', 'task to attach to (default: a new shell on the ticket’s GPUs)')
    .description('attach this terminal to a task, or open a shell on the ticket’s GPUs')
    .action(act('attach'))
}
