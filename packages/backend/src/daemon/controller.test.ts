import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preflightRuntimeDirectory } from '../start-guards.js'
import {
  BackendDaemonController,
  type BackendDaemonDependencies,
  type DaemonFileSystem,
  type ProcessIdentity,
} from './controller.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-daemon-'))
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

interface Harness {
  controller: BackendDaemonController
  dependencies: BackendDaemonDependencies
  identities: Map<number, ProcessIdentity>
  worker: { pid: number; unref: ReturnType<typeof vi.fn> }
  clock: { milliseconds: number }
  controls: {
    bootId: string
    probe?: (pid: number) => ProcessIdentity
    signal?: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => void | Promise<void>
  }
}

function harness(
  overrides: Partial<BackendDaemonDependencies> = {},
  controllerOverrides: Partial<ConstructorParameters<typeof BackendDaemonController>[0]> = {},
): Harness {
  const identities = new Map<number, ProcessIdentity>([
    [100, { alive: true, startIdentity: 'supervisor-start-1' }],
    [200, { alive: true, startIdentity: 'worker-start-1' }],
  ])
  const worker = { pid: 200, unref: vi.fn() }
  const clock = { milliseconds: 0 }
  const controls: Harness['controls'] = { bootId: 'boot-a' }
  let nonce = 0
  const dependencies: BackendDaemonDependencies = {
    fs: realFileSystem(),
    preflightRuntimeDir: vi.fn(preflightRuntimeDirectory),
    spawnWorker: vi.fn(() => worker),
    probeProcess: vi.fn(async (pid) =>
      Promise.resolve(
        controls.probe?.(pid) ?? identities.get(pid) ?? { alive: false, startIdentity: null },
      ),
    ),
    signalProcessGroup: vi.fn(async (pid, signal) => controls.signal?.(pid, signal)),
    bootId: vi.fn(async () => controls.bootId),
    now: () => new Date(Date.UTC(2026, 7, 26, 16, 0, 0) + clock.milliseconds),
    nowMs: () => clock.milliseconds,
    sleep: vi.fn(async (milliseconds) => {
      clock.milliseconds += milliseconds
    }),
    nonce: () => `nonce-${++nonce}`,
    ...overrides,
  }
  const controller = new BackendDaemonController({
    runtimeDir: join(dir, 'node-local', 'runtime'),
    worker: { command: 'node', args: ['backend-worker.js'], cwd: '/example/release' },
    supervisorPid: 100,
    release: '6.1.0',
    revision: '0123456789abcdef',
    stopTimeoutMs: 20,
    stopPollIntervalMs: 10,
    dependencies,
    ...controllerOverrides,
  })
  return { controller, dependencies, identities, worker, clock, controls }
}

describe('Backend daemon start and ownership', () => {
  it('preflights, takes one atomic lock, spawns a detached group, and writes 0600 metadata', async () => {
    const state = harness()
    const mkdir = vi.spyOn(state.dependencies.fs, 'mkdir')

    const result = await state.controller.start()

    expect(result).toMatchObject({ outcome: 'started', status: { state: 'running' } })
    expect(state.dependencies.preflightRuntimeDir).toHaveBeenCalledWith(state.controller.runtimeDir)
    expect(
      vi.mocked(state.dependencies.preflightRuntimeDir).mock.invocationCallOrder[0],
    ).toBeLessThan(mkdir.mock.invocationCallOrder[0]!)
    expect(mkdir).toHaveBeenCalledWith(state.controller.lockDir, { mode: 0o700 })
    expect(state.dependencies.spawnWorker).toHaveBeenCalledWith(
      'node',
      ['backend-worker.js'],
      expect.objectContaining({ detached: true, stdio: 'ignore', cwd: '/example/release' }),
    )
    expect(state.worker.unref).toHaveBeenCalledOnce()

    const metadata = JSON.parse(await fs.readFile(state.controller.metadataPath, 'utf8'))
    expect(metadata).toMatchObject({
      supervisorPid: 100,
      supervisorStartIdentity: 'supervisor-start-1',
      workerPid: 200,
      workerStartIdentity: 'worker-start-1',
      bootId: 'boot-a',
      release: '6.1.0',
      revision: '0123456789abcdef',
      intent: 'running',
    })
    expect((await fs.stat(state.controller.metadataPath)).mode & 0o777).toBe(0o600)
    await expect(state.controller.status()).resolves.toMatchObject({ state: 'running' })
  })

  it('returns already_running on duplicate start without a second spawn', async () => {
    const state = harness()
    await state.controller.start()
    await expect(state.controller.start()).resolves.toMatchObject({
      outcome: 'already_running',
      status: { state: 'running' },
    })
    expect(state.dependencies.spawnWorker).toHaveBeenCalledOnce()
  })

  it('runs preflight before every mkdir, lock, or spawn seam', async () => {
    const fileSystem = realFileSystem()
    const mkdir = vi.spyOn(fileSystem, 'mkdir')
    const preflightError = new Error('runtime is not node-local')
    const state = harness({
      fs: fileSystem,
      preflightRuntimeDir: vi.fn(async () => {
        throw preflightError
      }),
    })

    await expect(state.controller.start()).rejects.toBe(preflightError)
    expect(mkdir).not.toHaveBeenCalled()
    expect(state.dependencies.spawnWorker).not.toHaveBeenCalled()
  })

  it('classifies an incomplete lock as stale without spawning', async () => {
    const state = harness()
    await fs.mkdir(state.controller.lockDir, { recursive: true })
    await expect(state.controller.start()).resolves.toMatchObject({
      outcome: 'stale',
      status: { state: 'stale' },
    })
    expect(state.dependencies.spawnWorker).not.toHaveBeenCalled()
  })
})

