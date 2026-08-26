import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { join } from 'node:path'
import { MEMON_RELEASE, MEMON_REVISION } from '@memon/core'
import { preflightRuntimeDirectory } from '../start-guards.js'

export const DAEMON_METADATA_VERSION = 1 as const
export const DAEMON_LOCK_DIRNAME = 'daemon.lock'
export const DAEMON_METADATA_FILENAME = 'daemon.json'

export type DaemonIntent = 'running' | 'intentional-stopped' | 'crash-loop'
export type DaemonState = 'stopped' | 'running' | 'stale' | 'mismatch' | 'crash_loop'

export interface DaemonMetadata {
  version: typeof DAEMON_METADATA_VERSION
  supervisorPid: number
  supervisorStartIdentity: string
  workerPid: number
  workerStartIdentity: string
  bootId: string
  release: string
  revision: string
  intent: DaemonIntent
  crashCount?: number
  lastCrashAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface DaemonStatus {
  state: DaemonState
  reason: string
  metadata: DaemonMetadata | null
}

export interface DaemonStartResult {
  outcome: 'started' | 'already_running' | 'stopped' | 'stale' | 'mismatch' | 'crash_loop'
  status: DaemonStatus
}

export interface DaemonStopResult {
  outcome: 'stopped' | 'already_stopped' | 'stale' | 'mismatch'
  status: DaemonStatus
  signals: Array<'SIGTERM' | 'SIGKILL'>
}

export interface WorkerCommand {
  command: string
  args?: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface SpawnedWorker {
  pid?: number
  unref(): void
}

export interface ProcessIdentity {
  alive: boolean
  startIdentity: string | null
}

export interface WorkerIdentityRef {
  pid: number
  startIdentity: string
}

export interface DaemonFileSystem {
  mkdir(path: string, options: { recursive?: boolean; mode?: number }): Promise<unknown>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(
    path: string,
    data: string,
    options: { encoding: 'utf8'; flag: 'wx'; mode: number },
  ): Promise<unknown>
  rename(from: string, to: string): Promise<unknown>
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<unknown>
  lstat(path: string): Promise<{ isDirectory(): boolean }>
}

export interface BackendDaemonDependencies {
  fs: DaemonFileSystem
  preflightRuntimeDir: (runtimeDir: string) => Promise<void>
  spawnWorker: (command: string, args: readonly string[], options: SpawnOptions) => SpawnedWorker
  probeProcess: (pid: number) => Promise<ProcessIdentity>
  signalProcessGroup: (workerPid: number, signal: 'SIGTERM' | 'SIGKILL') => Promise<void>
  bootId: () => Promise<string>
  now: () => Date
  nowMs: () => number
  sleep: (milliseconds: number) => Promise<void>
  nonce: () => string
}

export interface BackendDaemonControllerOptions {
  runtimeDir: string
  worker: WorkerCommand
  supervisorPid?: number
  release?: string
  revision?: string
  stopTimeoutMs?: number
  stopPollIntervalMs?: number
  dependencies?: Partial<BackendDaemonDependencies>
}

export class BackendDaemonError extends Error {
  constructor(
    public readonly code:
      | 'LOCK_FAILED'
      | 'SPAWN_FAILED'
      | 'IDENTITY_UNAVAILABLE'
      | 'METADATA_WRITE_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'BackendDaemonError'
  }
}

interface MetadataRead {
  kind: 'missing' | 'invalid' | 'valid'
  metadata: DaemonMetadata | null
}

const defaultFs: DaemonFileSystem = {
  mkdir: (path, options) => nodeFs.mkdir(path, options),
  readFile: (path, encoding) => nodeFs.readFile(path, encoding),
  writeFile: (path, data, options) => nodeFs.writeFile(path, data, options),
  rename: (from, to) => nodeFs.rename(from, to),
  rm: (path, options) => nodeFs.rm(path, options),
  lstat: (path) => nodeFs.lstat(path),
}

export async function probeProcessIdentity(pid: number): Promise<ProcessIdentity> {
  try {
    process.kill(pid, 0)
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ESRCH') {
      return { alive: false, startIdentity: null }
    }
  }
  try {
    const stat = await nodeFs.readFile(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')
    const fields =
      commandEnd >= 0
        ? stat
            .slice(commandEnd + 1)
            .trim()
            .split(/\s+/)
        : []
    const startTicks = fields[19]
    return {
      alive: true,
      startIdentity: startTicks ? `linux-proc-start:${startTicks}` : null,
    }
  } catch {
    return { alive: true, startIdentity: null }
  }
}

async function defaultBootId(): Promise<string> {
  return (await nodeFs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
}

const defaultDependencies: BackendDaemonDependencies = {
  fs: defaultFs,
  preflightRuntimeDir: preflightRuntimeDirectory,
  spawnWorker: (command, args, options) => nodeSpawn(command, [...args], options),
  probeProcess: probeProcessIdentity,
  signalProcessGroup: async (workerPid, signal) => {
    process.kill(-workerPid, signal)
  },
  bootId: defaultBootId,
  now: () => new Date(),
  nowMs: () => Date.now(),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  nonce: randomUUID,
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

function positivePid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function parseMetadata(value: unknown): DaemonMetadata | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    record.version !== DAEMON_METADATA_VERSION ||
    !positivePid(record.supervisorPid) ||
    typeof record.supervisorStartIdentity !== 'string' ||
    record.supervisorStartIdentity.length === 0 ||
    !positivePid(record.workerPid) ||
    typeof record.workerStartIdentity !== 'string' ||
    record.workerStartIdentity.length === 0 ||
    typeof record.bootId !== 'string' ||
    record.bootId.length === 0 ||
    typeof record.release !== 'string' ||
    record.release.length === 0 ||
    typeof record.revision !== 'string' ||
    record.revision.length === 0 ||
    (record.intent !== 'running' &&
      record.intent !== 'intentional-stopped' &&
      record.intent !== 'crash-loop') ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    (record.crashCount !== undefined &&
      (!Number.isSafeInteger(record.crashCount) || (record.crashCount as number) < 0)) ||
    (record.lastCrashAt !== undefined &&
      record.lastCrashAt !== null &&
      typeof record.lastCrashAt !== 'string')
  ) {
    return null
  }
  return record as unknown as DaemonMetadata
}

export class BackendDaemonController {
  readonly runtimeDir: string
  readonly lockDir: string
  readonly metadataPath: string
  private readonly worker: WorkerCommand
  private readonly supervisorPid: number
  private readonly release: string
  private readonly revision: string
  private readonly stopTimeoutMs: number
  private readonly stopPollIntervalMs: number
  private readonly dependencies: BackendDaemonDependencies

