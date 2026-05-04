// ttyd subprocess orchestration. v1: at most one ttyd process at a time
// (single port), bound to a tmux session named `memon-claude-<expid>`.
//
// Security model — three independent gates protect the writable terminal:
//   1. Loopback bind: ttyd listens on 127.0.0.1:7682 only. External hosts
//      cannot reach it directly.
//   2. Caddy `forward_auth`: the production Caddyfile gates the entire
//      memon site (including `/api/terminal/proxy/*`) on a probe to
//      `/api/auth/check`. Anonymous WebSocket upgrades are rejected before
//      they reach ttyd. See README "Production deployment".
//   3. Next.js middleware: `apps/web/middleware.ts` re-verifies HTTP Basic
//      on every request as defense in depth.
//
// We deliberately do NOT pass `-c user:pass` to ttyd. Coupling ttyd's basic-
// auth to memon's `config.yml` hash would require a Caddy reload on every
// password rotation, and the three gates above already cover the threat
// model. See `openspec/changes/add-system-auth/design.md` D5/D7.
//
// Lifecycle:
//   - startSession kills any prior ttyd, then spawns a new one whose argv is
//     `<ttyd> -p 7682 -i 127.0.0.1 -b <basePath> --writable tmux new-session -A -s <name> claude`
//   - stopSession kills the ttyd child but NOT the tmux session — that's the
//     whole point of using tmux: user ssh's in later and `tmux attach -t <name>`
//   - process exit handlers (SIGINT/SIGTERM/beforeExit) kill the child;
//     tmux is independent of memon's process group

import { spawn, type ChildProcess } from 'node:child_process'
import { probeTtyd } from './binary'

const PORT = 7682
const SESSION_PREFIX = 'memon-claude-'
/** Anything more permissive risks tmux command injection via session name. */
const EXP_ID_RE = /^[a-zA-Z0-9._-]+$/

export interface ActiveSession {
  sessionName: string
  port: number
  startedAt: string
  experimentId: string
  projectName: string
  warnings: string[]
}

export class TerminalManagerError extends Error {
  constructor(
    public code: 'BAD_REQUEST' | 'TTYD_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'TerminalManagerError'
  }
}

interface CurrentEntry extends ActiveSession {
  child: ChildProcess
}

// In Next.js dev mode, HMR can reload this module on edits to unrelated
// files. Module-local `let current` would lose the running child reference,
// orphaning the ttyd process. Pin to `globalThis` so the singleton survives
// module re-imports.
const GLOBAL_KEY = '__memonTerminalCurrent' as const
const GLOBAL_HANDLERS_KEY = '__memonTerminalExitRegistered' as const
type GlobalSlot = {
  [GLOBAL_KEY]?: CurrentEntry | null
  [GLOBAL_HANDLERS_KEY]?: boolean
}
const slot = globalThis as unknown as GlobalSlot

function getCurrent(): CurrentEntry | null {
  return slot[GLOBAL_KEY] ?? null
}
function setCurrent(v: CurrentEntry | null): void {
  slot[GLOBAL_KEY] = v
}

