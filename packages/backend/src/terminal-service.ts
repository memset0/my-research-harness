import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import {
  type AgentKind,
  type BackendHerdrStartRequest,
  type BackendTerminalAttachRequest,
  BackendTerminalCheckResponseSchema,
  BackendTerminalInstallResponseSchema,
  BackendTerminalListResponseSchema,
  type BackendTerminalSession,
  type BackendTerminalStartRequest,
  BackendTerminalStartResponseSchema,
  BackendTerminalStopResponseSchema,
  type BackendTmuxCreateRequest,
  BackendTmuxCreateResponseSchema,
  BackendTmuxKillResponseSchema,
  type BackendTmuxRenameRequest,
  BackendTmuxRenameResponseSchema,
  BackendTmuxSessionResponseSchema,
  BackendTmuxSessionRowSchema,
  BackendTmuxSessionsResponseSchema,
  discoverExperiments,
  discoverRuns,
  HostIdSchema,
  type ProjectConfig,
  type TerminalConfig,
  TerminalSessionIdSchema,
} from '@memon/core'
import {
  type BackendTerminalInstallResult,
  type BackendTerminalProbeResult,
  installBackendTtyd,
  probeBackendTtyd,
} from './terminal-binary.js'

export type BackendTerminalStartInput = BackendTerminalStartRequest
export type BackendTerminalAttachInput = BackendTerminalAttachRequest

export interface BackendTerminalService {
  check(): Promise<unknown>
  install(): Promise<unknown>
  start(input: BackendTerminalStartInput): Promise<unknown>
  startHerdr(input: BackendHerdrStartRequest): Promise<unknown>
  attach(input: BackendTerminalAttachInput): Promise<unknown>
  list(): Promise<unknown> | unknown
  stop(input: BackendTerminalAttachInput): Promise<unknown>
  listTmux(): Promise<unknown>
  getTmux(sessionName: string): Promise<unknown>
  createTmux(input: BackendTmuxCreateRequest): Promise<unknown>
  renameTmux(sessionName: string, input: BackendTmuxRenameRequest): Promise<unknown>
  killTmux(sessionName: string): Promise<unknown>
  target(sessionName: string): string | null
  noteHttpActivity?(sessionName: string): void
  noteWsConnect?(sessionName: string): void
  noteWsDisconnect?(sessionName: string): void
  close?(): void
}

export type BackendTerminalServiceErrorCode =
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'TTYD_UNAVAILABLE'
  | 'PROJECT_NOT_FOUND'

export class BackendTerminalServiceError extends Error {
  constructor(
    public readonly code: BackendTerminalServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BackendTerminalServiceError'
  }
}

export interface LocalBackendTerminalServiceOptions {
  hostId: string
  projects: readonly ProjectConfig[]
  terminal: TerminalConfig
  portBase?: number
  portScanLimit?: number
  idleCheckIntervalMs?: number
  startupGraceMs?: number
  now?: () => number
  spawnProcess?: typeof spawn
  probe?: () => Promise<BackendTerminalProbeResult>
  install?: () => Promise<BackendTerminalInstallResult>
  allocatePort?: (usedPorts: ReadonlySet<number>) => Promise<number>
  execTmux?: (args: readonly string[]) => Promise<string>
  execHerdr?: (cli: readonly string[], args: readonly string[]) => Promise<string>
  /** Standalone Web compatibility; Backend deployments must leave false. */
  standaloneProxyPaths?: boolean
  /** Preserve standalone's historical HOME/project-root fallback warnings. */
  standaloneTargetFallback?: boolean
}

interface TerminalEntry {
  backend: 'tmux' | 'herdr'
  child: ChildProcess
  port: number
  sessionName: string
  startedAt: string
  lastActiveAtMs: number
  wsConnections: number
  agent: AgentKind
  project: string | null
  scope: 'exp' | 'run' | 'project' | null
  slug: string | null
  warnings: string[]
}

const DEFAULT_PORT_BASE = 7682
const DEFAULT_PORT_SCAN_LIMIT = 256
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 60_000
const SESSION_PREFIX_BY_AGENT: Record<AgentKind, string> = {
  none: 'terminal',
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
}
const RAW_SESSION_PATTERN = /^memon-[A-Za-z0-9._-]+$/
const TMUX_LIST_FORMAT = '#{session_name}|#{session_created}|#{session_activity}'
const TMUX_PANE_FORMAT =
  '#{session_name}|#{window_active}|#{pane_active}|#{pane_current_command}|#{pane_title}'
