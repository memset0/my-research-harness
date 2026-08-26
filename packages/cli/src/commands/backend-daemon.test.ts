import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BackendSupervisorResult,
  DaemonStatus,
  RunBackendSupervisorOptions,
} from '@memon/backend'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runBackendDaemonCommand } from './backend-daemon.js'

const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-daemon-cli-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

async function config(mode = 'supervised'): Promise<string> {
  const path = join(dir, 'backend.yml')
  await fs.writeFile(
    path,
    `
projects: [{ name: project-a, root: ./project-a }]
backend:
  host_id: host-a
  tokens: { current: ${TOKEN} }
  daemon:
    mode: ${mode}
    state_dir: ./state
    release_dir: ./releases
    runtime_dir: /run/memon-test
    guards:
      allowed_hostnames: [login-*]
      forbidden_env: [SLURM_JOB_ID]
`,
    { mode: 0o600 },
  )
  await fs.chmod(path, 0o600)
  return path
}

function daemonStatus(state: DaemonStatus['state'], pid = 200): DaemonStatus {
  return {
    state,
    reason: state,
    metadata:
      state === 'stopped'
        ? null
        : {
            version: 1,
            supervisorPid: 100,
            supervisorStartIdentity: 'supervisor-1',
            workerPid: pid,
            workerStartIdentity: `worker-${pid}`,
            bootId: 'boot-a',
            release: '6.0.0',
            revision: 'revision-a',
            intent: state === 'crash_loop' ? 'crash-loop' : 'running',
            createdAt: '2026-08-26T17:00:00.000Z',
            updatedAt: '2026-08-26T17:00:00.000Z',
          },
  }
}

function baseDependencies() {
  return {
    preflight: vi.fn(async () => '/run/memon-test'),
    hostname: () => 'login-01',
    environment: {},
    homeDir: () => '/shared/home',
    executable: '/usr/bin/node',
    cliEntry: '/opt/memon/cli.js',
    writeOutput: vi.fn(),
  }
}

