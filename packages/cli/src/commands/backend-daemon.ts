import { type SpawnOptions, spawn } from 'node:child_process'
import { homedir, hostname as osHostname } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  BackendDaemonController,
  type BackendDaemonControllerOptions,
  BackendReleaseStore,
  type BackendSupervisorResult,
  preflightBackendStart,
  type ReleaseStoreStatusEntry,
  runBackendSupervisor,
} from '@memon/backend'
import {
  type Config,
  ConfigError,
  isProtectedExampleConfigPath,
  loadConfig,
  MEMON_RELEASE,
  MEMON_REVISION,
} from '@memon/core'

export type BackendDaemonAction = 'start' | 'stop' | 'restart' | 'status' | 'supervise'

export interface BackendDaemonCommandOptions {
  action: BackendDaemonAction
  cwd: string
  configPath?: string
  format: 'json' | 'human'
}

export interface BackendDaemonCommandStatus {
  action: `backend-daemon-${BackendDaemonAction}`
  outcome: string
  state: string
  host: string
  release: string
  revision: string
  supervisorPid: number | null
  workerPid: number | null
  configPath: string
}

interface DaemonControl {
  status(): Promise<Awaited<ReturnType<BackendDaemonController['status']>>>
  stop(): Promise<Awaited<ReturnType<BackendDaemonController['stop']>>>
}

export interface BackendDaemonCommandDependencies {
  controllerFactory?: (options: BackendDaemonControllerOptions) => DaemonControl
  spawnSupervisor?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => { pid?: number; unref(): void }
  runSupervisor?: typeof runBackendSupervisor
  preflight?: typeof preflightBackendStart
  hostname?: () => string
  environment?: Readonly<Record<string, string | undefined>>
  homeDir?: () => string
  executable?: string
  cliEntry?: string
  nowMs?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  writeOutput?: (text: string) => void
  startTimeoutMs?: number
  pollIntervalMs?: number
  currentRelease?: (releaseDir: string) => Promise<ReleaseStoreStatusEntry | null>
}

interface LoadedBackendInstance {
  config: Config & { backend: NonNullable<Config['backend']> }
  configPath: string
  activeRelease: ReleaseStoreStatusEntry | null
}

function selectedConfigPath(options: BackendDaemonCommandOptions): string {
  if (!options.configPath) return join(resolve(options.cwd), 'config.yml')
  return isAbsolute(options.configPath)
    ? options.configPath
    : resolve(options.cwd, options.configPath)
}

async function loadBackendInstance(
  options: BackendDaemonCommandOptions,
): Promise<LoadedBackendInstance> {
  const configPath = selectedConfigPath(options)
  if (isProtectedExampleConfigPath(configPath)) {
    throw new ConfigError('config.example.yml cannot be used as a Backend instance', configPath)
  }
  const config = await loadConfig({ cwd: options.cwd, explicitPath: configPath })
  if (!config?.backend) {
    throw new ConfigError('selected instance must contain a `backend:` role block', configPath)
  }
  const backend = config.backend
  const activeRelease = await (async () => {
    try {
      return (await new BackendReleaseStore(backend.daemon.releaseDir).status()).current
    } catch {
      return null
    }
  })()
  return { config: config as LoadedBackendInstance['config'], configPath, activeRelease }
}

function controllerOptions(instance: LoadedBackendInstance): BackendDaemonControllerOptions {
  return {
    runtimeDir: instance.config.backend.daemon.runtimeDir,
    worker: { command: process.execPath, args: [] },
    release: instance.activeRelease?.manifest.release ?? MEMON_RELEASE,
    revision: instance.activeRelease?.manifest.revision ?? MEMON_REVISION,
  }
}

async function guardInstance(
  instance: LoadedBackendInstance,
  dependencies: BackendDaemonCommandDependencies,
): Promise<void> {
  await (dependencies.preflight ?? preflightBackendStart)({
    guards: instance.config.backend.daemon.guards,
    hostname: (dependencies.hostname ?? osHostname)(),
    environment: dependencies.environment ?? process.env,
    runtimeDir: instance.config.backend.daemon.runtimeDir,
    runtimePolicy: {
      stateDir: instance.config.backend.daemon.stateDir,
      releaseDir: instance.config.backend.daemon.releaseDir,
      forbiddenSharedRoots: [
        ...(dependencies.homeDir ? [dependencies.homeDir()] : [homedir()]),
        ...instance.config.projects.map((project) => project.root),
      ],
    },
  })
}

function commandStatus(
  action: BackendDaemonAction,
  outcome: string,
  state: Awaited<ReturnType<DaemonControl['status']>>,
  instance: LoadedBackendInstance,
): BackendDaemonCommandStatus {
  return {
    action: `backend-daemon-${action}`,
    outcome,
    state: state.state,
    host: instance.config.backend.hostId,
    release: state.metadata?.release ?? MEMON_RELEASE,
    revision: state.metadata?.revision ?? MEMON_REVISION,
    supervisorPid: state.metadata?.supervisorPid ?? null,
    workerPid: state.metadata?.workerPid ?? null,
    configPath: instance.configPath,
  }
}

function emit(
  status: BackendDaemonCommandStatus,
  format: BackendDaemonCommandOptions['format'],
  write: (text: string) => void,
): void {
  if (format === 'json') write(`${JSON.stringify(status)}\n`)
  else {
    write(
      `memon Backend ${status.host} · ${status.outcome} · ${status.state} · ${status.release} (${status.revision}) · config ${status.configPath}\n`,
    )
  }
}