const TMUX_OUTPUT_LIMIT = 1024 * 1024
const TMUX_TIMEOUT_MS = 5_000

interface PaneMemoEntry {
  hadRunning: boolean
  state: 'idle' | 'running' | 'attention' | 'done'
  changedAt: string | null
}

async function defaultAllocatePort(
  usedPorts: ReadonlySet<number>,
  portBase: number,
  portScanLimit: number,
): Promise<number> {
  for (let offset = 0; offset < portScanLimit; offset += 1) {
    const port = portBase + offset
    if (usedPorts.has(port)) continue
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer()
      let settled = false
      const finish = (result: boolean) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      server.once('error', () => finish(false))
      server.once('listening', () => server.close(() => finish(true)))
      server.listen(port, '127.0.0.1')
    })
    if (available) return port
  }
  throw new BackendTerminalServiceError('TTYD_UNAVAILABLE', 'No loopback ttyd port is available')
}

function buildSessionName(input: BackendTerminalStartInput): string {
  const agent = input.agent ?? 'claude'
  return TerminalSessionIdSchema.parse(
    `memon-${SESSION_PREFIX_BY_AGENT[agent]}-${input.project}--${input.scope}--${input.slug}`,
  )
}

function parseRawSession(
  sessionName: string,
): Pick<TerminalEntry, 'agent' | 'project' | 'scope' | 'slug'> {
  const match =
    /^memon-(terminal|claude|codex|opencode)-([A-Za-z0-9-]+)--(exp|run|project)--([A-Za-z0-9._-]+)$/.exec(
      sessionName,
    )
  if (!match) return { agent: 'none', project: null, scope: null, slug: null }
  const agent = match[1] === 'terminal' ? 'none' : (match[1] as AgentKind)
  return {
    agent,
    project: match[2]!,
    scope: match[3] as 'exp' | 'run' | 'project',
    slug: match[4]!,
  }
}

function parseTmuxSession(sessionName: string) {
  const raw = TerminalSessionIdSchema.parse(sessionName)
  const parts = sessionName.split('--')
  if (parts.length !== 3) {
    const legacy = /^memon-(terminal|claude|codex|opencode)-/.test(sessionName)
    return {
      raw,
      agent: null,
      project: null,
      scope: null,
      slug: null,
      legacy,
    }
  }
  const parsed = parseRawSession(sessionName)
  return {
    raw,
    agent: parsed.agent,
    project: parsed.project,
    scope: parsed.scope,
    slug: parsed.slug,
    legacy: false,
  }
}

function epochToIso(epoch: string | undefined): string {
  if (!epoch) return ''
  const seconds = Number(epoch)
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000).toISOString() : ''
}

/** Node-local ttyd/tmux lifecycle owner used by the standalone and Backend compositions. */
export class LocalBackendTerminalService implements BackendTerminalService {
  private readonly hostId: ReturnType<typeof HostIdSchema.parse>
  private readonly projects: readonly ProjectConfig[]
  private readonly terminal: TerminalConfig
  private readonly portBase: number
  private readonly portScanLimit: number
  private readonly startupGraceMs: number
  private readonly now: () => number
  private readonly spawnProcess: typeof spawn
  private readonly probe: () => Promise<BackendTerminalProbeResult>
  private readonly installBinary: () => Promise<BackendTerminalInstallResult>
  private readonly allocatePortOverride?: (usedPorts: ReadonlySet<number>) => Promise<number>
  private readonly execTmux: (args: readonly string[]) => Promise<string>
  private readonly execHerdr: (cli: readonly string[], args: readonly string[]) => Promise<string>
  private readonly entries = new Map<string, TerminalEntry>()
  private readonly startChains = new Map<string, Promise<unknown>>()
  private readonly paneMemo = new Map<string, PaneMemoEntry>()
  private paneCache: {
    at: number
    panes: Map<string, { title: string | null; currentCommand: string | null }>
  } | null = null
  private lifecycleChain: Promise<void> = Promise.resolve()
  private readonly idleTimer: NodeJS.Timeout | null
  private readonly standaloneProxyPaths: boolean
  private readonly standaloneTargetFallback: boolean
  private closed = false