describe('Backend daemon status and PID identity safety', () => {
  it('distinguishes stopped, stale, and recycled-PID mismatch', async () => {
    const state = harness()
    await expect(state.controller.status()).resolves.toMatchObject({ state: 'stopped' })
    await state.controller.start()

    state.identities.set(200, { alive: false, startIdentity: null })
    await expect(state.controller.status()).resolves.toMatchObject({ state: 'stale' })

    state.identities.set(200, { alive: true, startIdentity: 'recycled-worker' })
    await expect(state.controller.status()).resolves.toMatchObject({ state: 'mismatch' })
  })

  it('never signals a recycled PID during stop or duplicate start', async () => {
    const state = harness()
    await state.controller.start()
    state.identities.set(200, { alive: true, startIdentity: 'recycled-worker' })

    await expect(state.controller.stop()).resolves.toMatchObject({
      outcome: 'mismatch',
      signals: [],
    })
    await expect(state.controller.start()).resolves.toMatchObject({ outcome: 'mismatch' })
    expect(state.dependencies.signalProcessGroup).not.toHaveBeenCalled()
    expect(state.dependencies.spawnWorker).toHaveBeenCalledOnce()
  })

  it('does not duplicate a live worker when its ownership lock is missing', async () => {
    const state = harness()
    await state.controller.start()
    await fs.rm(state.controller.lockDir, { recursive: true, force: true })

    await expect(state.controller.start()).resolves.toMatchObject({
      outcome: 'mismatch',
      status: { state: 'mismatch' },
    })
    expect(state.dependencies.spawnWorker).toHaveBeenCalledOnce()
    expect(state.dependencies.signalProcessGroup).not.toHaveBeenCalled()
  })

  it('reports selected release/revision drift as mismatch', async () => {
    const state = harness()
    await state.controller.start()
    const otherRelease = new BackendDaemonController({
      runtimeDir: state.controller.runtimeDir,
      worker: { command: 'node', args: ['backend-worker.js'] },
      supervisorPid: 100,
      release: '6.1.0',
      revision: 'different-revision',
      dependencies: state.dependencies,
    })
    await expect(otherRelease.status()).resolves.toMatchObject({
      state: 'mismatch',
      reason: expect.stringContaining('release or revision'),
    })
  })

  it('classifies metadata from an earlier boot as stale', async () => {
    const state = harness()
    await state.controller.start()
    state.controls.bootId = 'boot-b'
    await expect(state.controller.status()).resolves.toMatchObject({
      state: 'stale',
      reason: expect.stringContaining('another boot'),
    })
  })

  it('does not recover across reboot until an explicit local start reclaims stale ownership', async () => {
    const state = harness()
    await state.controller.start()
    state.controls.bootId = 'boot-b'
    await expect(state.controller.status()).resolves.toMatchObject({ state: 'stale' })
    expect(state.dependencies.spawnWorker).toHaveBeenCalledOnce()

    await expect(state.controller.start()).resolves.toMatchObject({
      outcome: 'started',
      status: { state: 'running' },
    })
    expect(state.dependencies.spawnWorker).toHaveBeenCalledTimes(2)
    expect(state.dependencies.signalProcessGroup).not.toHaveBeenCalled()
  })
})

describe('Backend daemon intentional stop', () => {
  it('persists intentional-stopped before TERM and removes the ownership lock', async () => {
    const state = harness()
    await state.controller.start()
    state.controls.signal = async (_pid, signal) => {
      const metadata = JSON.parse(await fs.readFile(state.controller.metadataPath, 'utf8'))
      expect(metadata.intent).toBe('intentional-stopped')
      if (signal === 'SIGTERM') {
        state.identities.set(200, { alive: false, startIdentity: null })
      }
    }

    const result = await state.controller.stop()

    expect(result).toMatchObject({ outcome: 'stopped', signals: ['SIGTERM'] })
    await expect(fs.access(state.controller.lockDir)).rejects.toThrow()
    const metadata = JSON.parse(await fs.readFile(state.controller.metadataPath, 'utf8'))
    expect(metadata.intent).toBe('intentional-stopped')
    await expect(state.controller.status()).resolves.toMatchObject({ state: 'stopped' })
  })

  it('escalates from TERM to KILL only after the configured timeout', async () => {
    const state = harness()
    await state.controller.start()

    const result = await state.controller.stop()

    expect(result.signals).toEqual(['SIGTERM', 'SIGKILL'])
    expect(state.dependencies.signalProcessGroup).toHaveBeenNthCalledWith(1, 200, 'SIGTERM')
    expect(state.dependencies.signalProcessGroup).toHaveBeenNthCalledWith(2, 200, 'SIGKILL')
    expect(state.clock.milliseconds).toBe(20)
  })

  it('rechecks identity after writing stop intent and does not signal a changed PID', async () => {
    const state = harness()
    await state.controller.start()
    let probes = 0
    state.controls.probe = (pid) => {
      if (pid === 100) return { alive: true, startIdentity: 'supervisor-start-1' }
      probes += 1
      return probes === 1
        ? { alive: true, startIdentity: 'worker-start-1' }
        : { alive: true, startIdentity: 'recycled-worker' }
    }

    await expect(state.controller.stop()).resolves.toMatchObject({
      outcome: 'mismatch',
      signals: [],
    })
    expect(state.dependencies.signalProcessGroup).not.toHaveBeenCalled()
  })
})