  constructor(options: BackendDaemonControllerOptions) {
    this.runtimeDir = options.runtimeDir
    this.lockDir = join(options.runtimeDir, DAEMON_LOCK_DIRNAME)
    this.metadataPath = join(options.runtimeDir, DAEMON_METADATA_FILENAME)
    this.worker = options.worker
    this.supervisorPid = options.supervisorPid ?? process.pid
    this.release = options.release ?? MEMON_RELEASE
    this.revision = options.revision ?? MEMON_REVISION
    this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000
    this.stopPollIntervalMs = options.stopPollIntervalMs ?? 50
    this.dependencies = { ...defaultDependencies, ...options.dependencies }
    if (!positivePid(this.supervisorPid)) throw new Error('supervisorPid must be positive')
    if (!Number.isFinite(this.stopTimeoutMs) || this.stopTimeoutMs < 0) {
      throw new Error('stopTimeoutMs must be non-negative')
    }
    if (!Number.isFinite(this.stopPollIntervalMs) || this.stopPollIntervalMs <= 0) {
      throw new Error('stopPollIntervalMs must be positive')
    }
  }

  async status(): Promise<DaemonStatus> {
    const [lockExists, metadataRead] = await Promise.all([this.lockExists(), this.readMetadata()])
    if (metadataRead.kind === 'missing') {
      return {
        state: lockExists ? 'stale' : 'stopped',
        reason: lockExists ? 'ownership lock has no metadata' : 'no daemon metadata',
        metadata: null,
      }
    }
    if (metadataRead.kind === 'invalid' || !metadataRead.metadata) {
      return { state: 'stale', reason: 'daemon metadata is invalid', metadata: null }
    }
    const metadata = metadataRead.metadata
    if (metadata.intent === 'intentional-stopped') {
      return { state: 'stopped', reason: 'daemon was intentionally stopped', metadata }
    }
    if (metadata.intent === 'crash-loop') {
      return { state: 'crash_loop', reason: 'Backend worker entered crash loop', metadata }
    }
    if (metadata.release !== this.release || metadata.revision !== this.revision) {
      return {
        state: 'mismatch',
        reason: 'running daemon release or revision does not match the selected release',
        metadata,
      }
    }

    const bootId = await this.dependencies.bootId()
    if (metadata.bootId !== bootId) {
      return { state: 'stale', reason: 'daemon metadata is from another boot', metadata }
    }
    const [supervisor, worker] = await Promise.all([
      this.dependencies.probeProcess(metadata.supervisorPid),
      this.dependencies.probeProcess(metadata.workerPid),
    ])
    if (!supervisor.alive || !worker.alive) {
      return { state: 'stale', reason: 'recorded daemon process is not alive', metadata }
    }
    if (
      supervisor.startIdentity !== metadata.supervisorStartIdentity ||
      worker.startIdentity !== metadata.workerStartIdentity
    ) {
      return {
        state: 'mismatch',
        reason: 'recorded PID belongs to a different process identity',
        metadata,
      }
    }
    if (!lockExists) {
      return { state: 'mismatch', reason: 'live metadata has no ownership lock', metadata }
    }
    return { state: 'running', reason: 'supervisor and worker identities match', metadata }
  }