  constructor(options: LocalBackendTerminalServiceOptions) {
    this.hostId = HostIdSchema.parse(options.hostId)
    this.projects = options.projects
    this.terminal = options.terminal
    this.portBase = options.portBase ?? DEFAULT_PORT_BASE
    this.portScanLimit = options.portScanLimit ?? DEFAULT_PORT_SCAN_LIMIT
    this.startupGraceMs = options.startupGraceMs ?? 500
    this.now = options.now ?? Date.now
    this.spawnProcess = options.spawnProcess ?? spawn
    this.probe = options.probe ?? probeBackendTtyd
    this.installBinary = options.install ?? installBackendTtyd
    this.allocatePortOverride = options.allocatePort
    this.execTmux = options.execTmux ?? ((args) => this.defaultExecTmux(args))
    this.execHerdr = options.execHerdr ?? ((cli, args) => this.defaultExecHerdr(cli, args))
    this.standaloneProxyPaths = options.standaloneProxyPaths ?? false
    this.standaloneTargetFallback = options.standaloneTargetFallback ?? false
    const ttl = this.terminal.ttydIdleTtlMinutes
    if (ttl > 0) {
      this.idleTimer = setInterval(
        () => void this.cleanupExpired(),
        options.idleCheckIntervalMs ?? DEFAULT_IDLE_CHECK_INTERVAL_MS,
      )
      this.idleTimer.unref?.()
    } else {
      this.idleTimer = null
    }
  }

  async check(): Promise<unknown> {
    const result = await this.probe()
    return BackendTerminalCheckResponseSchema.parse({
      available: result.available,
      ...(result.version ? { version: result.version } : {}),
      ...(result.source ? { source: result.source } : {}),
      ...(result.downloadable !== undefined ? { downloadable: result.downloadable } : {}),
      ...(result.suggestion ? { suggestion: result.suggestion } : {}),
    })
  }

  async install(): Promise<unknown> {
    const result = await this.installBinary()
    return BackendTerminalInstallResponseSchema.parse({
      ok: true,
      version: result.version,
      ...(result.alreadyPresent !== undefined ? { alreadyPresent: result.alreadyPresent } : {}),
      durationMs: result.durationMs,
    })
  }

  start(input: BackendTerminalStartInput): Promise<unknown> {
    if (!this.terminal.tmuxEnabled) {
      return Promise.reject(
        new BackendTerminalServiceError('BAD_REQUEST', 'tmux integration is disabled'),
      )
    }
    const sessionName = buildSessionName(input)
    return this.serialized(sessionName, () =>
      this.exclusive(async () => {
        const existing = this.healthyEntry(sessionName)
        if (existing) {
          existing.lastActiveAtMs = this.now()
          this.paneMemo.delete(sessionName)
          return this.publicSession(existing)
        }
        const { cwd, warnings } = await this.resolveCwd(input)
        return this.spawnTtyd({
          backend: 'tmux',
          sessionName,
          agent: input.agent ?? 'claude',
          project: input.project,
          scope: input.scope,
          slug: input.slug,
          warnings,
          tmuxArgv: [
            'tmux',
            'new-session',
            '-A',
            '-s',
            sessionName,
            '-c',
            cwd,
            ...(this.terminal.commands[input.agent ?? 'claude'] ?? []),
          ],
        })
      }),
    )
  }

  startHerdr(input: BackendHerdrStartRequest): Promise<unknown> {
    const herdr = this.terminal.herdr
    if (!herdr || herdr.cli.length === 0 || herdr.cli.some((argument) => argument.length === 0)) {
      return Promise.reject(
        new BackendTerminalServiceError('BAD_REQUEST', 'Herdr integration is disabled'),
      )
    }
    const sessionName = TerminalSessionIdSchema.parse('memon-herdr')
    return this.serialized(sessionName, () =>
      this.exclusive(async () => {
        const target =
          input.project && input.scope && input.slug
            ? await this.resolveCwd({ ...input, agent: 'none' } as BackendTerminalStartInput)
            : { cwd: process.cwd(), warnings: [] }
        let entry = this.healthyEntry(sessionName)
        if (!entry) {
          await this.spawnTtyd({
            backend: 'herdr',
            sessionName,
            agent: 'none',
            project: input.project ?? null,
            scope: input.scope ?? null,
            slug: input.slug ?? 'herdr',
            warnings: target.warnings,
            tmuxArgv: [...herdr.cli],
            cwd: target.cwd,
          })
          entry = this.healthyEntry(sessionName)
          if (!entry) {
            throw new BackendTerminalServiceError(
              'TTYD_UNAVAILABLE',
              'Herdr terminal failed to register',
            )
          }
        } else {
          entry.lastActiveAtMs = this.now()
          entry.project = input.project ?? entry.project
          entry.scope = input.scope ?? entry.scope
          entry.slug = input.slug ?? entry.slug
        }
        if (input.project && input.scope && input.slug) {
          await this.ensureHerdrWorkspace(
            herdr.cli,
            input.scope === 'project' ? input.project : input.slug,
            target.cwd,
          )
        }
        return this.publicSession(entry)
      }),
    )
  }

