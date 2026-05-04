// ttyd subprocess orchestration. v1: at most one ttyd process at a time
// (single port), bound to a tmux session named `memon-claude-<expid>`.
//
// Lifecycle:
//   - startSession kills any prior ttyd, then spawns a new one whose argv is
//     `<ttyd> -p 7682 -i 127.0.0.1 --writable tmux new-session -A -s <name> claude`
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

export async function startSession(input: {
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

  const sessionName = `${SESSION_PREFIX}${input.experimentId}`
  const args = [
    '-p',
    String(PORT),
    '-i',
    '127.0.0.1',
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