function registerExitHandlers(): void {
  if (slot[GLOBAL_HANDLERS_KEY]) return
  slot[GLOBAL_HANDLERS_KEY] = true
  const cleanup = () => {
    const cur = getCurrent()
    if (cur?.child && !cur.child.killed) {
      cur.child.kill('SIGTERM')
    }
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('beforeExit', cleanup)
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!child.killed && child.exitCode === null) child.kill('SIGKILL')
      resolve()
    }, 2000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Serializer: every startSession call awaits the previous one before
 * proceeding. Prevents two concurrent invocations (e.g. React strict mode
 * double-mounting TerminalSheet's effect in dev) from racing on the single
 * shared port 7682.
 */
const SERIALIZER_KEY = '__memonTerminalStartChain' as const
type StartSlot = GlobalSlot & { [SERIALIZER_KEY]?: Promise<unknown> }
const startSlot = globalThis as unknown as StartSlot

export async function startSession(input: {
  experimentId: string
  projectName: string
}): Promise<ActiveSession> {
  const prev = startSlot[SERIALIZER_KEY] ?? Promise.resolve()
  const mine = prev.catch(() => {}).then(() => doStartSession(input))
  // Mark slot "done" even on rejection so the chain doesn't stall
  startSlot[SERIALIZER_KEY] = mine.catch(() => {})
  return mine
}

async function doStartSession(input: {
  experimentId: string
  projectName: string
}): Promise<ActiveSession> {
  if (!EXP_ID_RE.test(input.experimentId)) {
    throw new TerminalManagerError(
      'BAD_REQUEST',
      `experimentId must match ${EXP_ID_RE} (got ${JSON.stringify(input.experimentId)})`,
    )
  }
  if (!input.projectName.trim()) {
    throw new TerminalManagerError('BAD_REQUEST', 'projectName is required')
  }

  const sessionName = `${SESSION_PREFIX}${input.experimentId}`

  // Idempotent: same experiment + healthy ttyd → return existing
  const existingSame = getCurrent()
  if (
    existingSame &&
    existingSame.sessionName === sessionName &&
    !existingSame.child.killed &&
    existingSame.child.exitCode === null
  ) {
    return toPublic(existingSame)
  }

  const probe = await probeTtyd()
  if (!probe.available || !probe.path) {
    throw new TerminalManagerError(
      'TTYD_UNAVAILABLE',
      probe.suggestion ?? 'ttyd is not installed; POST /api/terminal/install',
    )
  }

  // Tear down any existing ttyd before starting the new one
  const existing = getCurrent()
  if (existing) {
    await killChild(existing.child)
    setCurrent(null)
  }

  registerExitHandlers()

  // `-b` (base-path) tells ttyd it's mounted under this URL prefix so the
  // index HTML + WebSocket URL it emits match what Caddy will route. Without
  // it, ttyd emits asset URLs at `/static/*` which Caddy routes to Next.js
  // (404). With it, all URLs are prefixed and stay inside the @terminal
  // matcher.
  const basePath = `/api/terminal/proxy/${sessionName}`
  const args = [
    '-p',
    String(PORT),
    '-i',
    '127.0.0.1',
    '-b',
    basePath,
    '--writable',
    'tmux',
    'new-session',
    '-A',
    '-s',
    sessionName,
    'claude',
  ]

  const child = spawn(probe.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  // Capture early stderr (e.g. "claude: command not found") as a warning
  const warnings: string[] = []
  let stderrBuf = ''
  const onStderr = (b: Buffer) => {
    stderrBuf += b.toString('utf8')
    if (stderrBuf.length > 200) {
      child.stderr?.off('data', onStderr)
    }
  }
  child.stderr?.on('data', onStderr)

  // Surface a warning if the process dies in <500ms (likely command failure)
  let earlyExit = false
  child.once('exit', (code, signal) => {
    earlyExit = true
    if (getCurrent()?.child === child) setCurrent(null)
    if (code !== 0 && stderrBuf) {
      warnings.push(`ttyd exited early (${code ?? signal}): ${stderrBuf.slice(0, 200)}`)
    }
  })

  // Wait briefly for early exit; if survived, treat as started
  await new Promise<void>((resolve) => setTimeout(resolve, 500))

  if (earlyExit) {
    throw new TerminalManagerError(
      'TTYD_UNAVAILABLE',
      `ttyd failed to start: ${stderrBuf.slice(0, 200) || 'no stderr output'}`,
    )
  }

  const session: CurrentEntry = {
    child,
    sessionName,
    port: PORT,
    startedAt: new Date().toISOString(),
    experimentId: input.experimentId,
    projectName: input.projectName,
    warnings,
  }
  setCurrent(session)

  return toPublic(session)
}

export async function stopSession(sessionName: string): Promise<{ stopped: boolean }> {
  const cur = getCurrent()
  if (!cur || cur.sessionName !== sessionName) {
    return { stopped: false }
  }
  await killChild(cur.child)
  setCurrent(null)
  return { stopped: true }
}

export function listSessions(): ActiveSession[] {
  const cur = getCurrent()
  return cur ? [toPublic(cur)] : []
}

function toPublic(c: CurrentEntry): ActiveSession {
  // strip the ChildProcess reference from the public shape
  return {
    sessionName: c.sessionName,
    port: c.port,
    startedAt: c.startedAt,
    experimentId: c.experimentId,
    projectName: c.projectName,
    warnings: [...c.warnings],
  }
}

/** Test-only: reset internal state between unit tests. */
export function __resetForTests(): void {
  const cur = getCurrent()
  if (cur) {
    try {
      cur.child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  setCurrent(null)
}