  attach(input: BackendTerminalAttachInput): Promise<unknown> {
    if (!this.terminal.tmuxEnabled) {
      return Promise.reject(
        new BackendTerminalServiceError('BAD_REQUEST', 'tmux integration is disabled'),
      )
    }
    if (!RAW_SESSION_PATTERN.test(input.sessionName)) {
      throw new BackendTerminalServiceError('BAD_REQUEST', 'Terminal session name is invalid')
    }
    return this.serialized(input.sessionName, () =>
      this.exclusive(async () => {
        const existing = this.healthyEntry(input.sessionName)
        if (existing) {
          existing.lastActiveAtMs = this.now()
          this.paneMemo.delete(input.sessionName)
          return this.publicSession(existing)
        }
        return this.spawnTtyd({
          backend: 'tmux',
          sessionName: input.sessionName,
          ...parseRawSession(input.sessionName),
          warnings: [],
          tmuxArgv: ['tmux', 'new-session', '-A', '-s', input.sessionName],
        })
      }),
    )
  }

  list(): unknown {
    return BackendTerminalListResponseSchema.parse({
      sessions: [...this.entries.values()].map((entry) => this.publicSession(entry)),
    })
  }

  async stop(input: BackendTerminalAttachInput): Promise<unknown> {
    return this.exclusive(async () => {
      const entry = this.entries.get(input.sessionName)
      if (!entry) return BackendTerminalStopResponseSchema.parse({ stopped: false })
      this.entries.delete(input.sessionName)
      await this.killChild(entry.child)
      return BackendTerminalStopResponseSchema.parse({ stopped: true })
    })
  }

  async listTmux(): Promise<unknown> {
    this.requireTmux()
    let stdout: string
    try {
      stdout = await this.execTmux(['ls', '-F', TMUX_LIST_FORMAT])
    } catch {
      return BackendTmuxSessionsResponseSchema.parse({ sessions: [] })
    }
    const panes = await this.activePanes()
    const rows = []
    const activeNames = new Set<string>()
    for (const rawLine of stdout.split('\n')) {
      const [sessionName, created, activity] = rawLine.trim().split('|')
      if (!sessionName?.startsWith('memon-') || !RAW_SESSION_PATTERN.test(sessionName)) continue
      activeNames.add(sessionName)
      const parsed = parseTmuxSession(sessionName)
      const classification = await this.classifyTmux(parsed)
      const pane = panes.get(sessionName) ?? null
      const paneState = this.computePaneState(sessionName, pane?.title ?? null)
      const entry = this.healthyEntry(sessionName)
      rows.push(
        BackendTmuxSessionRowSchema.parse({
          host: this.hostId,
          sessionName,
          parsed,
          liveEntry: entry ? { lastActiveAt: new Date(entry.lastActiveAtMs).toISOString() } : null,
          tmuxCreatedAt: epochToIso(created),
          tmuxLastActivity: epochToIso(activity),
          matchable: classification.matchable,
          staleReason: classification.staleReason,
          pane: pane ? { ...pane, currentPath: null } : null,
          state: paneState.state,
          lastStateChangeAt: paneState.changedAt,
        }),
      )
    }
    for (const name of this.paneMemo.keys()) {
      if (!activeNames.has(name)) this.paneMemo.delete(name)
    }
    rows.sort(
      (a, b) =>
        Date.parse(b.tmuxLastActivity || '1970-01-01') -
        Date.parse(a.tmuxLastActivity || '1970-01-01'),
    )
    return BackendTmuxSessionsResponseSchema.parse({ sessions: rows })
  }

  async getTmux(sessionName: string): Promise<unknown> {
    this.requireSessionName(sessionName)
    const list = BackendTmuxSessionsResponseSchema.parse(await this.listTmux())
    const row = list.sessions.find((candidate) => candidate.sessionName === sessionName)
    if (!row) throw new BackendTerminalServiceError('PROJECT_NOT_FOUND', 'tmux session not found')
    return BackendTmuxSessionResponseSchema.parse({ row })
  }

