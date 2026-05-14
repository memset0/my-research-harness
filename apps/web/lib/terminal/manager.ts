// ttyd subprocess orchestration with per-sessionName multi-port management.
//
// Each (agent, project, scope, slug) tuple gets its own tmux session AND its
// own ttyd process bound to a dynamically allocated loopback port. The
// manager maintains `Map<sessionName, Entry>` keyed by the canonical session
// name `memon-<agent>-<project>--<scope>--<slug>`. Concurrent sessions are
// allowed; LRU eviction at `terminal.ttyd_max_concurrent` (config) keeps the
// active count bounded, and an Idle TTL killer reaps ttyd processes whose
// WebSocket has been idle for `terminal.ttyd_idle_ttl_minutes` minutes.
//
// Lifecycle invariant: tmux session is durable. Neither LRU eviction, idle
// TTL, nor `memon serve` restart kills tmux. Tmux sessions end only on (a)
// explicit `tmux kill-session` (e.g. via the management page) or (b) the
// user exiting the agent / shell from inside a connected ttyd (default tmux
// behavior).
//
// Security model — three independent gates protect the writable terminal:
//   1. Loopback bind: each ttyd listens on 127.0.0.1:<port> only.
//   2. Custom-server HTTP Basic on /api/terminal/proxy/* (HTTP + WebSocket
//      upgrade): `apps/web/server.ts` verifies credentials against
//      `runtime.auth` for every request and every upgrade on this prefix
//      before forwarding to the per-sessionName ttyd port.
//   3. Next.js middleware HTTP Basic on every other dashboard route as
//      defense-in-depth (`apps/web/middleware.ts`).

import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { probeTtyd } from './binary'
import { clearPaneStateMemo } from './pane-state'

const PORT_BASE = 7682
const PORT_SCAN_LIMIT = 256
const IDLE_TIMER_INTERVAL_MS = 60_000