function createControl(
  instance: LoadedBackendInstance,
  dependencies: BackendDaemonCommandDependencies,
): DaemonControl {
  return (dependencies.controllerFactory ?? ((opts) => new BackendDaemonController(opts)))(
    controllerOptions(instance),
  )
}

async function start(
  instance: LoadedBackendInstance,
  options: BackendDaemonCommandOptions,
  dependencies: BackendDaemonCommandDependencies,
): Promise<BackendDaemonCommandStatus> {
  const control = createControl(instance, dependencies)
  const initial = await control.status()
  if (
    initial.state === 'running' ||
    initial.state === 'stale' ||
    initial.state === 'mismatch' ||
    initial.state === 'crash_loop'
  ) {
    return commandStatus(
      options.action,
      initial.state === 'running' ? 'already_running' : initial.state,
      initial,
      instance,
    )
  }

  const executable = dependencies.executable ?? process.execPath
  const cliEntry = dependencies.cliEntry ?? process.argv[1]
  if (!cliEntry) throw new ConfigError('cannot resolve the memon CLI entry for supervisor launch')
  const child = (
    dependencies.spawnSupervisor ??
    ((command, args, spawnOptions) => spawn(command, [...args], spawnOptions))
  )(executable, [cliEntry, 'backend', 'daemon', 'supervise', '--config', instance.configPath], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  })
  if (!child.pid) throw new ConfigError('Backend supervisor did not expose a PID')
  child.unref()

  const nowMs = dependencies.nowMs ?? Date.now
  const sleep =
    dependencies.sleep ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)))
  const timeout = dependencies.startTimeoutMs ?? 10_000
  const interval = dependencies.pollIntervalMs ?? 50
  const deadline = nowMs() + timeout
  let observed = initial
  while (nowMs() < deadline) {
    await sleep(interval)
    observed = await control.status()
    if (
      observed.state === 'running' ||
      observed.state === 'crash_loop' ||
      observed.state === 'mismatch'
    ) {
      return commandStatus(options.action, observed.state, observed, instance)
    }
  }
  return commandStatus(options.action, 'startup_timeout', observed, instance)
}

async function supervise(
  instance: LoadedBackendInstance,
  dependencies: BackendDaemonCommandDependencies,
): Promise<BackendSupervisorResult> {
  const executable = dependencies.executable ?? process.execPath
  const active = dependencies.currentRelease
    ? await dependencies.currentRelease(instance.config.backend.daemon.releaseDir)
    : instance.activeRelease
  if (!active) throw new ConfigError('Backend supervisor requires an activated release')
  const cliEntry =
    dependencies.cliEntry ??
    join(
      instance.config.backend.daemon.releaseDir,
      'current',
      'packages',
      'cli',
      'dist',
      'index.js',
    )
  return (dependencies.runSupervisor ?? runBackendSupervisor)({
    controller: {
      runtimeDir: instance.config.backend.daemon.runtimeDir,
      worker: {
        command: executable,
        args: [cliEntry, 'backend', 'serve', '--config', instance.configPath],
        env: {
          ...process.env,
          MEMON_RELEASE: active.manifest.release,
          MEMON_REVISION: active.manifest.revision,
        },
      },
      release: active.manifest.release,
      revision: active.manifest.revision,
    },
    restartPolicy: {
      maxCrashes: 5,
      windowMs: 60_000,
      initialBackoffMs: 250,
      maxBackoffMs: 10_000,
    },
  })
}

export async function runBackendDaemonCommand(
  options: BackendDaemonCommandOptions,
  dependencies: BackendDaemonCommandDependencies = {},
): Promise<BackendDaemonCommandStatus | BackendSupervisorResult> {
  const instance = await loadBackendInstance(options)
  await guardInstance(instance, dependencies)
  const supervisorMode = instance.config.backend.daemon.mode
  if (supervisorMode !== 'supervised') {
    if (options.action === 'supervise') {
      throw new ConfigError(
        `Backend daemon supervise is unavailable in ${supervisorMode} mode`,
        instance.configPath,
      )
    }
    const status: BackendDaemonCommandStatus = {
      action: `backend-daemon-${options.action}`,
      outcome: supervisorMode === 'external' ? 'restart_required' : 'use_backend_serve',
      state: supervisorMode,
      host: instance.config.backend.hostId,
      release: MEMON_RELEASE,
      revision: MEMON_REVISION,
      supervisorPid: null,
      workerPid: null,
      configPath: instance.configPath,
    }
    emit(
      status,
      options.format,
      dependencies.writeOutput ?? ((text: string) => process.stdout.write(text)),
    )
    return status
  }
  if (options.action === 'supervise') return supervise(instance, dependencies)

  let status: BackendDaemonCommandStatus
  if (options.action === 'start') status = await start(instance, options, dependencies)
  else if (options.action === 'status') {
    const current = await createControl(instance, dependencies).status()
    status = commandStatus('status', current.state, current, instance)
  } else if (options.action === 'stop') {
    const stopped = await createControl(instance, dependencies).stop()
    status = commandStatus('stop', stopped.outcome, stopped.status, instance)
  } else {
    const stopped = await createControl(instance, dependencies).stop()
    if (stopped.status.state !== 'stopped' && stopped.status.state !== 'stale') {
      status = commandStatus('restart', stopped.outcome, stopped.status, instance)
    } else {
      status = await start(instance, options, dependencies)
    }
  }

  emit(
    status,
    options.format,
    dependencies.writeOutput ?? ((text: string) => process.stdout.write(text)),
  )
  return status
}