  /**
   * Acquire ownership and start the worker from the persistent supervisor
   * process. A short-lived CLI launcher must use `runBackendSupervisor` in a
   * spawned hidden entry; calling this directly and then exiting makes the
   * recorded supervisor identity stale by design.
   */
  async start(): Promise<DaemonStartResult> {
    // This is deliberately the first filesystem operation owned by the daemon
    // controller. It performs read-only path inspection and no mkdir/lock/spawn.
    await this.dependencies.preflightRuntimeDir(this.runtimeDir)
    await this.dependencies.fs.mkdir(this.runtimeDir, { recursive: true, mode: 0o700 })

    const priorStatus = await this.status()
    if (priorStatus.state === 'running' || priorStatus.state === 'mismatch') {
      return {
        outcome: priorStatus.state === 'running' ? 'already_running' : 'mismatch',
        status: priorStatus,
      }
    }
    if (
      priorStatus.state === 'stale' &&
      priorStatus.metadata &&
      (priorStatus.reason.includes('another boot') ||
        priorStatus.reason.includes('process is not alive'))
    ) {
      // Explicit local start may reclaim a demonstrably stale prior-boot/dead
      // owner. No PID is signalled; the atomic mkdir below still arbitrates a
      // concurrent new supervisor.
      await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
    }

    try {
      await this.dependencies.fs.mkdir(this.lockDir, { mode: 0o700 })
    } catch (caught) {
      if (!isErrno(caught, 'EEXIST')) {
        throw new BackendDaemonError('LOCK_FAILED', 'daemon ownership lock could not be acquired')
      }
      const status = await this.status()
      return {
        outcome:
          status.state === 'running'
            ? 'already_running'
            : status.state === 'mismatch'
              ? 'mismatch'
              : status.state === 'crash_loop'
                ? 'crash_loop'
                : 'stale',
        status,
      }
    }

    let worker: SpawnedWorker | undefined
    let verifiedWorkerStartIdentity: string | undefined
    try {
      const bootId = await this.dependencies.bootId()
      const supervisor = await this.dependencies.probeProcess(this.supervisorPid)
      if (!supervisor.alive || !supervisor.startIdentity) {
        throw new BackendDaemonError(
          'IDENTITY_UNAVAILABLE',
          'supervisor process identity is unavailable',
        )
      }

      worker = this.dependencies.spawnWorker(this.worker.command, this.worker.args ?? [], {
        cwd: this.worker.cwd,
        env: this.worker.env,
        detached: true,
        stdio: 'ignore',
      })
      if (!positivePid(worker.pid)) {
        throw new BackendDaemonError('SPAWN_FAILED', 'Backend worker did not expose a PID')
      }
      worker.unref()

      const workerIdentity = await this.dependencies.probeProcess(worker.pid)
      if (!workerIdentity.alive || !workerIdentity.startIdentity) {
        throw new BackendDaemonError(
          'IDENTITY_UNAVAILABLE',
          'worker process identity is unavailable',
        )
      }
      verifiedWorkerStartIdentity = workerIdentity.startIdentity
      const now = this.dependencies.now().toISOString()
      const metadata: DaemonMetadata = {
        version: DAEMON_METADATA_VERSION,
        supervisorPid: this.supervisorPid,
        supervisorStartIdentity: supervisor.startIdentity,
        workerPid: worker.pid,
        workerStartIdentity: verifiedWorkerStartIdentity,
        bootId,
        release: this.release,
        revision: this.revision,
        intent: 'running',
        crashCount: 0,
        lastCrashAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await this.writeMetadata(metadata)
      return {
        outcome: 'started',
        status: { state: 'running', reason: 'Backend daemon started', metadata },
      }
    } catch (caught) {
      if (positivePid(worker?.pid) && verifiedWorkerStartIdentity) {
        const identity = await this.dependencies.probeProcess(worker.pid).catch(() => null)
        if (identity?.alive && identity.startIdentity === verifiedWorkerStartIdentity) {
          await this.dependencies.signalProcessGroup(worker.pid, 'SIGTERM').catch(() => undefined)
        }
      }
      await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
      if (caught instanceof BackendDaemonError) throw caught
      throw new BackendDaemonError(
        'METADATA_WRITE_FAILED',
        'daemon startup state could not be recorded',
      )
    }
  }

  /**
   * Restart a worker that this still-running supervisor previously owned.
   * The ownership lock is retained across the restart, so another launcher
   * cannot race into the recovery window.
   */
  async restartWorkerAfterUnexpectedExit(
    expected: WorkerIdentityRef,
    crashCount: number,
    lastCrashAt: string,
  ): Promise<DaemonStartResult> {
    const owned = await this.requireOwnedMetadata(expected)
    if (!owned.ok) {
      return {
        outcome:
          owned.status.state === 'crash_loop'
            ? 'crash_loop'
            : owned.status.state === 'stopped'
              ? 'stopped'
              : owned.status.state === 'mismatch'
                ? 'mismatch'
                : 'stale',
        status: owned.status,
      }
    }

    const existingWorker = await this.dependencies.probeProcess(expected.pid)
    if (existingWorker.alive && existingWorker.startIdentity === expected.startIdentity) {
      return {
        outcome: 'already_running',
        status: {
          state: 'running',
          reason: 'Backend worker is still running',
          metadata: owned.metadata,
        },
      }
    }

    let worker: SpawnedWorker
    try {
      worker = this.dependencies.spawnWorker(this.worker.command, this.worker.args ?? [], {
        cwd: this.worker.cwd,
        env: this.worker.env,
        detached: true,
        stdio: 'ignore',
      })
    } catch {
      throw new BackendDaemonError('SPAWN_FAILED', 'Backend worker restart failed')
    }
    if (!positivePid(worker.pid)) {
      throw new BackendDaemonError('SPAWN_FAILED', 'Backend worker restart has no PID')
    }
    worker.unref()
    const identity = await this.dependencies.probeProcess(worker.pid)
    if (!identity.alive || !identity.startIdentity) {
      throw new BackendDaemonError(
        'IDENTITY_UNAVAILABLE',
        'restarted worker identity is unavailable',
      )
    }
    const metadata: DaemonMetadata = {
      ...owned.metadata,
      workerPid: worker.pid,
      workerStartIdentity: identity.startIdentity,
      intent: 'running',
      crashCount,
      lastCrashAt,
      updatedAt: this.dependencies.now().toISOString(),
    }
    await this.writeMetadata(metadata)
    return {
      outcome: 'started',
      status: { state: 'running', reason: 'Backend worker restarted', metadata },
    }
  }

  async markCrashLoop(
    expected: WorkerIdentityRef,
    crashCount: number,
    lastCrashAt: string,
  ): Promise<DaemonStatus> {
    const owned = await this.requireOwnedMetadata(expected)
    if (!owned.ok) return owned.status
    const metadata: DaemonMetadata = {
      ...owned.metadata,
      intent: 'crash-loop',
      crashCount,
      lastCrashAt,
      updatedAt: this.dependencies.now().toISOString(),
    }
    await this.writeMetadata(metadata)
    return { state: 'crash_loop', reason: 'Backend worker exceeded restart policy', metadata }
  }

  async stopAfterUnexpectedWorkerExit(expected: WorkerIdentityRef): Promise<DaemonStatus> {
    const owned = await this.requireOwnedMetadata(expected)
    if (!owned.ok) return owned.status
    const metadata: DaemonMetadata = {
      ...owned.metadata,
      intent: 'intentional-stopped',
      updatedAt: this.dependencies.now().toISOString(),
    }
    await this.writeMetadata(metadata)
    await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
    return { state: 'stopped', reason: 'supervisor stopped after worker exit', metadata }
  }

  async stop(): Promise<DaemonStopResult> {
    const status = await this.status()
    if (status.state === 'stale' || status.state === 'mismatch') {
      return { outcome: status.state, status, signals: [] }
    }
    if (status.state === 'stopped' || !status.metadata) {
      return { outcome: 'already_stopped', status, signals: [] }
    }

    if (status.state === 'crash_loop') {
      const stoppedMetadata: DaemonMetadata = {
        ...status.metadata,
        intent: 'intentional-stopped',
        updatedAt: this.dependencies.now().toISOString(),
      }
      await this.writeMetadata(stoppedMetadata)
      await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
      return {
        outcome: 'stopped',
        status: {
          state: 'stopped',
          reason: 'crash loop stopped intentionally',
          metadata: stoppedMetadata,
        },
        signals: [],
      }
    }

    const stoppedMetadata: DaemonMetadata = {
      ...status.metadata,
      intent: 'intentional-stopped',
      updatedAt: this.dependencies.now().toISOString(),
    }
    // Persist intent before any signal, preventing a supervisor/watchdog from
    // interpreting the requested termination as a crash.
    await this.writeMetadata(stoppedMetadata)

    const signals: Array<'SIGTERM' | 'SIGKILL'> = []
    const beforeSignal = await this.dependencies.probeProcess(stoppedMetadata.workerPid)
    if (!beforeSignal.alive || beforeSignal.startIdentity !== stoppedMetadata.workerStartIdentity) {
      await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
      return {
        outcome: 'mismatch',
        status: {
          state: 'mismatch',
          reason: 'worker PID changed before stop signal',
          metadata: stoppedMetadata,
        },
        signals,
      }
    }
    await this.dependencies.signalProcessGroup(stoppedMetadata.workerPid, 'SIGTERM')
    signals.push('SIGTERM')
    const deadline = this.dependencies.nowMs() + this.stopTimeoutMs
    while (this.dependencies.nowMs() < deadline) {
      const worker = await this.dependencies.probeProcess(stoppedMetadata.workerPid)
      if (!worker.alive || worker.startIdentity !== stoppedMetadata.workerStartIdentity) {
        await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
        return {
          outcome: 'stopped',
          status: {
            state: 'stopped',
            reason: 'Backend worker stopped intentionally',
            metadata: stoppedMetadata,
          },
          signals,
        }
      }
      await this.dependencies.sleep(this.stopPollIntervalMs)
    }

    const finalWorker = await this.dependencies.probeProcess(stoppedMetadata.workerPid)
    if (finalWorker.alive && finalWorker.startIdentity === stoppedMetadata.workerStartIdentity) {
      await this.dependencies.signalProcessGroup(stoppedMetadata.workerPid, 'SIGKILL')
      signals.push('SIGKILL')
    }
    await this.dependencies.fs.rm(this.lockDir, { recursive: true, force: true })
    return {
      outcome: 'stopped',
      status: {
        state: 'stopped',
        reason: 'Backend worker stop completed',
        metadata: stoppedMetadata,
      },
      signals,
    }
  }

  private async lockExists(): Promise<boolean> {
    try {
      return (await this.dependencies.fs.lstat(this.lockDir)).isDirectory()
    } catch (caught) {
      if (isErrno(caught, 'ENOENT')) return false
      throw new BackendDaemonError('LOCK_FAILED', 'daemon ownership lock cannot be inspected')
    }
  }

  private async requireOwnedMetadata(
    expected: WorkerIdentityRef,
  ): Promise<{ ok: true; metadata: DaemonMetadata } | { ok: false; status: DaemonStatus }> {
    if (!(await this.lockExists())) {
      return {
        ok: false,
        status: {
          state: 'mismatch',
          reason: 'supervisor ownership lock is missing',
          metadata: null,
        },
      }
    }
    const read = await this.readMetadata()
    if (read.kind !== 'valid' || !read.metadata) {
      return {
        ok: false,
        status: { state: 'stale', reason: 'supervisor metadata is unavailable', metadata: null },
      }
    }
    const metadata = read.metadata
    if (metadata.intent !== 'running') {
      const state = metadata.intent === 'crash-loop' ? 'crash_loop' : 'stopped'
      return {
        ok: false,
        status: { state, reason: 'supervisor no longer intends worker restart', metadata },
      }
    }
    if (
      metadata.workerPid !== expected.pid ||
      metadata.workerStartIdentity !== expected.startIdentity
    ) {
      return {
        ok: false,
        status: { state: 'mismatch', reason: 'worker ownership changed', metadata },
      }
    }
    const [bootId, supervisor] = await Promise.all([
      this.dependencies.bootId(),
      this.dependencies.probeProcess(metadata.supervisorPid),
    ])
    if (metadata.bootId !== bootId || !supervisor.alive) {
      return {
        ok: false,
        status: { state: 'stale', reason: 'supervisor ownership is stale', metadata },
      }
    }
    if (supervisor.startIdentity !== metadata.supervisorStartIdentity) {
      return {
        ok: false,
        status: { state: 'mismatch', reason: 'supervisor PID identity changed', metadata },
      }
    }
    return { ok: true, metadata }
  }

  private async readMetadata(): Promise<MetadataRead> {
    let source: string
    try {
      source = await this.dependencies.fs.readFile(this.metadataPath, 'utf8')
    } catch (caught) {
      return { kind: isErrno(caught, 'ENOENT') ? 'missing' : 'invalid', metadata: null }
    }
    try {
      const metadata = parseMetadata(JSON.parse(source))
      return metadata ? { kind: 'valid', metadata } : { kind: 'invalid', metadata: null }
    } catch {
      return { kind: 'invalid', metadata: null }
    }
  }

  private async writeMetadata(metadata: DaemonMetadata): Promise<void> {
    const temporary = `${this.metadataPath}.tmp-${this.dependencies.nonce()}`
    try {
      await this.dependencies.fs.writeFile(temporary, `${JSON.stringify(metadata)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await this.dependencies.fs.rename(temporary, this.metadataPath)
    } catch (caught) {
      await this.dependencies.fs
        .rm(temporary, { recursive: false, force: true })
        .catch(() => undefined)
      throw caught
    }
  }
}

export function createBackendDaemonController(
  options: BackendDaemonControllerOptions,
): BackendDaemonController {
  return new BackendDaemonController(options)
}
