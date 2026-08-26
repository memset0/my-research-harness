import {
  type ChildProcess,
  type SpawnOptions,
  spawn as spawnChildProcess,
} from 'node:child_process'
import type { CentralSshTransportConfig } from '@memon/core'

const LOCAL_FORWARD_HOST = '127.0.0.1'
const SERVER_ALIVE_INTERVAL_SECONDS = 15
const SERVER_ALIVE_COUNT_MAX = 3

export const SSH_TUNNEL_STATES = ['stopped', 'starting', 'checking', 'online', 'backoff'] as const

export type SshTunnelState = (typeof SSH_TUNNEL_STATES)[number]
export type SshTunnelFailureKind = 'spawn' | 'error' | 'exit' | 'readiness'

export interface SshTunnelFailure {
  kind: SshTunnelFailureKind
  message: string
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

export interface SshTunnelSnapshot {
  hostId: string
  state: SshTunnelState
  pid: number | null
  attempt: number
  retryDelayMs: number | null
  lastFailure: SshTunnelFailure | null
}

export interface SshTunnelReadinessContext {
  hostId: string
  localHost: typeof LOCAL_FORWARD_HOST
  localPort: number
  signal: AbortSignal
}

export type SshTunnelReadinessCheck = (
  context: SshTunnelReadinessContext,
) => boolean | Promise<boolean>

export interface SshTunnelSpawnOptions extends SpawnOptions {
  detached: true
  shell: false
  stdio: 'ignore'
  windowsHide: true
}

export type SshTunnelSpawn = (
  executable: string,
  args: readonly string[],
  options: SshTunnelSpawnOptions,
) => ChildProcess

export interface SshTunnelTimer {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SshTunnelBackoffOptions {
  baseDelayMs: number
  maxDelayMs: number
  jitterRatio: number
}

export interface SshTunnelDependencies {
  spawn: SshTunnelSpawn
  timer: SshTunnelTimer
  random: () => number
  killProcessGroup: (child: ChildProcess, signal: NodeJS.Signals) => void
}

export interface SshTunnelManagerOptions {
  hostId: string
  transport: CentralSshTransportConfig
  readiness: SshTunnelReadinessCheck
  onStateChange?: (snapshot: SshTunnelSnapshot) => void
  backoff?: Partial<SshTunnelBackoffOptions>
  dependencies?: Partial<SshTunnelDependencies>
}

export interface SshTunnelCommand {
  executable: string
  args: readonly string[]
  options: SshTunnelSpawnOptions
}

export const DEFAULT_SSH_TUNNEL_BACKOFF: Readonly<SshTunnelBackoffOptions> = Object.freeze({
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitterRatio: 0.2,
})

export const SSH_TUNNEL_SPAWN_OPTIONS: Readonly<SshTunnelSpawnOptions> = Object.freeze({
  detached: true,
  shell: false,
  stdio: 'ignore',
  windowsHide: true,
})

function remoteForwardHost(host: string): string {
  return host.includes(':') && !(host.startsWith('[') && host.endsWith(']')) ? `[${host}]` : host
}

/** Build a no-shell, host-key-pinned OpenSSH command for one loopback forward. */
export function buildSshTunnelCommand(transport: CentralSshTransportConfig): SshTunnelCommand {
  const args = [
    '-N',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    `UserKnownHostsFile=${transport.knownHostsFile}`,
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    `ServerAliveInterval=${SERVER_ALIVE_INTERVAL_SECONDS}`,
    '-o',
    `ServerAliveCountMax=${SERVER_ALIVE_COUNT_MAX}`,
    '-L',
    `${LOCAL_FORWARD_HOST}:${transport.localPort}:${remoteForwardHost(transport.remoteHost)}:${transport.remotePort}`,
    ...(transport.identityFile ? ['-i', transport.identityFile] : []),
    transport.target,
  ]

  return {
    executable: transport.executable,
    args,
    options: SSH_TUNNEL_SPAWN_OPTIONS,
  }
}

function defaultSpawn(
  executable: string,
  args: readonly string[],
  options: SshTunnelSpawnOptions,
): ChildProcess {
  return spawnChildProcess(executable, [...args], options)
}

function defaultKillProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    child.once('spawn', () => defaultKillProcessGroup(child, signal))
    return
  }
  if (process.platform === 'win32') {
    child.kill(signal)
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

const DEFAULT_TIMER: SshTunnelTimer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function normalizedBackoff(
  overrides: Partial<SshTunnelBackoffOptions> | undefined,
): SshTunnelBackoffOptions {
  const result = { ...DEFAULT_SSH_TUNNEL_BACKOFF, ...overrides }
  if (!Number.isFinite(result.baseDelayMs) || result.baseDelayMs <= 0) {
    throw new Error('SSH tunnel baseDelayMs must be positive')
  }
  if (!Number.isFinite(result.maxDelayMs) || result.maxDelayMs < result.baseDelayMs) {
    throw new Error('SSH tunnel maxDelayMs must be >= baseDelayMs')
  }
  if (!Number.isFinite(result.jitterRatio) || result.jitterRatio < 0 || result.jitterRatio > 1) {
    throw new Error('SSH tunnel jitterRatio must be between 0 and 1')
  }
  return result
}

/**
 * Owns exactly one detached SSH process group for one configured Host.
 * `start()` is idempotent; `stop()` prevents all pending or future reconnects.
 */
export class SshTunnelManager {
  private readonly command: SshTunnelCommand
  private readonly localPort: number
  private readonly readiness: SshTunnelReadinessCheck
  private readonly onStateChange: ((snapshot: SshTunnelSnapshot) => void) | undefined
  private readonly backoff: SshTunnelBackoffOptions
  private readonly dependencies: SshTunnelDependencies

  private desiredRunning = false
  private child: ChildProcess | null = null
  private readinessAbort: AbortController | null = null
  private retryTimer: unknown | null = null
  private consecutiveFailures = 0
  private snapshot: SshTunnelSnapshot

  constructor(options: SshTunnelManagerOptions) {
    if (!options.hostId) throw new Error('SSH tunnel hostId must not be empty')
    this.command = buildSshTunnelCommand(options.transport)
    this.localPort = options.transport.localPort
    this.readiness = options.readiness
    this.onStateChange = options.onStateChange
    this.backoff = normalizedBackoff(options.backoff)
    this.dependencies = {
      spawn: defaultSpawn,
      timer: DEFAULT_TIMER,
      random: Math.random,
      killProcessGroup: defaultKillProcessGroup,
      ...options.dependencies,
    }
    this.snapshot = {
      hostId: options.hostId,
      state: 'stopped',
      pid: null,
      attempt: 0,
      retryDelayMs: null,
      lastFailure: null,
    }
  }

  getSnapshot(): SshTunnelSnapshot {
    return {
      ...this.snapshot,
      lastFailure: this.snapshot.lastFailure ? { ...this.snapshot.lastFailure } : null,
    }
  }

  start(): void {
    if (this.desiredRunning) return
    this.desiredRunning = true
    this.consecutiveFailures = 0
    this.spawnAttempt()
  }

  stop(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.desiredRunning = false
    if (this.retryTimer !== null) {
      this.dependencies.timer.clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.readinessAbort?.abort()
    this.readinessAbort = null

    const child = this.child
    this.child = null
    if (child) this.killGroup(child, signal)

    this.consecutiveFailures = 0
    this.setSnapshot({
      state: 'stopped',
      pid: null,
      attempt: 0,
      retryDelayMs: null,
      lastFailure: null,
    })
  }

  private spawnAttempt(): void {
    if (!this.desiredRunning || this.child || this.retryTimer !== null) return

    this.setSnapshot({
      state: 'starting',
      pid: null,
      retryDelayMs: null,
    })
    if (!this.desiredRunning) return

    let child: ChildProcess
    try {
      child = this.dependencies.spawn(
        this.command.executable,
        this.command.args,
        this.command.options,
      )
    } catch (error) {
      this.scheduleRetry({ kind: 'spawn', message: (error as Error).message })
      return
    }

    this.child = child
    this.setSnapshot({ pid: child.pid ?? null })

    child.once('spawn', () => {
      if (!this.desiredRunning || this.child !== child) return
      this.checkReadiness(child)
    })
    child.once('error', (error) => {
      this.failAttempt(child, { kind: 'error', message: error.message }, child.pid !== undefined)
    })
    child.once('exit', (exitCode, signal) => {
      this.failAttempt(
        child,
        {
          kind: 'exit',
          message: `SSH tunnel exited (code=${String(exitCode)}, signal=${String(signal)})`,
          exitCode,
          signal,
        },
        false,
      )
    })
  }

  private checkReadiness(child: ChildProcess): void {
    this.readinessAbort?.abort()
    const abort = new AbortController()
    this.readinessAbort = abort
    this.setSnapshot({ state: 'checking', pid: child.pid ?? null })
    if (!this.desiredRunning || this.child !== child) return

    let readiness: boolean | Promise<boolean>
    try {
      readiness = this.readiness({
        hostId: this.snapshot.hostId,
        localHost: LOCAL_FORWARD_HOST,
        localPort: this.localPort,
        signal: abort.signal,
      })
    } catch (error) {
      this.failAttempt(child, { kind: 'readiness', message: (error as Error).message }, true)
      return
    }

    Promise.resolve(readiness).then(
      (ready) => {
        if (!this.desiredRunning || this.child !== child || abort.signal.aborted) return
        if (!ready) {
          this.failAttempt(
            child,
            { kind: 'readiness', message: 'SSH tunnel Backend readiness check failed' },
            true,
          )
          return
        }
        this.readinessAbort = null
        this.consecutiveFailures = 0
        this.setSnapshot({
          state: 'online',
          pid: child.pid ?? null,
          attempt: 0,
          retryDelayMs: null,
          lastFailure: null,
        })
      },
      (error: unknown) => {
        if (!this.desiredRunning || this.child !== child || abort.signal.aborted) return
        this.failAttempt(child, { kind: 'readiness', message: (error as Error).message }, true)
      },
    )
  }

  private failAttempt(child: ChildProcess, failure: SshTunnelFailure, terminate: boolean): void {
    if (this.child !== child) return
    this.child = null
    this.readinessAbort?.abort()
    this.readinessAbort = null
    if (terminate) this.killGroup(child, 'SIGTERM')
    this.scheduleRetry(failure)
  }

  private killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      this.dependencies.killProcessGroup(child, signal)
    } catch {
      // Cleanup is best-effort here; the state machine must still stop/retry
      // rather than strand an owned child reference or reconnect timer.
    }
  }

  private scheduleRetry(failure: SshTunnelFailure): void {
    if (!this.desiredRunning) return

    const exponent = Math.min(this.consecutiveFailures, 30)
    const rawDelay = Math.min(this.backoff.maxDelayMs, this.backoff.baseDelayMs * 2 ** exponent)
    const random = Math.min(1, Math.max(0, this.dependencies.random()))
    const jitterFactor = 1 - this.backoff.jitterRatio + 2 * this.backoff.jitterRatio * random
    const retryDelayMs = Math.min(
      this.backoff.maxDelayMs,
      Math.max(0, Math.round(rawDelay * jitterFactor)),
    )
    this.consecutiveFailures += 1

    this.retryTimer = this.dependencies.timer.setTimeout(() => {
      this.retryTimer = null
      this.spawnAttempt()
    }, retryDelayMs)
    this.setSnapshot({
      state: 'backoff',
      pid: null,
      attempt: this.consecutiveFailures,
      retryDelayMs,
      lastFailure: failure,
    })
  }

  private setSnapshot(patch: Partial<SshTunnelSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    this.onStateChange?.(this.getSnapshot())
  }
}
