// `memon ticket`: GPU tickets through memon central's API only. Nothing here
// talks to herdr, SSH or the node registry, so it works from any machine with
// a `memon login` (see lib/central-client.ts).

import { isTicketId } from '@memon/core'
import type { Command } from 'commander'
import WebSocket from 'ws'
import { type CentralClientDeps, centralRequest, resolveCentral } from '../lib/central-client.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { EXIT } from '../lib/exit-codes.js'

export interface TicketDeps extends CentralClientDeps {
  out: (text: string) => void
  /** Raw output streams for `exec` and `attach`. */
  stdout?: (chunk: Buffer) => void
  stderr?: (chunk: Buffer) => void
  isTty: boolean
  /** All of piped standard input (only read when not a terminal). */
  readStdin?: () => Promise<Buffer>
  /** Opens the attach WebSocket; injectable for tests. */
  openSocket?: (url: string, headers: Record<string, string>) => WebSocket
  sleep?: (ms: number) => Promise<void>
}

const MAX_STDIN_BYTES = 8 * 1024 * 1024
const FOLLOW_INTERVAL_MS = 2_000
const FOLLOW_LINES = 500
/** Each `wait` request blocks at most this long on central; the CLI repeats it. */
const WAIT_SLICE_S = 60

function defaultDeps(): TicketDeps {
  return {
    fetch,
    env: process.env,
    out: (text) => process.stdout.write(text),
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
    isTty: process.stdin.isTTY === true && process.stdout.isTTY === true,
    readStdin: async () => {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of process.stdin) {
        size += (chunk as Buffer).length
        if (size > MAX_STDIN_BYTES)
          emitErrorAndExit('BAD_REQUEST', 'standard input for ticket exec is limited to 8 MiB')
        chunks.push(chunk as Buffer)
      }
      return Buffer.concat(chunks)
    },
    openSocket: (url, headers) => new WebSocket(url, { headers }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

export function parseDuration(text: string): number {
  const match = /^(\d+)([smhd])$/.exec(text.trim())
  if (!match) emitErrorAndExit('BAD_REQUEST', `duration "${text}" must look like 90m, 6h or 2d`)
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd']
  return Number(match[1]) * unit
}

function checkId(id: string): string {
  if (!isTicketId(id))
    emitErrorAndExit('BAD_REQUEST', `"${id}" is not a ticket id (tk_ followed by 12 characters)`)
  return id
}

function checkTask(task: string | undefined, usage: string): string {
  if (!task) emitErrorAndExit('BAD_REQUEST', `name the task: ${usage}`)
  return encodeURIComponent(task)
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

const line = (words: string[]) => {
  if (words.length === 0) emitErrorAndExit('BAD_REQUEST', 'give the command after --')
  return words.join(' ')
}

const tickets = (route: string) => `/api/gpu-pool/tickets${route}`

/** `exec`: stream NDJSON output frames to stdout/stderr; resolve to the exit status. */
async function streamExec(
  deps: TicketDeps,
  id: string,
  body: Record<string, unknown>,
): Promise<number> {
  const target = await resolveCentral(deps)
  let response: Response
  try {
    response = await deps.fetch(`${target.base}${tickets(`/${id}/exec`)}`, {
      method: 'POST',
      headers: { authorization: target.authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    emitErrorAndExit(
      'CENTRAL_UNAVAILABLE',
      `cannot reach memon central at ${target.base}: ${(err as Error).message}`,
      undefined,
      EXIT.GENERIC,
    )
  }
  if (!response.ok || !response.body) {
    // Errors carry the usual JSON envelope; reuse the shared mapping.
    const text = await response.text().catch(() => '')
    await centralRequest(
      { ...deps, fetch: async () => new Response(text, { status: response.status }) },
      'POST',
      '',
      undefined,
      target,
    )
    return EXIT.GENERIC
  }
  const write = {
    stdout: deps.stdout ?? ((chunk: Buffer) => deps.out(chunk.toString())),
    stderr: deps.stderr ?? ((chunk: Buffer) => deps.out(chunk.toString())),
  }
  const decoder = new TextDecoder()
  let pending = ''
  let exit: number | null = null
  const handle = (frame: string) => {
    if (!frame.trim()) return
    const value = JSON.parse(frame) as {
      stream?: 'stdout' | 'stderr'
      data?: string
      exit?: number
    }
    if (typeof value.exit === 'number') exit = value.exit
    else if (value.stream && value.data) write[value.stream](Buffer.from(value.data, 'base64'))
  }
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(chunk, { stream: true })
    let newline = pending.indexOf('\n')
    while (newline >= 0) {
      handle(pending.slice(0, newline))
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
    }
  }
  handle(pending)
  if (exit === null)
    emitErrorAndExit('CENTRAL_UNAVAILABLE', 'the exec stream ended early', undefined, EXIT.GENERIC)
  return exit
}

/**
 * The lines of `next` that follow what `printed` already showed. Both are
 * snapshots of one terminal's history, so the newest printed lines are found
 * again in `next` and only what comes after them is new.
 */
export function newLines(printed: string[], next: string[]): string[] {
  if (printed.length === 0) return next
  for (let k = Math.min(5, printed.length); k > 0; k -= 1) {
    const tail = printed.slice(-k)
    for (let end = next.length; end >= k; end -= 1) {
      if (tail.every((line, i) => next[end - k + i] === line)) return next.slice(end)
    }
  }
  return next
}

const SOCKET_REFUSALS: Record<number, string> = {
  401: 'FORBIDDEN',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
}

/** `attach` / `logs --follow`: a WebSocket to the task's terminal on central. */
async function socketSession(
  deps: TicketDeps,
  id: string,
  query: Record<string, string>,
  interactive: boolean,
): Promise<number> {
  const target = await resolveCentral(deps)
  const size = {
    cols: String(process.stdout.columns ?? 120),
    rows: String(process.stdout.rows ?? 40),
  }
  const url = new URL(`${target.base.replace(/^http/, 'ws')}${tickets(`/${id}/attach`)}`)
  for (const [key, value] of Object.entries({ ...size, ...query })) url.searchParams.set(key, value)
  const open = deps.openSocket ?? ((u, headers) => new WebSocket(u, { headers }))
  const ws = open(url.toString(), { authorization: target.authorization })
  const write = deps.stdout ?? ((chunk: Buffer) => deps.out(chunk.toString()))
  return new Promise((resolve) => {
    let code: number = EXIT.GENERIC
    const restore: Array<() => void> = []
    ws.on('unexpected-response', (_req, res) => {
      const status = res.statusCode ?? 0
      emitErrorAndExit(
        SOCKET_REFUSALS[status] ?? 'CENTRAL_UNAVAILABLE',
        `attach refused (${status})`,
      )
    })
    ws.on('error', (err) =>
      emitErrorAndExit(
        'CENTRAL_UNAVAILABLE',
        `cannot reach memon central at ${target.base}: ${err.message}`,
        undefined,
        EXIT.GENERIC,
      ),
    )
    ws.on('open', () => {
      if (!interactive) return
      const stdin = process.stdin
      stdin.setRawMode?.(true)
      stdin.resume()
      const onData = (chunk: Buffer) => ws.send(chunk, { binary: true })
      const onResize = () =>
        ws.send(
          JSON.stringify({
            type: 'resize',
            cols: process.stdout.columns,
            rows: process.stdout.rows,
          }),
        )
      stdin.on('data', onData)
      process.stdout.on('resize', onResize)
      restore.push(() => {
        stdin.off('data', onData)
        process.stdout.off('resize', onResize)
        stdin.setRawMode?.(false)
        stdin.pause()
      })
    })
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        write(data as Buffer)
        return
      }
      const message = JSON.parse(data.toString()) as { type?: string; code?: number }
      if (message.type === 'exit' && typeof message.code === 'number') code = message.code
    })
    ws.on('close', () => {
      for (const undo of restore) undo()
      resolve(code)
    })
  })
}

export async function runTicket(
  action: string,
  args: string[],
  opts: Record<string, unknown>,
  deps = defaultDeps(),
): Promise<number> {
  const print = (value: unknown) => deps.out(`${JSON.stringify(value)}\n`)
  const call = (method: string, route: string, body?: unknown) =>
    centralRequest(deps, method, tickets(route), body)
  const forced = opts.force === true
  const force = forced ? { force: true } : {}
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
      print(await call('POST', '', body))
      return EXIT.SUCCESS
    }
    case 'list':
      print(await call('GET', ''))
      return EXIT.SUCCESS
    case 'show':
      print(await call('GET', `/${checkId(args[0] ?? '')}`))
      return EXIT.SUCCESS
    case 'release':
      print(await call('POST', `/${checkId(args[0] ?? '')}/release`, force))
      return EXIT.SUCCESS
    case 'exec': {
      const [id, ...rest] = args
      const checked = checkId(id ?? '')
      const body: Record<string, unknown> = {
        command: line(rest),
        timeout_s: Number(opts.timeout ?? 600),
        ...force,
      }
      if (!deps.isTty && deps.readStdin) {
        const input = await deps.readStdin()
        if (input.length > 0) body.stdin = input.toString('base64')
      }
      return streamExec(deps, checked, body)
    }
    case 'run': {
      const [id, ...rest] = args
      const checked = checkId(id ?? '')
      const result = (await call('POST', `/${checked}/tasks`, {
        command: line(rest),
        ...(typeof opts.name === 'string' ? { name: opts.name } : {}),
        ...force,
      })) as { task: { task: string; terminal: string } }
      print({ ticket: checked, task: result.task.task, terminal: result.task.terminal })
      return EXIT.SUCCESS
    }
    case 'ps':
      print(await call('GET', `/${checkId(args[0] ?? '')}/tasks${forced ? '?force=1' : ''}`))
      return EXIT.SUCCESS
    case 'logs': {
      const id = checkId(args[0] ?? '')
      const task = checkTask(args[1], `memon ticket logs ${id} <task>`)
      const suffix = forced ? '&force=1' : ''
      if (opts.follow === true) {
        // Poll the history rather than watching the terminal: a watch-only
        // attach waits for terminal replies that a pipe never sends.
        const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
        let printed: string[] = []
        for (;;) {
          const { text } = (await call(
            'GET',
            `/${id}/tasks/${task}/logs?lines=${FOLLOW_LINES}${suffix}`,
          )) as { text: string }
          const lines = text.replace(/\s+$/, '').split('\n')
          const fresh = newLines(printed, lines)
          if (fresh.length > 0) deps.out(`${fresh.join('\n')}\n`)
          printed = lines
          const { tasks: views } = (await call(
            'GET',
            `/${id}/tasks${forced ? '?force=1' : ''}`,
          )) as {
            tasks: Array<{ task: string; state: string; exit_code: number | null }>
          }
          const view = views.filter((v) => v.task === decodeURIComponent(task)).at(-1)
          if (!view || view.state !== 'live') return view?.exit_code ?? EXIT.SUCCESS
          await sleep(FOLLOW_INTERVAL_MS)
        }
      }
      const lines = Number(opts.lines ?? 200)
      const { text } = (await call('GET', `/${id}/tasks/${task}/logs?lines=${lines}${suffix}`)) as {
        text: string
      }
      deps.out(text.endsWith('\n') ? text : `${text}\n`)
      return EXIT.SUCCESS
    }
    case 'sync': {
      const id = checkId(args[0] ?? '')
      const result = (await call('POST', `/${id}/sync`, {
        start: opts.start !== false,
        ...force,
      })) as { ticket: { sync?: { state?: string } } }
      print(result)
      return result.ticket.sync?.state === 'READY' ? EXIT.SUCCESS : EXIT.GENERIC
    }
    case 'wait': {
      const id = checkId(args[0] ?? '')
      const deadline = Date.now() + Number(opts.timeout ?? 3600) * 1000
      const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
      if (!args[1]) {
        // The ticket itself: until it is granted and its checkout is synced.
        for (;;) {
          const { ticket: view } = (await call('GET', `/${id}`)) as {
            ticket: { status: string; sync?: { state?: string | null; output?: string | null } }
          }
          const sync = view.sync?.state ?? null
          if (view.status === 'GRANTED' && sync === 'READY') {
            print({ ticket: view })
            return EXIT.SUCCESS
          }
          if (view.status !== 'QUEUED' && view.status !== 'GRANTED') {
            print({ ticket: view })
            return EXIT.GENERIC
          }
          if (sync === 'PULL_FAILED') {
            print({ ticket: view })
            process.stderr.write(
              `memon: the checkout pull failed; fix it with \`memon ticket exec ${id} -- …\`, then run \`memon ticket sync ${id}\`\n`,
            )
            return EXIT.CONFLICT
          }
          if (Date.now() >= deadline) {
            print({ ticket: view })
            return EXIT.GENERIC
          }
          await sleep(3000)
        }
      }
      const task = checkTask(args[1], `memon ticket wait ${id} <task>`)
      for (;;) {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
        const { task: view } = (await call('POST', `/${id}/tasks/${task}/wait`, {
          timeout_s: Math.min(WAIT_SLICE_S, remaining),
          ...force,
        })) as { task: { state: string; exit_code: number | null } }
        if (view.state !== 'live') {
          print({ ticket: id, ...view })
          return EXIT.SUCCESS
        }
        if (remaining === 0) {
          print({ ticket: id, ...view })
          return EXIT.GENERIC
        }
        // A slice can return early (e.g. a proxy cut it short); pace the next one.
        await sleep(1000)
      }
    }
    case 'kill': {
      const id = checkId(args[0] ?? '')
      const task = checkTask(args[1], `memon ticket kill ${id} <task>`)
      print(await call('POST', `/${id}/tasks/${task}/kill`, force))
      return EXIT.SUCCESS
    }
    case 'attach': {
      const id = checkId(args[0] ?? '')
      if (!deps.isTty) emitErrorAndExit('BAD_REQUEST', 'attach needs a terminal')
      return socketSession(
        deps,
        id,
        { ...(args[1] ? { task: args[1] } : {}), ...(forced ? { force: '1' } : {}) },
        true,
      )
    }
    default:
      emitErrorAndExit('BAD_REQUEST', `unknown ticket action ${action}`)
  }
}

