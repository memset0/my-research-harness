import {
  BackendDaemonController,
  type BackendDaemonControllerOptions,
  type DaemonStartResult,
  type DaemonStatus,
  probeProcessIdentity,
  type WorkerIdentityRef,
} from './controller.js'

export interface BackendRestartPolicy {
  maxCrashes: number
  windowMs: number
  initialBackoffMs: number
  maxBackoffMs: number
}

export type WorkerMonitorResult = 'exited' | 'shutdown'

export interface BackendSupervisorDependencies {
  currentPid: number
  monitorWorkerExit: (
    worker: WorkerIdentityRef,
    shutdownSignal: AbortSignal,
  ) => Promise<WorkerMonitorResult>
  sleep: (milliseconds: number, shutdownSignal: AbortSignal) => Promise<'elapsed' | 'shutdown'>
  now: () => Date
  nowMs: () => number
}

export interface RunBackendSupervisorOptions {
  /**
   * Must be executed inside the persistent supervisor process itself. A short-
   * lived CLI launcher must spawn the hidden supervisor entry and exit; it must
   * never call Controller.start() using the launcher's PID.
   */
  controller: Omit<BackendDaemonControllerOptions, 'supervisorPid'>
  restartPolicy: BackendRestartPolicy
  shutdownSignal?: AbortSignal
  dependencies?: Partial<BackendSupervisorDependencies>
}

export interface BackendSupervisorResult {
  outcome: 'already_running' | 'intentional_stop' | 'shutdown' | 'crash_loop' | 'ownership_lost'
  restarts: number
  backoffDelays: number[]
  status: DaemonStatus
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<'elapsed' | 'shutdown'> {
  if (signal.aborted) return 'shutdown'
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve('elapsed')
    }, milliseconds)
    const onAbort = () => {
      clearTimeout(timer)
      resolve('shutdown')
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function defaultMonitorWorkerExit(
  worker: WorkerIdentityRef,
  signal: AbortSignal,
): Promise<WorkerMonitorResult> {
  while (!signal.aborted) {
    const identity = await probeProcessIdentity(worker.pid)
    if (!identity.alive || identity.startIdentity !== worker.startIdentity) return 'exited'
    if ((await abortableDelay(250, signal)) === 'shutdown') return 'shutdown'
  }
  return 'shutdown'
}

const defaultDependencies: BackendSupervisorDependencies = {
  currentPid: process.pid,
  monitorWorkerExit: defaultMonitorWorkerExit,
  sleep: abortableDelay,
  now: () => new Date(),
  nowMs: () => Date.now(),
}

function validatePolicy(policy: BackendRestartPolicy): void {
  if (!Number.isSafeInteger(policy.maxCrashes) || policy.maxCrashes < 0) {
    throw new Error('restartPolicy.maxCrashes must be a non-negative integer')
  }
  for (const [name, value] of [
    ['windowMs', policy.windowMs],
    ['initialBackoffMs', policy.initialBackoffMs],
    ['maxBackoffMs', policy.maxBackoffMs],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`restartPolicy.${name} must be positive`)
  }
  if (policy.maxBackoffMs < policy.initialBackoffMs) {
    throw new Error('restartPolicy.maxBackoffMs must be >= initialBackoffMs')
  }
}

function processShutdownSignal(external?: AbortSignal): {
  signal: AbortSignal
  dispose: () => void
} {
  if (external) return { signal: external, dispose: () => undefined }
  const controller = new AbortController()
  const shutdown = () => controller.abort(new Error('supervisor shutdown signal'))
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', shutdown)
      process.off('SIGTERM', shutdown)
    },
  }
}

function workerRef(start: DaemonStartResult): WorkerIdentityRef | null {
  const metadata = start.status.metadata
  return metadata ? { pid: metadata.workerPid, startIdentity: metadata.workerStartIdentity } : null
}

/** Persistent supervisor loop. It returns only on stop, shutdown, or crash-loop. */
export async function runBackendSupervisor(
  options: RunBackendSupervisorOptions,
): Promise<BackendSupervisorResult> {
  validatePolicy(options.restartPolicy)
  const dependencies = { ...defaultDependencies, ...options.dependencies }
  const shutdown = processShutdownSignal(options.shutdownSignal)
  const controller = new BackendDaemonController({
    ...options.controller,
    supervisorPid: dependencies.currentPid,
  })
  const backoffDelays: number[] = []
  let restarts = 0

  try {
    const started = await controller.start()
    if (started.outcome !== 'started') {
      return {
        outcome: started.outcome === 'already_running' ? 'already_running' : 'ownership_lost',
        restarts,
        backoffDelays,
        status: started.status,
      }
    }
    let currentWorker = workerRef(started)
    if (!currentWorker) {
      return { outcome: 'ownership_lost', restarts, backoffDelays, status: started.status }
    }
    let crashes: number[] = []

    while (true) {
      const monitor = await dependencies.monitorWorkerExit(currentWorker, shutdown.signal)
      if (monitor === 'shutdown' || shutdown.signal.aborted) {
        const currentStatus = await controller.status()
        const status =
          currentStatus.state === 'stale' || currentStatus.state === 'mismatch'
            ? await controller.stopAfterUnexpectedWorkerExit(currentWorker)
            : (await controller.stop()).status
        return {
          outcome: 'shutdown',
          restarts,
          backoffDelays,
          status,
        }
      }

      const afterExit = await controller.status()
      if (afterExit.state === 'stopped') {
        return { outcome: 'intentional_stop', restarts, backoffDelays, status: afterExit }
      }
      if (afterExit.state === 'mismatch' || afterExit.state === 'crash_loop') {
        return { outcome: 'ownership_lost', restarts, backoffDelays, status: afterExit }
      }

      // A failed spawn is another crash in the same bounded policy window.
      while (true) {
        const now = dependencies.nowMs()
        crashes = crashes.filter((timestamp) => now - timestamp <= options.restartPolicy.windowMs)
        crashes.push(now)
        const lastCrashAt = dependencies.now().toISOString()
        if (crashes.length > options.restartPolicy.maxCrashes) {
          const status = await controller.markCrashLoop(currentWorker, crashes.length, lastCrashAt)
          return { outcome: 'crash_loop', restarts, backoffDelays, status }
        }

        const delay = Math.min(
          options.restartPolicy.initialBackoffMs * 2 ** (crashes.length - 1),
          options.restartPolicy.maxBackoffMs,
        )
        backoffDelays.push(delay)
        if ((await dependencies.sleep(delay, shutdown.signal)) === 'shutdown') {
          const status = await controller.stopAfterUnexpectedWorkerExit(currentWorker)
          return { outcome: 'shutdown', restarts, backoffDelays, status }
        }

        try {
          const restarted = await controller.restartWorkerAfterUnexpectedExit(
            currentWorker,
            crashes.length,
            lastCrashAt,
          )
          if (restarted.outcome === 'stopped') {
            return {
              outcome: 'intentional_stop',
              restarts,
              backoffDelays,
              status: restarted.status,
            }
          }
          if (restarted.outcome !== 'started') {
            return {
              outcome: 'ownership_lost',
              restarts,
              backoffDelays,
              status: restarted.status,
            }
          }
          restarts += 1
          currentWorker = workerRef(restarted)!
          break
        } catch {
          // Remain inside the restart loop; the next iteration records another
          // bounded crash/backoff attempt without releasing supervisor lock.
        }
      }
    }
  } finally {
    shutdown.dispose()
  }
}
