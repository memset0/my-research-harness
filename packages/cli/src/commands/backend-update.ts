import { join, resolve } from 'node:path'
import {
  type ActivationDaemon,
  activatePreparedRelease,
  BackendReleaseStore,
  generateBackendServiceToken,
  prepareBackendRelease,
  rollbackPreparedRelease,
} from '@memon/backend'
import { ConfigError, loadConfig } from '@memon/core'
import { runBackendDaemonCommand } from './backend-daemon.js'

export async function runBackendTokenGenerate(
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<string> {
  const token = generateBackendServiceToken()
  write(`${token}\n`)
  return token
}

export async function runBackendPrepare(
  options: {
    action: 'install' | 'update'
    cwd: string
    configPath?: string
    revision: string
    format: 'json' | 'human'
  },
  dependencies: {
    prepare?: typeof prepareBackendRelease
    activate?: typeof activatePreparedRelease
    daemon?: ActivationDaemon
    probe?: () => Promise<unknown>
    write?: (text: string) => void
  } = {},
) {
  const configPath = resolve(options.cwd, options.configPath ?? 'config.yml')
  const config = await loadConfig({ cwd: options.cwd, explicitPath: configPath })
  if (!config?.backend)
    throw new ConfigError('selected instance must contain a `backend:` role block', configPath)
  const store = new BackendReleaseStore(config.backend.daemon.releaseDir)
  const result = await (dependencies.prepare ?? prepareBackendRelease)({
    checkoutDir: resolve(options.cwd),
    stagingDir: join(config.backend.daemon.stateDir, `staging-${options.revision}`),
    targetRevision: options.revision,
    releaseStore: store,
  })
  const daemon = dependencies.daemon ?? daemonFor(configPath, options.cwd)
  const activation = await (dependencies.activate ?? activatePreparedRelease)({
    store,
    targetName: result.name,
    expected: {
      host: config.backend.hostId,
      release: result.manifest.release,
      revision: result.manifest.revision,
      requiredCapabilities: ['projects'],
    },
    daemon,
    probe:
      dependencies.probe ??
      (() =>
        probe(config.backend!.bindAddr, config.backend!.bindPort, config.backend!.tokens.current)),
  })
  const output = {
    action: `backend-${options.action}`,
    outcome: activation.outcome,
    release: result.manifest.release,
    revision: result.manifest.revision,
    artifactSha256: result.manifest.artifactSha256,
    installed: result.name,
    activation,
  }
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text))
  write(
    options.format === 'json'
      ? `${JSON.stringify(output)}\n`
      : `memon Backend ${options.action} ${activation.outcome} ${result.name}\n`,
  )
  return output
}

function daemonFor(configPath: string, cwd: string): ActivationDaemon {
  return {
    stop: async () =>
      runBackendDaemonCommand(
        { action: 'stop', cwd, configPath, format: 'json' },
        { writeOutput: () => undefined },
      ) as Promise<{ outcome: string }>,
    start: async () =>
      runBackendDaemonCommand(
        { action: 'start', cwd, configPath, format: 'json' },
        { writeOutput: () => undefined },
      ) as Promise<{ outcome: string }>,
  }
}

export async function probeBackendReadiness(options: {
  address: string
  port: number
  token: string
  timeoutMs?: number
  intervalMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const intervalMs = options.intervalMs ?? 200
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('invalid readiness timeout')
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0)
    throw new Error('invalid readiness interval')
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const deadline = now() + timeoutMs
  const hostname = options.address.includes(':') ? `[${options.address}]` : options.address
  const endpoint = `http://${hostname}:${options.port}/api/backend/v1/meta`
  let lastFailure = 'unavailable'
  while (now() < deadline) {
    const controller = new AbortController()
    const remaining = Math.max(1, deadline - now())
    const timer = setTimeout(() => controller.abort(), remaining)
    try {
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        headers: { authorization: `Bearer ${options.token}` },
        signal: controller.signal,
        redirect: 'manual',
      })
      if (response.ok) return response.json()
      lastFailure = `HTTP_${response.status}`
      await response.body?.cancel().catch(() => undefined)
    } catch {
      lastFailure = 'unreachable'
    } finally {
      clearTimeout(timer)
    }
    const delay = Math.min(intervalMs, Math.max(0, deadline - now()))
    if (delay > 0) await sleep(delay)
  }
  throw new Error(`Backend readiness failed: ${lastFailure}`)
}

async function probe(address: string, port: number, token: string): Promise<unknown> {
  return probeBackendReadiness({ address, port, token })
}

export async function runBackendRollback(
  options: { cwd: string; configPath?: string; revision?: string; format: 'json' | 'human' },
  dependencies: {
    rollback?: typeof rollbackPreparedRelease
    daemon?: ActivationDaemon
    probe?: () => Promise<unknown>
    write?: (text: string) => void
  } = {},
) {
  const configPath = resolve(options.cwd, options.configPath ?? 'config.yml')
  const config = await loadConfig({ cwd: options.cwd, explicitPath: configPath })
  if (!config?.backend)
    throw new ConfigError('selected instance must contain a `backend:` role block', configPath)
  const store = new BackendReleaseStore(config.backend.daemon.releaseDir)
  const status = await store.status()
  if (
    options.revision &&
    status.previous?.manifest.revision !== options.revision &&
    status.previous?.name !== options.revision
  )
    throw new ConfigError('requested rollback revision is not the installed previous release')
  const result = await (dependencies.rollback ?? rollbackPreparedRelease)({
    store,
    host: config.backend.hostId,
    requiredCapabilities: ['projects'],
    daemon: dependencies.daemon ?? daemonFor(configPath, options.cwd),
    probe:
      dependencies.probe ??
      (() =>
        probe(config.backend!.bindAddr, config.backend!.bindPort, config.backend!.tokens.current)),
  })
  const output = { action: 'backend-rollback', ...result }
  const write = dependencies.write ?? ((text: string) => process.stdout.write(text))
  write(
    options.format === 'json'
      ? `${JSON.stringify(output)}\n`
      : `memon Backend rollback ${result.outcome}\n`,
  )
  return output
}
