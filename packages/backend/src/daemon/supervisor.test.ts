import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preflightRuntimeDirectory } from '../start-guards.js'
import {
  BackendDaemonController,
  type BackendDaemonControllerOptions,
  type BackendDaemonDependencies,
  type DaemonFileSystem,
  type ProcessIdentity,
  type WorkerIdentityRef,
} from './controller.js'
import {
  type BackendSupervisorDependencies,
  runBackendSupervisor,
  type WorkerMonitorResult,
} from './supervisor.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-supervisor-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function realFileSystem(): DaemonFileSystem {
  return {
    mkdir: (path, options) => fs.mkdir(path, options),
    readFile: (path, encoding) => fs.readFile(path, encoding),
    writeFile: (path, data, options) => fs.writeFile(path, data, options),
    rename: (from, to) => fs.rename(from, to),
    rm: (path, options) => fs.rm(path, options),
    lstat: (path) => fs.lstat(path),
  }
}

interface SupervisorHarness {
  controllerOptions: Omit<BackendDaemonControllerOptions, 'supervisorPid'>
  controllerDependencies: BackendDaemonDependencies
  supervisorDependencies: BackendSupervisorDependencies
  identities: Map<number, ProcessIdentity>
  spawnedPids: number[]
  backoffs: number[]
  setMonitor: (
    monitor: (worker: WorkerIdentityRef, signal: AbortSignal) => Promise<WorkerMonitorResult>,
  ) => void
}

function harness(): SupervisorHarness {
  const identities = new Map<number, ProcessIdentity>([
    [100, { alive: true, startIdentity: 'persistent-supervisor-identity' }],
  ])
  const spawnedPids: number[] = []
  const backoffs: number[] = []
  let nextPid = 200
  let nowMs = 0
  let monitor: BackendSupervisorDependencies['monitorWorkerExit'] = async () => 'shutdown'
  let nonce = 0

  const controllerDependencies: BackendDaemonDependencies = {
    fs: realFileSystem(),
    preflightRuntimeDir: preflightRuntimeDirectory,
    spawnWorker: vi.fn(() => {
      const pid = nextPid++
      spawnedPids.push(pid)
      identities.set(pid, { alive: true, startIdentity: `worker-identity-${pid}` })
      return { pid, unref: vi.fn() }
    }),
    probeProcess: vi.fn(async (pid) =>
      Promise.resolve(identities.get(pid) ?? { alive: false, startIdentity: null }),
    ),
    signalProcessGroup: vi.fn(async (pid) => {
      identities.set(pid, { alive: false, startIdentity: null })
    }),
    bootId: vi.fn(async () => 'boot-a'),
    now: () => new Date(Date.UTC(2026, 7, 26, 17, 0, 0) + nowMs),
    nowMs: () => nowMs,
    sleep: vi.fn(async (milliseconds) => {
      nowMs += milliseconds
    }),
    nonce: () => `nonce-${++nonce}`,
  }
  const supervisorDependencies: BackendSupervisorDependencies = {
    currentPid: 100,
    monitorWorkerExit: (worker, signal) => monitor(worker, signal),
    sleep: vi.fn(async (milliseconds, signal) => {
      if (signal.aborted) return 'shutdown'
      backoffs.push(milliseconds)
      nowMs += milliseconds
      return 'elapsed'
    }),
    now: () => new Date(Date.UTC(2026, 7, 26, 17, 0, 0) + nowMs),
    nowMs: () => nowMs,
  }
  return {
    controllerOptions: {
      runtimeDir: join(dir, 'node-local', 'runtime'),
      worker: { command: 'node', args: ['backend-worker.js'] },
      release: '6.1.0',
      revision: '0123456789abcdef',
      stopTimeoutMs: 20,
      stopPollIntervalMs: 10,
      dependencies: controllerDependencies,
    },
    controllerDependencies,
    supervisorDependencies,
    identities,
    spawnedPids,
    backoffs,
    setMonitor(next) {
      monitor = next
    },
  }
}

const POLICY = {
  maxCrashes: 2,
  windowMs: 1_000,
  initialBackoffMs: 10,
  maxBackoffMs: 40,
}

describe('persistent Backend supervisor', () => {
  it('uses its own persistent PID and cleans up the worker on shutdown', async () => {
    const state = harness()
    const monitor = vi.fn(async () => 'shutdown' as const)
    state.setMonitor(monitor)

    const result = await runBackendSupervisor({
      controller: state.controllerOptions,
      restartPolicy: POLICY,
      shutdownSignal: new AbortController().signal,
      dependencies: state.supervisorDependencies,
    })

    expect(result).toMatchObject({ outcome: 'shutdown', restarts: 0 })
    expect(monitor).toHaveBeenCalledOnce()
    const metadata = JSON.parse(
      await fs.readFile(join(state.controllerOptions.runtimeDir, 'daemon.json'), 'utf8'),
    )
    expect(metadata.supervisorPid).toBe(100)
    expect(metadata.supervisorStartIdentity).toBe('persistent-supervisor-identity')
    expect(metadata.intent).toBe('intentional-stopped')
    expect(state.controllerDependencies.signalProcessGroup).toHaveBeenCalledWith(200, 'SIGTERM')
  })

  it('recovers an unexpected exit after bounded exponential backoff', async () => {
    const state = harness()
    let monitors = 0
    state.setMonitor(async (worker) => {
      monitors += 1
      if (monitors === 1) {
        state.identities.set(worker.pid, { alive: false, startIdentity: null })
        return 'exited'
      }
      return 'shutdown'
    })

    const result = await runBackendSupervisor({
      controller: state.controllerOptions,
      restartPolicy: POLICY,
      shutdownSignal: new AbortController().signal,
      dependencies: state.supervisorDependencies,
    })

    expect(result).toMatchObject({ outcome: 'shutdown', restarts: 1 })
    expect(result.backoffDelays).toEqual([10])
    expect(state.spawnedPids).toEqual([200, 201])
  })

  it('enters observable crash_loop after exceeding the window threshold', async () => {
    const state = harness()
    state.setMonitor(async (worker) => {
      state.identities.set(worker.pid, { alive: false, startIdentity: null })
      return 'exited'
    })

    const result = await runBackendSupervisor({
      controller: state.controllerOptions,
      restartPolicy: POLICY,
      shutdownSignal: new AbortController().signal,
      dependencies: state.supervisorDependencies,
    })

    expect(result).toMatchObject({
      outcome: 'crash_loop',
      restarts: 2,
      status: { state: 'crash_loop', metadata: { intent: 'crash-loop', crashCount: 3 } },
    })
    expect(result.backoffDelays).toEqual([10, 20])
    expect(state.spawnedPids).toEqual([200, 201, 202])
    const observer = new BackendDaemonController({
      ...state.controllerOptions,
      supervisorPid: 100,
    })
    await expect(observer.status()).resolves.toMatchObject({ state: 'crash_loop' })
  })

  it('does not restart after an intentional external stop', async () => {
    const state = harness()
    state.setMonitor(async () => {
      const stopper = new BackendDaemonController({
        ...state.controllerOptions,
        supervisorPid: 100,
      })
      await stopper.stop()
      return 'exited'
    })

    const result = await runBackendSupervisor({
      controller: state.controllerOptions,
      restartPolicy: POLICY,
      shutdownSignal: new AbortController().signal,
      dependencies: state.supervisorDependencies,
    })

    expect(result).toMatchObject({ outcome: 'intentional_stop', restarts: 0 })
    expect(state.spawnedPids).toEqual([200])
  })
})