export const AGENT_KINDS = ['none', 'claude', 'codex', 'opencode'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export const SCOPE_KINDS = ['exp', 'run', 'project'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

/** Visible in tmux session names. `none` is rendered as `terminal`. */
function agentToNameSegment(agent: AgentKind): string {
  return agent === 'none' ? 'terminal' : agent
}

const AGENT_PREFIX_TO_KIND: Record<string, AgentKind> = {
  terminal: 'none',
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
}

const PROJECT_RE = /^[A-Za-z0-9-]+$/
const SLUG_RE = /^[A-Za-z0-9._-]+$/

export interface ActiveSession {
  sessionName: string
  port: number
  startedAt: string
  lastActiveAt: string
  agent: AgentKind
  project: string
  scope: ScopeKind
  slug: string
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

interface Entry {
  child: ChildProcess
  port: number
  sessionName: string
  agent: AgentKind
  project: string
  scope: ScopeKind
  slug: string
  startedAt: string
  /** Wall-clock millis. Bumped on HTTP request, WS connect, WS disconnect. */
  lastActiveAtMs: number
  /** Number of currently-connected ttyd WebSocket clients. */
  wsConnections: number
  warnings: string[]
}

// In Next.js dev mode, HMR can reload this module on edits to unrelated
// files. Module-local state would lose the running children, orphaning
// ttyd processes. Pin to globalThis so the singletons survive module
// re-imports.
const GLOBAL_KEY = '__memonTerminalState' as const
interface GlobalState {
  sessions: Map<string, Entry>
  startChains: Map<string, Promise<unknown>>
  exitHandlersRegistered: boolean
  idleTimer: NodeJS.Timeout | null
  idleTimerCfgMinutes: number
}
function getState(): GlobalState {
  const slot = globalThis as unknown as { [GLOBAL_KEY]?: GlobalState }
  if (!slot[GLOBAL_KEY]) {
    slot[GLOBAL_KEY] = {
      sessions: new Map(),
      startChains: new Map(),
      exitHandlersRegistered: false,
      idleTimer: null,
      idleTimerCfgMinutes: -1,
    }
  }
  return slot[GLOBAL_KEY]!
}

// ---------- Session-name format ----------

export function buildSessionName(input: {
  agent: AgentKind
  project: string
  scope: ScopeKind
  slug: string
}): string {
  if (!PROJECT_RE.test(input.project)) {
    throw new TerminalManagerError(
      'BAD_REQUEST',
      `project must match ${PROJECT_RE} (got ${JSON.stringify(input.project)})`,
    )
  }
  if (!SLUG_RE.test(input.slug)) {
    throw new TerminalManagerError(
      'BAD_REQUEST',
      `slug must match ${SLUG_RE} (got ${JSON.stringify(input.slug)})`,
    )
  }
  if (input.slug.includes('--')) {
    throw new TerminalManagerError(
      'BAD_REQUEST',
      `slug must not contain '--' (the scope delimiter; got ${JSON.stringify(input.slug)})`,
    )
  }
  return `memon-${agentToNameSegment(input.agent)}-${input.project}--${input.scope}--${input.slug}`
}

export interface ParsedSessionName {
  raw: string
  agent: AgentKind | null
  project: string | null
  scope: ScopeKind | null
  slug: string | null
  legacy: boolean
}

export function parseSessionName(name: string): ParsedSessionName {
  const empty = (legacy: boolean): ParsedSessionName => ({
    raw: name,
    agent: null,
    project: null,
    scope: null,
    slug: null,
    legacy,
  })
  if (!name.startsWith('memon-')) return empty(false)
  const tail = name.slice('memon-'.length)
  const dashDash = name.indexOf('--')

  // Legacy: `memon-<agent>-<runId>` (no '--')
  if (dashDash === -1) {
    for (const seg of Object.keys(AGENT_PREFIX_TO_KIND)) {
      if (tail.startsWith(seg + '-')) {
        return {
          raw: name,
          agent: AGENT_PREFIX_TO_KIND[seg]!,
          project: null,
          scope: null,
          slug: null,
          legacy: true,
        }
      }
    }
    return empty(false)
  }

  // New format: split exactly on `--` -> [<memon-agent-project>, <scope>, <slug>]
  const parts = name.split('--')
  if (parts.length !== 3) return empty(false)
  const [first, scopeStr, slug] = parts as [string, string, string]
  if (!first.startsWith('memon-')) return empty(false)
  const after = first.slice('memon-'.length)

  let agent: AgentKind | null = null
  let project: string | null = null
  for (const seg of Object.keys(AGENT_PREFIX_TO_KIND)) {
    if (after.startsWith(seg + '-')) {
      agent = AGENT_PREFIX_TO_KIND[seg]!
      project = after.slice(seg.length + 1)
      break
    }
  }
  if (!agent || !project || !PROJECT_RE.test(project)) return empty(false)
  if (scopeStr !== 'exp' && scopeStr !== 'run' && scopeStr !== 'project') return empty(false)
  if (!SLUG_RE.test(slug) || slug.length === 0) return empty(false)

  return { raw: name, agent, project, scope: scopeStr, slug, legacy: false }
}

// ---------- Port allocator ----------

async function probePortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    let resolved = false
    server.once('error', () => {
      if (!resolved) {
        resolved = true
        resolve(false)
      }
    })
    server.once('listening', () => {
      server.close(() => {
        if (!resolved) {
          resolved = true
          resolve(true)
        }
      })
    })
    server.listen(port, '127.0.0.1')
  })
}

async function allocatePort(state: GlobalState): Promise<number> {
  const used = new Set<number>(Array.from(state.sessions.values()).map((e) => e.port))
  for (let i = 0; i < PORT_SCAN_LIMIT; i++) {
    const candidate = PORT_BASE + i
    if (used.has(candidate)) continue
    if (await probePortAvailable(candidate)) return candidate
  }
  throw new TerminalManagerError(
    'TTYD_UNAVAILABLE',
    `no free port in ${PORT_BASE}..${PORT_BASE + PORT_SCAN_LIMIT - 1}`,
  )
}

// ---------- LRU eviction ----------

async function evictOnce(state: GlobalState): Promise<void> {
  let victim: Entry | null = null
  let connectedFallback: Entry | null = null
  for (const e of state.sessions.values()) {
    if (e.wsConnections === 0) {
      if (!victim || e.lastActiveAtMs < victim.lastActiveAtMs) victim = e
    } else if (!connectedFallback || e.lastActiveAtMs < connectedFallback.lastActiveAtMs) {
      connectedFallback = e
    }
  }
  const target = victim ?? connectedFallback
  if (!target) return
  state.sessions.delete(target.sessionName)
  await killChild(target.child)
}

// ---------- Idle TTL killer ----------

function ensureIdleTimer(state: GlobalState, ttlMinutes: number): void {
  if (state.idleTimerCfgMinutes === ttlMinutes) return
  if (state.idleTimer) {
    clearInterval(state.idleTimer)
    state.idleTimer = null
  }
  state.idleTimerCfgMinutes = ttlMinutes
  if (ttlMinutes <= 0) return

  const ttlMs = ttlMinutes * 60_000
  state.idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [name, e] of state.sessions) {
      if (e.wsConnections > 0) continue
      if (now - e.lastActiveAtMs > ttlMs) {
        state.sessions.delete(name)
        void killChild(e.child).catch(() => {
          /* best-effort */
        })
      }
    }
  }, IDLE_TIMER_INTERVAL_MS)
  state.idleTimer.unref?.()
}

