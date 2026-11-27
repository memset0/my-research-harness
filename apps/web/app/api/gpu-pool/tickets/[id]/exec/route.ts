// One-shot command on a granted ticket's GPUs, streamed back as NDJSON:
//   {"stream":"stdout"|"stderr","data":"<base64>"} … then {"exit":<code>}
// Body: {command, timeout_s? (1–600, default 600), stdin? (base64, ≤ 8 MiB), force?}

import type { NextRequest } from 'next/server'
import { TicketError } from '@/lib/server/gpu-pool/broker'
import { spawnHc } from '@/lib/server/gpu-pool/herdr'
import { forceOf, ticketRoute } from '@/lib/server/gpu-pool/http'

export const dynamic = 'force-dynamic'

const MAX_STDIN_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = (await req.json().catch(() => null)) as {
    command?: unknown
    timeout_s?: unknown
    stdin?: unknown
  } | null
  let plan: string[] | null = null
  let stdin: Buffer | null = null
  const checked = await ticketRoute(req, async (broker, actor) => {
    if (!body || typeof body.command !== 'string' || body.command.trim() === '')
      throw new TicketError('BAD_REQUEST', 'command must be a non-empty shell line')
    const timeout = body.timeout_s ?? 600
    if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 600)
      throw new TicketError('BAD_REQUEST', 'timeout_s must be an integer between 1 and 600')
    if (body.stdin !== undefined) {
      if (typeof body.stdin !== 'string') throw new TicketError('BAD_REQUEST', 'stdin is base64')
      stdin = Buffer.from(body.stdin, 'base64')
      if (stdin.length > MAX_STDIN_BYTES)
        throw new TicketError('BAD_REQUEST', 'stdin is limited to 8 MiB')
    }
    plan = await broker.execPlan(id, actor, {
      command: body.command,
      timeoutS: timeout,
      stdin: stdin !== null,
      force: forceOf(req, body),
    })
    return { body: null }
  })
  if (plan === null) return checked
  const args: string[] = plan
  const input: Buffer | null = stdin
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = spawnHc(args)
      const send = (value: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
      child.stdout.on('data', (chunk: Buffer) =>
        send({ stream: 'stdout', data: chunk.toString('base64') }),
      )
      child.stderr.on('data', (chunk: Buffer) =>
        send({ stream: 'stderr', data: chunk.toString('base64') }),
      )
      child.on('error', (error) => {
        send({ stream: 'stderr', data: Buffer.from(`${error.message}\n`).toString('base64') })
        send({ exit: 127 })
        controller.close()
      })
      child.on('close', (code, signal) => {
        send({ exit: code ?? (signal ? 128 + 15 : 1) })
        controller.close()
      })
      req.signal.addEventListener('abort', () => child.kill('SIGTERM'))
      if (input) child.stdin.end(input)
      else child.stdin.end()
    },
  })
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
  })
}
