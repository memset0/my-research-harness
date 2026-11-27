// WebSocket attach to a ticket's terminal: /api/gpu-pool/tickets/<id>/attach
//   ?task=<task>   attach to that task (default: a new login shell on the ticket's GPUs)
//   &observe=1     watch only
//   &cols=&rows=   initial size
//   &force=1       super admin acting on someone else's ticket
// Client → server: binary frames are keystrokes; text frames are JSON
// `{"type":"resize","cols":N,"rows":N}`. Server → client: binary frames are
// terminal output; a final text frame `{"type":"exit","code":N}` precedes close.
//
// Upgrades bypass the Next middleware, so this authenticates with the shared
// identity resolution and the same `access_clusters` gate and rate limit.

import { spawn } from 'node:child_process'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { type WebSocket, WebSocketServer } from 'ws'
import { levelCan } from '../auth/capabilities'
import { SESSION_COOKIE_NAME } from '../auth/cookies'
import { type RuntimeAuth, resolveIdentity } from '../auth/identity'
import { clientIpFromHeaders, consume, refund } from '../auth/rate-limit'
import { type TicketBroker, TicketError } from './broker'
import { hcPath } from './herdr'
import type { TicketActor } from './types'

const ATTACH_PATH = /^\/api\/gpu-pool\/tickets\/([^/]+)\/attach$/

/**
 * Runs argv on a fresh pseudo-terminal, relaying fd 0/1 and taking
 * `{"cols":N,"rows":N}` lines on fd 3 to resize it. Exits with the child's status.
 */
const PTY_HELPER = String.raw`
import fcntl, json, os, pty, select, signal, struct, sys, termios
cols, rows, argv = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
def size(c, r):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    try: os.kill(pid, signal.SIGWINCH)
    except OSError: pass
size(cols, rows)
ctl, buf, inputs = os.fdopen(3, 'rb', 0), b'', [0, 3, fd]
while True:
    try: ready, _, _ = select.select(inputs, [], [])
    except InterruptedError: continue
    if fd in ready:
        try: data = os.read(fd, 65536)
        except OSError: data = b''
        if not data: break
        os.write(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if data: os.write(fd, data)
        else: inputs.remove(0)
    if 3 in ready:
        data = ctl.read(4096)
        if not data: inputs.remove(3); continue
        buf += data
        while b'\n' in buf:
            line, buf = buf.split(b'\n', 1)
            try:
                msg = json.loads(line); size(int(msg['cols']), int(msg['rows']))
            except Exception: pass
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else status >> 8)
`

export interface AttachGatewayDeps {
  runtimeAuth: RuntimeAuth
  broker: () => TicketBroker
  /** argv run on the PTY for an address; default memon's `hc attach`. */
  attachCommand?: (address: string, observe: boolean) => string[]
}

function deny(socket: Duplex, status: number, message: string): true {
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${message}\n`,
  )
  return true
}

const clamp = (value: string | null, fallback: number, max: number) => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, max) : fallback
}

export function createTicketAttachGateway(deps: AttachGatewayDeps) {
  const wss = new WebSocketServer({ noServer: true })
  const attachCommand =
    deps.attachCommand ??
    ((address: string, observe: boolean) => [
      hcPath(),
      'attach',
      ...(observe ? ['--observe'] : []),
      address,
    ])
  return {
    async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
      const url = new URL(req.url ?? '/', 'http://central.invalid')
      const match = ATTACH_PATH.exec(url.pathname)
      if (!match) return false
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers))
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value])
          headers.append(name, item)
      const ip = clientIpFromHeaders(headers, req.socket.remoteAddress)
      if (!consume(ip).ok) return deny(socket, 429, 'Too Many Requests')
      const cookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`).exec(
        headers.get('cookie') ?? '',
      )
      const identity = await resolveIdentity(
        {
          authorizationHeader: headers.get('authorization'),
          sessionCookieValue: cookie ? decodeURIComponent(cookie[1] as string) : null,
          sharesCookieValue: null,
          allowViewer: false,
        },
        deps.runtimeAuth,
        { validate: async () => false },
      )
      if (identity.refundToken) refund(ip)
      if (!identity.account) return deny(socket, 401, 'Unauthorized')
      if (!levelCan(identity.account.level, 'access_clusters'))
        return deny(socket, 403, 'Forbidden')
      const actor: TicketActor = {
        accountId: identity.account.id,
        username: identity.account.username,
        superAdmin: identity.account.level === 'super_admin',
      }
      let target: { address: string }
      try {
        target = await deps
          .broker()
          .attachTarget(
            decodeURIComponent(match[1] as string),
            actor,
            url.searchParams.get('task'),
            url.searchParams.get('force') === '1',
          )
      } catch (error) {
        if (error instanceof TicketError) {
          const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'BAD_REQUEST' ? 400 : 409
          return deny(socket, status, error.message.replace(/[\r\n]+/g, ' '))
        }
        return deny(socket, 503, 'Attach unavailable')
      }
      const observe = url.searchParams.get('observe') === '1'
      const cols = clamp(url.searchParams.get('cols'), 120, 1000)
      const rows = clamp(url.searchParams.get('rows'), 40, 1000)
      wss.handleUpgrade(req, socket, head, (ws) =>
        bridge(ws, attachCommand(target.address, observe), cols, rows),
      )
      return true
    },
  }
}

function bridge(ws: WebSocket, argv: string[], cols: number, rows: number): void {
  const child = spawn('python3', ['-c', PTY_HELPER, String(cols), String(rows), ...argv], {
    stdio: ['pipe', 'pipe', 'inherit', 'pipe'],
  })
  const control = child.stdio[3] as NodeJS.WritableStream
  child.stdout?.on('data', (chunk: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(chunk)
  })
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      child.stdin?.write(data as Buffer)
      return
    }
    try {
      const message = JSON.parse(data.toString()) as { type?: string; cols?: number; rows?: number }
      if (message.type === 'resize')
        control.write(`${JSON.stringify({ cols: message.cols, rows: message.rows })}\n`)
    } catch {
      // Ignore malformed control frames.
    }
  })
  ws.on('close', () => child.kill('SIGHUP'))
  child.on('close', (code) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code: code ?? 1 }))
      ws.close(1000)
    }
  })
}