export function registerTicketCommands(program: Command): void {
  const ticket = program
    .command('ticket')
    .description('request GPUs from memon central and use them through a ticket')
    .addHelpText(
      'after',
      `
Every subcommand talks to memon central only (see \`memon login\`). Only the
account that requested a ticket may use it; the super admin must add --force.`,
    )
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
  const withForce = (command: Command) =>
    command.option('--force', 'super admin: act on another account’s ticket', false)
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
  ticket.command('show').argument('<id>').description('show one ticket').action(act('show'))
  withForce(
    ticket
      .command('release')
      .argument('<id>')
      .description('release a ticket: stop its tasks and free its GPUs'),
  ).action(act('release'))
  withForce(
    ticket
      .command('exec')
      .argument('<id>')
      .argument('<command...>', 'short command, given after --')
      .option('--timeout <s>', 'seconds before it is ended (max 600)', '600')
      .description(
        'run a short command on the ticket’s GPUs; piped stdin is sent along; exits with its status',
      ),
  ).action(act('exec'))
  withForce(
    ticket
      .command('run')
      .argument('<id>')
      .argument('<command...>', 'long task, given after --')
      .option('--name <task>', 'task name: 1–16 of a-z 0-9 _ - (default: generated)')
      .description('start a long task in a persistent terminal on the ticket’s GPUs'),
  ).action(act('run'))
  withForce(ticket.command('ps').argument('<id>').description('list the ticket’s tasks')).action(
    act('ps'),
  )
  withForce(
    ticket
      .command('logs')
      .argument('<id>')
      .argument('<task>')
      .option('--lines <n>', 'history lines', '200')
      .option(
        '--follow',
        'keep printing new lines until the task ends; exits with its status',
        false,
      )
      .description('print a task’s screen and history'),
  ).action(act('logs'))
  withForce(
    ticket
      .command('sync')
      .argument('<id>')
      .option('--no-start', 'only pull; leave a held start command unstarted')
      .description(
        'pull the ticket’s cluster checkout again; on success start a held start command once',
      ),
  ).action(act('sync'))
  withForce(
    ticket
      .command('wait')
      .argument('<id>')
      .argument('[task]', 'a task; without it, wait until the ticket is granted and synced')
      .option('--timeout <s>', 'seconds to wait (exit 1 if it is still running)', '3600')
      .description(
        'wait until a task stops, or until the ticket is ready (exit 9 when its checkout pull failed)',
      ),
  ).action(act('wait'))
  withForce(
    ticket.command('kill').argument('<id>').argument('<task>').description('end a task'),
  ).action(act('kill'))
  withForce(
    ticket
      .command('attach')
      .argument('<id>')
      .argument('[task]', 'task to attach to (default: a new shell on the ticket’s GPUs)')
      .description('attach this terminal to a task, or open a shell on the ticket’s GPUs'),
  ).action(act('attach'))
}