  async createTmux(input: BackendTmuxCreateRequest): Promise<unknown> {
    this.requireTmux()
    const sessionName = TerminalSessionIdSchema.parse(`memon-manual-${input.name}`)
    return this.exclusive(async () => {
      const alreadyExisted = await this.tmuxHasSession(sessionName)
      if (!alreadyExisted) {
        await this.execTmux(['new-session', '-d', '-s', sessionName, '-c', process.cwd()])
      }
      return BackendTmuxCreateResponseSchema.parse({
        ok: true,
        host: this.hostId,
        sessionName,
        alreadyExisted,
      })
    })
  }

  async renameTmux(sessionName: string, input: BackendTmuxRenameRequest): Promise<unknown> {
    this.requireTmux()
    this.requireSessionName(sessionName)
    this.requireSessionName(input.newName)
    if (sessionName === input.newName) {
      throw new BackendTerminalServiceError('BAD_REQUEST', 'newName must differ from old name')
    }
    return this.exclusive(async () => {
      if (!(await this.tmuxHasSession(sessionName))) {
        throw new BackendTerminalServiceError('PROJECT_NOT_FOUND', 'tmux session not found')
      }
      if (await this.tmuxHasSession(input.newName)) {
        throw new BackendTerminalServiceError('CONFLICT', 'target tmux session already exists')
      }
      const entry = this.entries.get(sessionName)
      if (entry) {
        this.entries.delete(sessionName)
        await this.killChild(entry.child)
      }
      await this.execTmux(['rename-session', '-t', sessionName, input.newName])
      this.paneMemo.delete(sessionName)
      this.paneCache = null
      return BackendTmuxRenameResponseSchema.parse({
        ok: true,
        host: this.hostId,
        sessionName: input.newName,
      })
    })
  }

  async killTmux(sessionName: string): Promise<unknown> {
    this.requireTmux()
    this.requireSessionName(sessionName)
    return this.exclusive(async () => {
      if (!(await this.tmuxHasSession(sessionName))) {
        throw new BackendTerminalServiceError('PROJECT_NOT_FOUND', 'tmux session not found')
      }
      const entry = this.entries.get(sessionName)
      if (entry) {
        this.entries.delete(sessionName)
        await this.killChild(entry.child)
      }
      await this.execTmux(['kill-session', '-t', sessionName])
      this.paneMemo.delete(sessionName)
      this.paneCache = null
      return BackendTmuxKillResponseSchema.parse({
        ok: true,
        host: this.hostId,
        sessionName,
      })
    })
  }

  target(sessionName: string): string | null {
    const entry = this.healthyEntry(sessionName)
    return entry ? `http://127.0.0.1:${entry.port}` : null
  }

  noteHttpActivity(sessionName: string): void {
    const entry = this.entries.get(sessionName)
    if (entry) entry.lastActiveAtMs = this.now()
  }

  noteWsConnect(sessionName: string): void {
    const entry = this.entries.get(sessionName)
    if (!entry) return
    entry.wsConnections += 1
    entry.lastActiveAtMs = this.now()
  }

  noteWsDisconnect(sessionName: string): void {
    const entry = this.entries.get(sessionName)
    if (!entry) return
    entry.wsConnections = Math.max(0, entry.wsConnections - 1)
    entry.lastActiveAtMs = this.now()
  }

