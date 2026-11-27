// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { captureCli } from '../test-support/results-project.js'
import { newLines, parseDuration, runTicket, type TicketDeps, terminalName } from './ticket.js'

const ID = 'tk_7h3q9m2xw4ra'
const TOKEN = `mtk_${'a'.repeat(43)}`

type Reply = { status: number; body: unknown } | { status: number; raw: string }

/** A central that answers each request in turn and records what it was sent. */
function central(replies: Reply[], over: Partial<TicketDeps> = {}) {
  const queue = [...replies]
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const reply = queue.shift() ?? { status: 500, body: {} }
    return new Response('raw' in reply ? reply.raw : JSON.stringify(reply.body), {
      status: reply.status,
    })
  })
  const output: string[] = []
  const d: TicketDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    env: { MEMON_CENTRAL_URL: 'https://central.test', MEMON_CENTRAL_TOKEN: TOKEN },
    home: '/nonexistent-memon-home',
    out: (text) => output.push(text),
    stdout: (chunk) => output.push(chunk.toString()),
    stderr: (chunk) => output.push(`[err]${chunk.toString()}`),
    isTty: false,
    readStdin: async () => Buffer.alloc(0),
    sleep: async () => {},
    ...over,
  }
  const sent = (i: number) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit]
    return {
      url,
      method: init.method,
      auth: (init.headers as Record<string, string>).authorization,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    }
  }
  return { d, fetchMock, output, sent }
}