// ---------- Conversation resume probe ----------

async function probeResumeArgvTail(input: {
  agent: AgentKind
  cwd: string
}): Promise<string[]> {
  if (input.agent === 'none') return []
  try {
    if (input.agent === 'claude') {
      // Claude code stores conversation transcripts under
      // `~/.claude/projects/<encoded-cwd>/*.jsonl`. The encoding replaces
      // path separators with hyphens; see `claude --help` `-c/--continue`.
      // Detection: directory exists and contains at least one .jsonl file.
      const encoded = input.cwd.replace(/\//g, '-')
      const dir = join(homedir(), '.claude', 'projects', encoded)
      const items = await fs.readdir(dir)
      if (items.some((n) => n.endsWith('.jsonl'))) return ['--continue']
    }
    // codex / opencode resume mechanics are deferred — fresh start is the
    // safe default until the storage probe is researched per-CLI.
  } catch {
    /* best-effort: any fs error → no resume */
  }
  return []
}

// ---------- Lifecycle helpers ----------

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

function registerExitHandlers(state: GlobalState): void {
  if (state.exitHandlersRegistered) return
  state.exitHandlersRegistered = true
  const cleanup = () => {
    if (state.idleTimer) {
      clearInterval(state.idleTimer)
      state.idleTimer = null
    }
    for (const e of state.sessions.values()) {
      if (e.child && !e.child.killed) e.child.kill('SIGTERM')
    }
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('beforeExit', cleanup)
}

function toPublic(e: Entry): ActiveSession {
  return {
    sessionName: e.sessionName,
    port: e.port,
    startedAt: e.startedAt,
    lastActiveAt: new Date(e.lastActiveAtMs).toISOString(),
    agent: e.agent,
    project: e.project,
    scope: e.scope,
    slug: e.slug,
    warnings: [...e.warnings],
  }
}

// ---------- Public API ----------

export interface StartSessionInput {
  project: string
  scope: ScopeKind
  slug: string
  agent?: AgentKind
  /** Absolute path passed to tmux as `-c <cwd>`. The agent's cwd. */
  cwd: string
  /** From `runtime.config.terminal`. */
  maxConcurrent: number
  /** From `runtime.config.terminal`. `0` disables the killer. */
  idleTtlMinutes: number
}

export async function startSession(input: StartSessionInput): Promise<ActiveSession> {
  const agent: AgentKind = input.agent ?? 'claude'
  const sessionName = buildSessionName({
    agent,
    project: input.project,
    scope: input.scope,
    slug: input.slug,
  })
  const state = getState()
  ensureIdleTimer(state, input.idleTtlMinutes)

  // Per-sessionName serializer: prevents two concurrent startSession calls
  // with the same sessionName from spawning duplicate ttyds. Different
  // sessionNames proceed in parallel (no global serialization).
  const prev = state.startChains.get(sessionName) ?? Promise.resolve()
  const mine = prev.catch(() => {}).then(() => doStartSession(state, input, agent, sessionName))
  state.startChains.set(
    sessionName,
    mine.catch(() => {}),
  )
  return mine
}

async function doStartSession(
  state: GlobalState,
  input: StartSessionInput,
  agent: AgentKind,
  sessionName: string,
): Promise<ActiveSession> {
  // Idempotent return: same sessionName + healthy ttyd → reuse, just bump.
  const existing = state.sessions.get(sessionName)
  if (existing && !existing.child.killed && existing.child.exitCode === null) {
    existing.lastActiveAtMs = Date.now()
    // Treat idempotent reattach as a "user-opened-ttyd" event for the
    // pane-state memo — clears the 'done' marker exactly like a fresh
    // spawn would. See openspec/specs/tmux-session-management/spec.md
    // "Card footer liveness state computed server-side from pane title".
    clearPaneStateMemo(sessionName)
    return toPublic(existing)
  }
  if (existing) state.sessions.delete(sessionName)

  // LRU eviction at cap (kills ttyd; tmux preserved).
  while (state.sessions.size >= input.maxConcurrent) {
    await evictOnce(state)
  }

  const probe = await probeTtyd()
  if (!probe.available || !probe.path) {
    throw new TerminalManagerError(
      'TTYD_UNAVAILABLE',
      probe.suggestion ?? 'ttyd is not installed; POST /api/terminal/install',
    )
  }

  const port = await allocatePort(state)
  const resumeTail = await probeResumeArgvTail({ agent, cwd: input.cwd })

  const basePath = `/api/terminal/proxy/${sessionName}`
  const tmuxTail: string[] = [
    'tmux',
    'new-session',
    '-A',
    '-s',
    sessionName,
    '-c',
    input.cwd,
  ]
  if (agent !== 'none') {
    tmuxTail.push(agent, ...resumeTail)
  }
  const args = [
    '-p',
    String(port),
    '-i',
    '127.0.0.1',
    '-b',
    basePath,
    '--writable',
    ...tmuxTail,
  ]

  const child = spawn(probe.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  const warnings: string[] = []
  let stderrBuf = ''
  const onStderr = (b: Buffer) => {
    stderrBuf += b.toString('utf8')
    if (stderrBuf.length > 200) child.stderr?.off('data', onStderr)
  }
  child.stderr?.on('data', onStderr)

  let earlyExit = false
  child.once('exit', (code, signal) => {
    earlyExit = true
    const cur = state.sessions.get(sessionName)
    if (cur && cur.child === child) state.sessions.delete(sessionName)
    if (code !== 0 && stderrBuf) {
      warnings.push(`ttyd exited early (${code ?? signal}): ${stderrBuf.slice(0, 200)}`)
    }
  })

  await new Promise<void>((r) => setTimeout(r, 500))

  if (earlyExit) {
    throw new TerminalManagerError(
      'TTYD_UNAVAILABLE',
      `ttyd failed to start: ${stderrBuf.slice(0, 200) || 'no stderr output'}`,
    )
  }

  registerExitHandlers(state)

  const entry: Entry = {
    child,
    port,
    sessionName,
    agent,
    project: input.project,
    scope: input.scope,
    slug: input.slug,
    startedAt: new Date().toISOString(),
    lastActiveAtMs: Date.now(),
    wsConnections: 0,
    warnings,
  }
  state.sessions.set(sessionName, entry)
  clearPaneStateMemo(sessionName)
  return toPublic(entry)
}

/** Validates that `sessionName` is a safe `memon-*` name shape. */
const ATTACH_SAFE_NAME_RE = /^memon-[A-Za-z0-9._-]+$/

export interface AttachSessionInput {
  sessionName: string
  /** From `runtime.config.terminal`. */
  maxConcurrent: number
  /** From `runtime.config.terminal`. `0` disables the killer. */
  idleTtlMinutes: number
}

/**
 * Spawn ttyd attached to an existing tmux session by name. Used for
 * "manual" rows on /manage/tmux (legacy or arbitrary `memon-*` names) where
 * no parsed `(agent, project, scope, slug)` is available.
 *
 * Differences from `startSession`:
 *   - tmux argv has NO `-c <cwd>` and NO trailing agent CLI; it's just
 *     `tmux new-session -A -s <sessionName>`. If the session exists, ttyd
 *     attaches; if not, tmux creates a fresh shell at memon's cwd (the
 *     `-A` semantic).
 *   - No conversation resume probe.
 *   - The Entry's `agent / project / scope / slug` are filled by parsing
 *     `sessionName`; unparseable parts surface as nulls (or `'none'`
 *     sentinel for `agent` so the Entry shape stays non-nullable).
 *
 * Reuses everything else: per-sessionName serializer (shared with
 * startSession so concurrent calls don't double-spawn), port allocator,
 * LRU eviction, idle TTL, exit handlers.
 */
export async function attachExistingSession(input: AttachSessionInput): Promise<ActiveSession> {
  if (!ATTACH_SAFE_NAME_RE.test(input.sessionName)) {
    throw new TerminalManagerError(
      'BAD_REQUEST',
      `sessionName must match ${ATTACH_SAFE_NAME_RE} (got ${JSON.stringify(input.sessionName)})`,
    )
  }
  const state = getState()
  ensureIdleTimer(state, input.idleTtlMinutes)

  const sessionName = input.sessionName
  const prev = state.startChains.get(sessionName) ?? Promise.resolve()
  const mine = prev.catch(() => {}).then(() => doAttachSession(state, input, sessionName))
  state.startChains.set(
    sessionName,
    mine.catch(() => {}),
  )
  return mine
}

async function doAttachSession(
  state: GlobalState,
  input: AttachSessionInput,
  sessionName: string,
): Promise<ActiveSession> {
  // Idempotent: if the manager already holds a healthy entry for this
  // sessionName (regardless of whether it was created via start or attach),
  // bump and return.
  const existing = state.sessions.get(sessionName)
  if (existing && !existing.child.killed && existing.child.exitCode === null) {
    existing.lastActiveAtMs = Date.now()
    clearPaneStateMemo(sessionName)
    return toPublic(existing)
  }
  if (existing) state.sessions.delete(sessionName)

  while (state.sessions.size >= input.maxConcurrent) {
    await evictOnce(state)
  }

  const probe = await probeTtyd()
  if (!probe.available || !probe.path) {
    throw new TerminalManagerError(
      'TTYD_UNAVAILABLE',
      probe.suggestion ?? 'ttyd is not installed; POST /api/terminal/install',
    )
  }

  const port = await allocatePort(state)

  const basePath = `/api/terminal/proxy/${sessionName}`
  // Raw-attach argv: no -c, no agent CLI tail. Just attach (or create at
  // memon's cwd if the named session doesn't exist).
  const args = [
    '-p',
    String(port),
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
  ]

  const child = spawn(probe.path, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  const warnings: string[] = []
  let stderrBuf = ''
  const onStderr = (b: Buffer) => {
    stderrBuf += b.toString('utf8')
    if (stderrBuf.length > 200) child.stderr?.off('data', onStderr)
  }
  child.stderr?.on('data', onStderr)

  let earlyExit = false
  child.once('exit', (code, signal) => {
    earlyExit = true
    const cur = state.sessions.get(sessionName)
    if (cur && cur.child === child) state.sessions.delete(sessionName)
    if (code !== 0 && stderrBuf) {
      warnings.push(`ttyd exited early (${code ?? signal}): ${stderrBuf.slice(0, 200)}`)
    }
  })

  await new Promise<void>((r) => setTimeout(r, 500))

  if (earlyExit) {
    throw new TerminalManagerError(
      'TTYD_UNAVAILABLE',
      `ttyd failed to start: ${stderrBuf.slice(0, 200) || 'no stderr output'}`,
    )
  }

  registerExitHandlers(state)

  // Synthesize agent/project/scope/slug from the parsed name. Unparseable
  // names yield nulls for project/scope/slug; agent falls back to 'none' so
  // the Entry's non-nullable agent slot stays well-typed (the Entry's
  // semantics for agent='none' are "no agent CLI was spawned", which
  // matches raw-attach exactly).
  const parsed = parseSessionName(sessionName)
  const entry: Entry = {
    child,
    port,
    sessionName,
    agent: parsed.agent ?? 'none',
    project: parsed.project ?? '',
    scope: parsed.scope ?? 'run',
    slug: parsed.slug ?? '',
    startedAt: new Date().toISOString(),
    lastActiveAtMs: Date.now(),
    wsConnections: 0,
    warnings,
  }
  state.sessions.set(sessionName, entry)
  clearPaneStateMemo(sessionName)
  return toPublic(entry)
}

export async function stopSession(sessionName: string): Promise<{ stopped: boolean }> {
  const state = getState()
  const e = state.sessions.get(sessionName)
  if (!e) return { stopped: false }
  state.sessions.delete(sessionName)
  await killChild(e.child)
  return { stopped: true }
}

export function listSessions(): ActiveSession[] {
  return Array.from(getState().sessions.values()).map(toPublic)
}

export function lookupSession(
  sessionName: string,
): { port: number; lastActiveAt: string } | null {
  const e = getState().sessions.get(sessionName)
  return e
    ? { port: e.port, lastActiveAt: new Date(e.lastActiveAtMs).toISOString() }
    : null
}

/** Bump activity time on any HTTP hit; used by the proxy. */
export function noteHttpActivity(sessionName: string): void {
  const e = getState().sessions.get(sessionName)
  if (e) e.lastActiveAtMs = Date.now()
}

export function noteWsConnect(sessionName: string): void {
  const e = getState().sessions.get(sessionName)
  if (e) {
    e.wsConnections++
    e.lastActiveAtMs = Date.now()
  }
}

export function noteWsDisconnect(sessionName: string): void {
  const e = getState().sessions.get(sessionName)
  if (e) {
    if (e.wsConnections > 0) e.wsConnections--
    e.lastActiveAtMs = Date.now()
  }
}

/** Test-only: reset internal state between unit tests. */
export function __resetForTests(): void {
  const state = getState()
  for (const e of state.sessions.values()) {
    try {
      e.child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
  state.sessions.clear()
  state.startChains.clear()
  if (state.idleTimer) {
    clearInterval(state.idleTimer)
    state.idleTimer = null
  }
  state.idleTimerCfgMinutes = -1
}
