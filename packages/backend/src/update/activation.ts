import { type BackendMetadata, BackendMetadataSchema } from '@memon/core'
import type { BackendReleaseStore, ReleaseStoreStatusEntry } from '../distribution/release-store.js'

export interface ActivationExpectation {
  host: string
  release: string
  revision: string
  requiredCapabilities?: readonly (keyof BackendMetadata['capabilities'])[]
}
export interface ActivationDaemon {
  stop(): Promise<{ outcome: string }>
  start(): Promise<{ outcome: string }>
}
export interface ActivationAttempt {
  release: string
  activated: boolean
  restarted: boolean
  healthy: boolean
  /** Stable redacted stage code; raw operational errors never enter CLI output. */
  error?: 'stop_failed' | 'activate_failed' | 'start_failed' | 'readiness_failed'
}
export interface ActivationResult {
  outcome: 'activated' | 'rolled_back' | 'activation_failed' | 'rollback_failed'
  target: ActivationAttempt
  rollback: ActivationAttempt | null
  current: string | null
  previous: string | null
}
export interface ActivatePreparedReleaseOptions {
  store: BackendReleaseStore
  targetName: string
  expected: ActivationExpectation
  daemon: ActivationDaemon
  probe: () => Promise<unknown>
}

function verifyMetadata(input: unknown, expected: ActivationExpectation): BackendMetadata {
  const metadata = BackendMetadataSchema.parse(input)
  if (metadata.host !== expected.host) throw new Error('Backend Host identity mismatch')
  if (metadata.release !== expected.release) throw new Error('Backend release mismatch')
  if (metadata.revision !== expected.revision) throw new Error('Backend revision mismatch')
  if (!metadata.ready) throw new Error('Backend is not ready')
  for (const capability of expected.requiredCapabilities ?? []) {
    if (!metadata.capabilities[capability])
      throw new Error(`Backend capability ${capability} is missing`)
  }
  return metadata
}

async function attempt(
  store: BackendReleaseStore,
  name: string,
  expected: ActivationExpectation,
  daemon: ActivationDaemon,
  probe: () => Promise<unknown>,
): Promise<ActivationAttempt> {
  const result: ActivationAttempt = {
    release: name,
    activated: false,
    restarted: false,
    healthy: false,
  }
  try {
    await store.activate(name)
    result.activated = true
  } catch {
    result.error = 'activate_failed'
    return result
  }
  try {
    await daemon.start()
    result.restarted = true
  } catch {
    result.error = 'start_failed'
    return result
  }
  try {
    verifyMetadata(await probe(), expected)
    result.healthy = true
  } catch {
    result.error = 'readiness_failed'
  }
  return result
}

function stoppedFailure(name: string): ActivationAttempt {
  return {
    release: name,
    activated: false,
    restarted: false,
    healthy: false,
    error: 'stop_failed',
  }
}

function expectation(
  entry: ReleaseStoreStatusEntry,
  host: string,
  capabilities?: readonly (keyof BackendMetadata['capabilities'])[],
): ActivationExpectation {
  return {
    host,
    release: entry.manifest.release,
    revision: entry.manifest.revision,
    requiredCapabilities: capabilities,
  }
}

/** Activate, authenticated-verify, and automatically restore known-good on failure. */
export async function activatePreparedRelease(
  options: ActivatePreparedReleaseOptions,
): Promise<ActivationResult> {
  const before = await options.store.status()
  try {
    await options.daemon.stop()
  } catch {
    return {
      outcome: 'activation_failed',
      target: stoppedFailure(options.targetName),
      rollback: null,
      current: before.current?.name ?? null,
      previous: before.previous?.name ?? null,
    }
  }
  const target = await attempt(
    options.store,
    options.targetName,
    options.expected,
    options.daemon,
    options.probe,
  )
  if (target.healthy) {
    const status = await options.store.status()
    return {
      outcome: 'activated',
      target,
      rollback: null,
      current: status.current?.name ?? null,
      previous: status.previous?.name ?? null,
    }
  }
  if (!before.current) {
    const status = await options.store.status()
    return {
      outcome: 'activation_failed',
      target,
      rollback: null,
      current: status.current?.name ?? null,
      previous: status.previous?.name ?? null,
    }
  }

  try {
    await options.daemon.stop()
  } catch {
    const status = await options.store.status()
    return {
      outcome: 'rollback_failed',
      target,
      rollback: stoppedFailure(before.current.name),
      current: status.current?.name ?? null,
      previous: status.previous?.name ?? null,
    }
  }
  const rollback = await attempt(
    options.store,
    before.current.name,
    expectation(before.current, options.expected.host, options.expected.requiredCapabilities),
    options.daemon,
    options.probe,
  )
  const status = await options.store.status()
  return {
    outcome: rollback.healthy ? 'rolled_back' : 'rollback_failed',
    target,
    rollback,
    current: status.current?.name ?? null,
    previous: status.previous?.name ?? null,
  }
}

/** Explicit rollback only targets the store's validated previous safe entry. */
export async function rollbackPreparedRelease(
  options: Omit<ActivatePreparedReleaseOptions, 'targetName' | 'expected'> & {
    host: string
    requiredCapabilities?: readonly (keyof BackendMetadata['capabilities'])[]
  },
): Promise<ActivationResult> {
  const status = await options.store.status()
  if (!status.previous) throw new Error('no installed previous release is available')
  return activatePreparedRelease({
    store: options.store,
    targetName: status.previous.name,
    expected: expectation(status.previous, options.host, options.requiredCapabilities),
    daemon: options.daemon,
    probe: options.probe,
  })
}