  async cleanupExpired(): Promise<void> {
    await this.exclusive(async () => {
      const ttlMs = this.terminal.ttydIdleTtlMinutes * 60_000
      if (ttlMs <= 0) return
      const expired = [...this.entries.values()].filter(
        (entry) => entry.wsConnections === 0 && this.now() - entry.lastActiveAtMs > ttlMs,
      )
      for (const entry of expired) {
        if (this.entries.get(entry.sessionName) !== entry) continue
        this.entries.delete(entry.sessionName)
        await this.killChild(entry.child)
      }
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.idleTimer) clearInterval(this.idleTimer)
    for (const entry of this.entries.values()) {
      entry.child.kill('SIGTERM')
    }
    this.entries.clear()
    this.startChains.clear()
    this.paneMemo.clear()
    this.paneCache = null
  }

  private serialized(sessionName: string, operation: () => Promise<unknown>): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new BackendTerminalServiceError('TTYD_UNAVAILABLE', 'Terminal manager is stopped'),
      )
    }
    const previous = this.startChains.get(sessionName) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const tracked = current
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.startChains.get(sessionName) === tracked) this.startChains.delete(sessionName)
      })
    this.startChains.set(sessionName, tracked)
    return current
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.lifecycleChain.catch(() => undefined).then(operation)
    this.lifecycleChain = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  private healthyEntry(sessionName: string): TerminalEntry | null {
    const entry = this.entries.get(sessionName)
    if (!entry) return null
    if (entry.child.killed || entry.child.exitCode !== null) {
      this.entries.delete(sessionName)
      return null
    }
    return entry
  }

  private async resolveCwd(input: BackendTerminalStartInput): Promise<{
    cwd: string
    warnings: string[]
  }> {
    const project = this.projects.find((candidate) => candidate.name === input.project)
    if (!project) {
      if (this.standaloneTargetFallback) {
        return {
          cwd: homedir(),
          warnings: [`project "${input.project}" not in config; opened at HOME`],
        }
      }
      throw new BackendTerminalServiceError('PROJECT_NOT_FOUND', 'Project is not configured')
    }
    if (input.scope === 'exp' && this.standaloneTargetFallback) {
      const experiments = await discoverExperiments(project.root, project.name)
      const found = experiments.experiments.some((experiment) => experiment.id === input.slug)
      return {
        cwd: project.root,
        warnings: found
          ? []
          : [`exp "${input.slug}" not found in project "${project.name}"; opened at project root`],
      }
    }
    if (input.scope !== 'run') return { cwd: project.root, warnings: [] }
    const paths = await discoverRuns(project)
    const run = paths.find((path) => basename(path) === input.slug)
    return run
      ? { cwd: run, warnings: [] }
      : {
          cwd: project.root,
          warnings: [
            this.standaloneTargetFallback
              ? `target run "${input.slug}" not found in project "${project.name}"; opened at project root`
              : `Run ${input.slug} was not found; opened at Project root`,
          ],
        }
  }

  private async spawnTtyd(input: {
    backend: 'tmux' | 'herdr'
    sessionName: string
    agent: AgentKind
    project: string | null
    scope: 'exp' | 'run' | 'project' | null
    slug: string | null
    warnings: string[]
    tmuxArgv: string[]
    cwd?: string
  }): Promise<unknown> {
    while (this.entries.size >= this.terminal.ttydMaxConcurrent) await this.evictLru()
    const probe = await this.probe()
    if (!probe.available || !probe.path) {
      throw new BackendTerminalServiceError(
        'TTYD_UNAVAILABLE',
        probe.suggestion ?? 'ttyd is unavailable on the selected Host',
      )
    }
    const usedPorts = new Set([...this.entries.values()].map((entry) => entry.port))
    const port = this.allocatePortOverride
      ? await this.allocatePortOverride(usedPorts)
      : await defaultAllocatePort(usedPorts, this.portBase, this.portScanLimit)
    const basePath = this.standaloneProxyPaths
      ? `/api/terminal/proxy/${input.sessionName}`
      : `/api/terminal/proxy/${this.hostId}/${input.sessionName}`
    const child = this.spawnProcess(
      probe.path,
      ['-p', String(port), '-i', '127.0.0.1', '-b', basePath, '--writable', ...input.tmuxArgv],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      },
    )
    const stderr: Buffer[] = []
    child.stderr?.on('data', (chunk: Buffer) => {
      if (Buffer.concat(stderr).length < 512) stderr.push(chunk.subarray(0, 512))
    })
    let failed: Error | null = null
    const onError = () => {
      failed = new Error('ttyd failed to start')
    }
    const onExit = () => {
      failed = new Error('ttyd exited during startup')
      const current = this.entries.get(input.sessionName)
      if (current?.child === child) this.entries.delete(input.sessionName)
    }
    child.once('error', onError)
    child.once('exit', onExit)
    await new Promise<void>((resolve) => setTimeout(resolve, this.startupGraceMs))
    if (this.closed) {
      child.kill('SIGTERM')
      throw new BackendTerminalServiceError('TTYD_UNAVAILABLE', 'Terminal manager is stopped')
    }
    if (failed || child.killed || child.exitCode !== null) {
      throw new BackendTerminalServiceError(
        'TTYD_UNAVAILABLE',
        stderr.length > 0 ? 'ttyd failed to start; inspect Backend logs' : 'ttyd failed to start',
      )
    }
    const now = this.now()
    const entry: TerminalEntry = {
      backend: input.backend,
      child,
      port,
      sessionName: input.sessionName,
      startedAt: new Date(now).toISOString(),
      lastActiveAtMs: now,
      wsConnections: 0,
      agent: input.agent,
      project: input.project,
      scope: input.scope,
      slug: input.slug,
      warnings: input.warnings,
    }
    this.entries.set(input.sessionName, entry)
    this.paneMemo.delete(input.sessionName)
    return this.publicSession(entry)
  }

  private publicSession(entry: TerminalEntry): BackendTerminalSession {
    return BackendTerminalStartResponseSchema.parse({
      host: this.hostId,
      backend: entry.backend,
      sessionName: entry.sessionName,
      url: `/api/terminal/proxy/${this.hostId}/${entry.sessionName}/`,
      startedAt: entry.startedAt,
      lastActiveAt: new Date(entry.lastActiveAtMs).toISOString(),
      agent: entry.agent,
      project: entry.project,
      scope: entry.scope,
      slug: entry.slug,
      warnings: entry.warnings,
    })
  }

  private async evictLru(): Promise<void> {
    const entries = [...this.entries.values()]
    const disconnected = entries.filter((entry) => entry.wsConnections === 0)
    const candidates = disconnected.length > 0 ? disconnected : entries
    const victim = candidates.sort((a, b) => a.lastActiveAtMs - b.lastActiveAtMs)[0]
    if (!victim) {
      throw new BackendTerminalServiceError('TTYD_UNAVAILABLE', 'Terminal capacity is exhausted')
    }
    this.entries.delete(victim.sessionName)
    await this.killChild(victim.child)
  }

  private requireTmux(): void {
    if (!this.terminal.tmuxEnabled) {
      throw new BackendTerminalServiceError('BAD_REQUEST', 'tmux integration is disabled')
    }
  }

  private requireSessionName(sessionName: string): void {
    if (!RAW_SESSION_PATTERN.test(sessionName)) {
      throw new BackendTerminalServiceError('BAD_REQUEST', 'tmux session name is invalid')
    }
  }

  private async tmuxHasSession(sessionName: string): Promise<boolean> {
    try {
      await this.execTmux(['has-session', '-t', sessionName])
      return true
    } catch {
      return false
    }
  }

  private async classifyTmux(parsed: ReturnType<typeof parseTmuxSession>): Promise<{
    matchable: boolean
    staleReason: 'unknown-project' | 'unknown-target' | null
  }> {
    if (parsed.legacy || !parsed.project || !parsed.scope || !parsed.slug || !parsed.agent) {
      return { matchable: false, staleReason: null }
    }
    const project = this.projects.find((candidate) => candidate.name === parsed.project)
    if (!project) return { matchable: false, staleReason: 'unknown-project' }
    if (parsed.scope === 'project') return { matchable: true, staleReason: null }
    if (parsed.scope === 'run') {
      const runs = await discoverRuns(project)
      return runs.some((path) => basename(path) === parsed.slug)
        ? { matchable: true, staleReason: null }
        : { matchable: false, staleReason: 'unknown-target' }
    }
    const experiments = await discoverExperiments(project.root, project.name)
    return experiments.experiments.some((experiment) => experiment.id === parsed.slug)
      ? { matchable: true, staleReason: null }
      : { matchable: false, staleReason: 'unknown-target' }
  }

  private async activePanes(): Promise<
    Map<string, { title: string | null; currentCommand: string | null }>
  > {
    if (this.paneCache && this.now() - this.paneCache.at < 800) return this.paneCache.panes
    const panes = new Map<string, { title: string | null; currentCommand: string | null }>()
    try {
      const stdout = await this.execTmux(['list-panes', '-a', '-F', TMUX_PANE_FORMAT])
      for (const rawLine of stdout.split('\n')) {
        const segments = rawLine.trimEnd().split('|')
        if (segments.length < 5 || segments[1] !== '1' || segments[2] !== '1') continue
        const sessionName = segments[0]
        if (!sessionName || !RAW_SESSION_PATTERN.test(sessionName)) continue
        const command = segments[3] ?? ''
        const rawTitle = segments
          .slice(4)
          .join('|')
          .replace(/[\r\n]+/g, ' ')
        panes.set(sessionName, {
          title:
            rawTitle.length === 0
              ? null
              : rawTitle.length <= 256
                ? rawTitle
                : `${rawTitle.slice(0, 256)}…`,
          currentCommand: command || null,
        })
      }
    } catch {
      // A stopped tmux daemon has no active panes.
    }
    this.paneCache = { at: this.now(), panes }
    return panes
  }

  private computePaneState(
    sessionName: string,
    title: string | null,
  ): { state: PaneMemoEntry['state']; changedAt: string | null } {
    const current = this.paneMemo.get(sessionName)
    const attention = title?.toLowerCase().includes('action required') === true
    const codePoint = title?.codePointAt(0)
    const running = codePoint !== undefined && codePoint >= 0x2800 && codePoint <= 0x28ff
    const hadRunning = running || current?.hadRunning === true
    const state: PaneMemoEntry['state'] = attention
      ? 'attention'
      : running
        ? 'running'
        : hadRunning
          ? 'done'
          : 'idle'
    const changedAt =
      current && current.state !== state
        ? new Date(this.now()).toISOString()
        : (current?.changedAt ?? null)
    this.paneMemo.set(sessionName, { hadRunning, state, changedAt })
    return { state, changedAt }
  }

  private async ensureHerdrWorkspace(
    cli: readonly string[],
    label: string,
    cwd: string,
  ): Promise<void> {
    let rows: Array<{ workspace_id: string; label: string }> | null = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const raw = JSON.parse(await this.execHerdr(cli, ['workspace', 'list'])) as unknown
        const candidate = raw as {
          result?: { workspaces?: unknown }
          workspaces?: unknown
        }
        const list =
          candidate?.result?.workspaces ??
          candidate?.workspaces ??
          (Array.isArray(raw) ? raw : null)
        if (!Array.isArray(list)) throw new Error('missing workspace list')
        rows = list.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as { workspace_id?: unknown; label?: unknown }
          return typeof row.workspace_id === 'string' && typeof row.label === 'string'
            ? [{ workspace_id: row.workspace_id, label: row.label }]
            : []
        })
        break
      } catch {
        if (attempt + 1 < 20) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100))
        }
      }
    }
    if (!rows) {
      throw new BackendTerminalServiceError(
        'TTYD_UNAVAILABLE',
        'Herdr workspace service is unavailable',
      )
    }
    const existing = rows.find((workspace) => workspace.label === label)
    if (existing) {
      await this.execHerdr(cli, ['workspace', 'focus', existing.workspace_id])
      return
    }
    await this.execHerdr(cli, ['workspace', 'create', '--cwd', cwd, '--label', label, '--focus'])
  }

  private defaultExecTmux(args: readonly string[]): Promise<string> {
    return this.defaultExecCommand('tmux', args, 'tmux')
  }

  private defaultExecHerdr(cli: readonly string[], args: readonly string[]): Promise<string> {
    const [executable, ...prefix] = cli
    if (!executable) {
      return Promise.reject(
        new BackendTerminalServiceError('BAD_REQUEST', 'Herdr CLI is not configured'),
      )
    }
    return this.defaultExecCommand(executable, [...prefix, ...args], 'Herdr')
  }

  private defaultExecCommand(
    executable: string,
    args: readonly string[],
    label: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(executable, [...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(stdout)
      }
      const append = (current: string, chunk: Buffer): string =>
        (current + chunk.toString('utf8')).slice(0, TMUX_OUTPUT_LIMIT + 1)
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk)
        if (stdout.length > TMUX_OUTPUT_LIMIT) {
          child.kill('SIGTERM')
          finish(
            new BackendTerminalServiceError('TTYD_UNAVAILABLE', `${label} output exceeds limit`),
          )
        }
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk)
      })
      child.once('error', () =>
        finish(new BackendTerminalServiceError('TTYD_UNAVAILABLE', `${label} execution failed`)),
      )
      child.once('exit', (code) =>
        code === 0
          ? finish()
          : finish(
              new BackendTerminalServiceError(
                'TTYD_UNAVAILABLE',
                stderr.trim() || `${label} command failed`,
              ),
            ),
      )
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish(new BackendTerminalServiceError('TTYD_UNAVAILABLE', `${label} command timed out`))
      }, TMUX_TIMEOUT_MS)
      timer.unref?.()
    })
  }

  private async killChild(child: ChildProcess): Promise<void> {
    if (child.killed || child.exitCode !== null) return
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed && child.exitCode === null) child.kill('SIGKILL')
        resolve()
      }, 2_000)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