describe('memon backend daemon lifecycle command core', () => {
  it('start spawns only the hidden persistent supervisor and waits for running', async () => {
    const configPath = await config()
    const statuses = [daemonStatus('stopped'), daemonStatus('running')]
    const controller = {
      status: vi.fn(async () => statuses.shift() ?? daemonStatus('running')),
      stop: vi.fn(),
    }
    const child = { pid: 321, unref: vi.fn() }
    const spawnSupervisor = vi.fn(() => child)
    let now = 0
    const dependencies = {
      ...baseDependencies(),
      controllerFactory: vi.fn(() => controller),
      spawnSupervisor,
      nowMs: () => now,
      sleep: vi.fn(async (milliseconds: number) => {
        now += milliseconds
      }),
    }

    const result = await runBackendDaemonCommand(
      { action: 'start', cwd: dir, configPath, format: 'json' },
      dependencies,
    )

    expect(result).toMatchObject({ action: 'backend-daemon-start', outcome: 'running' })
    expect(spawnSupervisor).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['/opt/memon/cli.js', 'backend', 'daemon', 'supervise', '--config', configPath],
      { detached: true, stdio: 'ignore', shell: false },
    )
    expect(child.unref).toHaveBeenCalledOnce()
    expect(controller).not.toHaveProperty('start')
    expect(dependencies.preflight).toHaveBeenCalledOnce()
    expect(dependencies.writeOutput.mock.calls.join('')).not.toContain(TOKEN)
  })

  it('duplicate start is idempotent and does not spawn a supervisor', async () => {
    const configPath = await config()
    const spawnSupervisor = vi.fn()
    const result = await runBackendDaemonCommand(
      { action: 'start', cwd: dir, configPath, format: 'json' },
      {
        ...baseDependencies(),
        controllerFactory: () => ({ status: async () => daemonStatus('running'), stop: vi.fn() }),
        spawnSupervisor,
      },
    )
    expect(result).toMatchObject({ outcome: 'already_running', state: 'running' })
    expect(spawnSupervisor).not.toHaveBeenCalled()
  })

  it.each([
    'stale',
    'mismatch',
    'crash_loop',
  ] as const)('returns explicit %s without spawning over uncertain ownership', async (state) => {
    const configPath = await config()
    const spawnSupervisor = vi.fn()
    const result = await runBackendDaemonCommand(
      { action: 'start', cwd: dir, configPath, format: 'json' },
      {
        ...baseDependencies(),
        controllerFactory: () => ({ status: async () => daemonStatus(state), stop: vi.fn() }),
        spawnSupervisor,
      },
    )
    expect(result).toMatchObject({ outcome: state, state })
    expect(spawnSupervisor).not.toHaveBeenCalled()
  })

  it('surfaces crash_loop during bounded startup polling', async () => {
    const configPath = await config()
    const statuses = [daemonStatus('stopped'), daemonStatus('crash_loop')]
    let now = 0
    const result = await runBackendDaemonCommand(
      { action: 'start', cwd: dir, configPath, format: 'json' },
      {
        ...baseDependencies(),
        controllerFactory: () => ({ status: async () => statuses.shift()!, stop: vi.fn() }),
        spawnSupervisor: () => ({ pid: 321, unref: vi.fn() }),
        nowMs: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds
        },
      },
    )
    expect(result).toMatchObject({ outcome: 'crash_loop', state: 'crash_loop' })
  })

  it('stop writes the structured result from Controller without spawning', async () => {
    const configPath = await config()
    const stop = vi.fn(async () => ({
      outcome: 'stopped' as const,
      status: daemonStatus('stopped'),
      signals: ['SIGTERM' as const],
    }))
    const spawnSupervisor = vi.fn()
    const result = await runBackendDaemonCommand(
      { action: 'stop', cwd: dir, configPath, format: 'human' },
      {
        ...baseDependencies(),
        controllerFactory: () => ({ status: vi.fn(), stop }),
        spawnSupervisor,
      },
    )
    expect(result).toMatchObject({ outcome: 'stopped', state: 'stopped' })
    expect(stop).toHaveBeenCalledOnce()
    expect(spawnSupervisor).not.toHaveBeenCalled()
  })

  it('restart performs stop before detached start', async () => {
    const configPath = await config()
    const order: string[] = []
    const statuses = [daemonStatus('stopped'), daemonStatus('running')]
    const controller = {
      stop: vi.fn(async () => {
        order.push('stop')
        return { outcome: 'stopped' as const, status: daemonStatus('stopped'), signals: [] }
      }),
      status: vi.fn(async () => statuses.shift() ?? daemonStatus('running')),
    }
    let now = 0
    await runBackendDaemonCommand(
      { action: 'restart', cwd: dir, configPath, format: 'json' },
      {
        ...baseDependencies(),
        controllerFactory: () => controller,
        spawnSupervisor: () => {
          order.push('spawn')
          return { pid: 321, unref: vi.fn() }
        },
        nowMs: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds
        },
      },
    )
    expect(order).toEqual(['stop', 'spawn'])
  })

  it('hidden supervise owns the supervisor PID and launches backend serve as its worker', async () => {
    const configPath = await config()
    const supervisorResult: BackendSupervisorResult = {
      outcome: 'shutdown',
      restarts: 0,
      backoffDelays: [],
      status: daemonStatus('stopped'),
    }
    const runSupervisor = vi.fn(async (_options: RunBackendSupervisorOptions) => supervisorResult)
    const active = {
      name: '6.1.0-revision-a',
      manifest: {
        version: 1 as const,
        release: '6.1.0',
        revision: 'revision-a',
        artifactSha256: 'a'.repeat(64),
        platform: process.platform,
        arch: process.arch,
        nodeRange: '>=20.19 <23',
        createdAt: '2026-08-26T17:00:00.000Z',
      },
    }
    const result = await runBackendDaemonCommand(
      { action: 'supervise', cwd: dir, configPath, format: 'json' },
      {
        ...baseDependencies(),
        cliEntry: undefined,
        currentRelease: async () => active,
        runSupervisor,
      },
    )
    expect(result).toBe(supervisorResult)
    const options = runSupervisor.mock.calls[0]?.[0]
    expect(options?.controller).toMatchObject({
      worker: {
        command: '/usr/bin/node',
        args: [
          join(dir, 'releases', 'current', 'packages', 'cli', 'dist', 'index.js'),
          'backend',
          'serve',
          '--config',
          configPath,
        ],
        env: expect.objectContaining({ MEMON_RELEASE: '6.1.0', MEMON_REVISION: 'revision-a' }),
      },
      release: '6.1.0',
      revision: 'revision-a',
    })
    expect(options?.controller).not.toHaveProperty('supervisorPid')
  })

  it.each([
    ['external', 'restart_required'],
    ['foreground', 'use_backend_serve'],
  ] as const)('does not guess lifecycle control in %s mode', async (mode, outcome) => {
    const configPath = await config(mode)
    const spawnSupervisor = vi.fn()
    const controllerFactory = vi.fn()
    const result = await runBackendDaemonCommand(
      { action: 'restart', cwd: dir, configPath, format: 'json' },
      { ...baseDependencies(), spawnSupervisor, controllerFactory },
    )
    expect(result).toMatchObject({ outcome, state: mode })
    expect(spawnSupervisor).not.toHaveBeenCalled()
    expect(controllerFactory).not.toHaveBeenCalled()
  })

  it('rejects the hidden native supervisor entry in external mode', async () => {
    const configPath = await config('external')
    await expect(
      runBackendDaemonCommand(
        { action: 'supervise', cwd: dir, configPath, format: 'json' },
        baseDependencies(),
      ),
    ).rejects.toThrow(/unavailable in external mode/)
  })
})