describe('memon ticket', () => {
  it('parses durations and names terminals', () => {
    expect(parseDuration('90m')).toBe(5400)
    expect(parseDuration('2d')).toBe(172800)
    expect(terminalName(ID, 'Main')).toBe(`${ID}-main`)
  })

  it('requests with the bearer token and the start command', async () => {
    const { d, sent } = central([{ status: 201, body: { ticket: { id: ID, status: 'QUEUED' } } }])
    expect(
      await runTicket(
        'request',
        ['python', 'train.py'],
        { project: 'project-a', duration: '6h', gpus: '2' },
        d,
      ),
    ).toBe(0)
    expect(sent(0)).toEqual({
      url: 'https://central.test/api/gpu-pool/tickets',
      method: 'POST',
      auth: `Bearer ${TOKEN}`,
      body: { project: 'project-a', duration_s: 21600, gpus: 2, run: 'python train.py' },
    })
  })

  it('maps central errors, and rejects malformed ids before calling central', async () => {
    const { d } = central([
      { status: 409, body: { error: { code: 'OWNER_MISMATCH', message: 'not yours' } } },
    ])
    const refused = await captureCli(() => runTicket('release', [ID], {}, d))
    expect(refused.exitCode).toBe(9)
    expect(refused.error?.details).toEqual({ code: 'OWNER_MISMATCH' })

    const fresh = central([])
    for (const id of ['T1', 'tk_short', 'TK_7H3Q9M2XW4RA']) {
      const result = await captureCli(() => runTicket('show', [id], {}, fresh.d))
      expect(result.error?.code).toBe('BAD_REQUEST')
    }
    expect(fresh.fetchMock).not.toHaveBeenCalled()
  })

  it('sends force on release when asked', async () => {
    const { d, sent } = central([{ status: 200, body: { ticket: { id: ID } } }])
    await runTicket('release', [ID], { force: true }, d)
    expect(sent(0).body).toEqual({ force: true })
  })

  it('streams exec output, forwards piped stdin and exits with the command status', async () => {
    const frames = [
      { stream: 'stdout', data: Buffer.from('GPU 0\n').toString('base64') },
      { stream: 'stderr', data: Buffer.from('warn\n').toString('base64') },
      { exit: 7 },
    ]
    const { d, output, sent } = central(
      [{ status: 200, raw: frames.map((f) => JSON.stringify(f)).join('\n') }],
      { readStdin: async () => Buffer.from('input') },
    )
    expect(await runTicket('exec', [ID, 'nvidia-smi', '-L'], { timeout: '60' }, d)).toBe(7)
    expect(output).toEqual(['GPU 0\n', '[err]warn\n'])
    expect(sent(0)).toMatchObject({
      url: `https://central.test/api/gpu-pool/tickets/${ID}/exec`,
      body: {
        command: 'nvidia-smi -L',
        timeout_s: 60,
        stdin: Buffer.from('input').toString('base64'),
      },
    })
  })

  it('reports exec refusals with the usual exit codes', async () => {
    const { d } = central([
      { status: 409, body: { error: { code: 'CONFLICT', message: `ticket ${ID} is QUEUED` } } },
    ])
    const result = await captureCli(() => runTicket('exec', [ID, 'ls'], {}, d))
    expect(result.exitCode).toBe(9)
  })

  it('starts tasks, reads logs and kills through central', async () => {
    const { d, output, sent } = central([
      { status: 201, body: { task: { task: 'train', terminal: 'node-01/t9' } } },
      { status: 200, body: { text: 'epoch 1' } },
      { status: 200, body: { task: { task: 'train', state: 'finished' } } },
    ])
    await runTicket('run', [ID, 'python', 'train.py'], { name: 'train' }, d)
    await runTicket('logs', [ID, 'train'], { lines: '50' }, d)
    await runTicket('kill', [ID, 'train'], {}, d)
    expect(sent(0)).toMatchObject({
      url: `https://central.test/api/gpu-pool/tickets/${ID}/tasks`,
      body: { command: 'python train.py', name: 'train' },
    })
    expect(sent(1).url).toBe(
      `https://central.test/api/gpu-pool/tickets/${ID}/tasks/train/logs?lines=50`,
    )
    expect(sent(2).url).toBe(`https://central.test/api/gpu-pool/tickets/${ID}/tasks/train/kill`)
    expect(output[0]).toBe(
      `${JSON.stringify({ ticket: ID, task: 'train', terminal: 'node-01/t9' })}\n`,
    )
    expect(output[1]).toBe('epoch 1\n')
  })

  it('waits in slices until the task stops, and exits 1 at its own timeout', async () => {
    const live = { status: 200, body: { task: { task: 'train', state: 'live', exit_code: null } } }
    const done = { status: 200, body: { task: { task: 'train', state: 'finished', exit_code: 0 } } }
    const stops = central([live, live, done])
    expect(await runTicket('wait', [ID, 'train'], { timeout: '600' }, stops.d)).toBe(0)
    expect(stops.fetchMock).toHaveBeenCalledTimes(3)
    expect(stops.sent(0).body).toEqual({ timeout_s: 60 })

    const timeout = central([live])
    expect(await runTicket('wait', [ID, 'train'], { timeout: '0' }, timeout.d)).toBe(1)
  })

  it('follows a task by polling its history and exits with its status', async () => {
    const live = {
      status: 200,
      body: { tasks: [{ task: 'train', state: 'live', exit_code: null }] },
    }
    const done = {
      status: 200,
      body: { tasks: [{ task: 'train', state: 'finished', exit_code: 3 }] },
    }
    const { d, output } = central([
      { status: 200, body: { text: 'a\nb\n\n' } },
      live,
      { status: 200, body: { text: 'a\nb\nc\nd\n' } },
      done,
    ])
    expect(await runTicket('logs', [ID, 'train'], { follow: true }, d)).toBe(3)
    expect(output).toEqual(['a\nb\n', 'c\nd\n'])
  })

  it('finds new lines after the last printed ones', () => {
    expect(newLines([], ['x'])).toEqual(['x'])
    expect(newLines(['1', '2', '3'], ['2', '3', '4', '5'])).toEqual(['4', '5'])
    expect(newLines(['a', 'b'], ['a', 'b'])).toEqual([])
    expect(newLines(['gone'], ['new'])).toEqual(['new'])
  })

  it('attaches over a WebSocket to central and returns the terminal exit code', async () => {
    const socket = new EventEmitter() as EventEmitter & { send: (data: unknown) => void }
    socket.send = vi.fn()
    const opened: Array<{ url: string; headers: Record<string, string> }> = []
    const { d, output } = central([], {
      isTty: true,
      openSocket: (url, headers) => {
        opened.push({ url, headers })
        setTimeout(() => {
          socket.emit('message', Buffer.from('prompt$ '), true)
          socket.emit('message', Buffer.from(JSON.stringify({ type: 'exit', code: 4 })), false)
          socket.emit('close')
        }, 0)
        return socket as unknown as WebSocket
      },
    })
    expect(await runTicket('attach', [ID, 'train'], {}, d)).toBe(4)
    const url = new URL(opened[0]?.url ?? '')
    expect(url.protocol).toBe('wss:')
    expect(url.pathname).toBe(`/api/gpu-pool/tickets/${ID}/attach`)
    expect(url.searchParams.get('task')).toBe('train')
    expect(opened[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(output).toEqual(['prompt$ '])
  })

  it('refuses attach without a terminal', async () => {
    const { d } = central([])
    const result = await captureCli(() => runTicket('attach', [ID], {}, d))
    expect(result.error?.code).toBe('BAD_REQUEST')
  })
})
