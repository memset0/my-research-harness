// @vitest-environment node

import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { CentralSshTransportConfig } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import {
  buildSshTunnelCommand,
  SshTunnelManager,
  type SshTunnelSpawn,
  type SshTunnelTimer,
} from './ssh-tunnel'

const TRANSPORT: CentralSshTransportConfig = {
  kind: 'ssh',
  executable: '/usr/bin/ssh',
  target: 'tunnel@backend.example.test',
  knownHostsFile: '/run/memon/known_hosts',
  identityFile: '/run/memon/id_backend',
  localPort: 4738,
  remoteHost: '127.0.0.1',
  remotePort: 3738,
}

class FakeChild extends EventEmitter {
  constructor(readonly pid: number | undefined) {
    super()
  }

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess
  }
}

interface FakeTimerHandle {
  callback: () => void
  delayMs: number
  cancelled: boolean
}

class FakeTimer implements SshTunnelTimer {
  readonly handles: FakeTimerHandle[] = []

  setTimeout = (callback: () => void, delayMs: number): FakeTimerHandle => {
    const handle = { callback, delayMs, cancelled: false }
    this.handles.push(handle)
    return handle
  }

  clearTimeout = (handle: unknown): void => {
    ;(handle as FakeTimerHandle).cancelled = true
  }

  pendingDelays(): number[] {
    return this.handles.filter((handle) => !handle.cancelled).map((handle) => handle.delayMs)
  }

  runNext(): void {
    const next = this.handles.find((handle) => !handle.cancelled)
    if (!next) throw new Error('no pending fake timer')
    next.cancelled = true
    next.callback()
  }
}

function asSpawn(implementation: (...args: Parameters<SshTunnelSpawn>) => ChildProcess) {
  return vi.fn(implementation)
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('buildSshTunnelCommand', () => {
  it('pins host keys and identity while binding only a center-loopback local forward', () => {
    const command = buildSshTunnelCommand(TRANSPORT)

    expect(command.executable).toBe('/usr/bin/ssh')
    expect(command.args).toEqual([
      '-N',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'UserKnownHostsFile=/run/memon/known_hosts',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-L',
      '127.0.0.1:4738:127.0.0.1:3738',
      '-i',
      '/run/memon/id_backend',
      'tunnel@backend.example.test',
    ])
    expect(command.options).toMatchObject({
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    })
    expect(command.args.join(' ')).not.toContain('0.0.0.0:4738')
    expect(command.args).not.toContain('StrictHostKeyChecking=accept-new')
  })

  it('keeps IdentitiesOnly enabled without inventing an identity argument', () => {
    const command = buildSshTunnelCommand({ ...TRANSPORT, identityFile: undefined })
    expect(command.args).toContain('IdentitiesOnly=yes')
    expect(command.args).not.toContain('-i')
  })

  it('brackets an IPv6 remote forwarding destination without changing the local bind', () => {
    const command = buildSshTunnelCommand({ ...TRANSPORT, remoteHost: '::1' })
    expect(command.args).toContain('127.0.0.1:4738:[::1]:3738')
  })
})

describe('SshTunnelManager', () => {
  it('owns one process and becomes online only after readiness succeeds', async () => {
    const child = new FakeChild(4101)
    const spawn = asSpawn(() => child.asChildProcess())
    let resolveReadiness: ((ready: boolean) => void) | undefined
    const readiness = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveReadiness = resolve
        }),
    )
    const timer = new FakeTimer()
    const manager = new SshTunnelManager({
      hostId: 'host-a',
      transport: TRANSPORT,
      readiness,
      dependencies: { spawn, timer, random: () => 0.5 },
    })

    manager.start()
    manager.start()
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot()).toMatchObject({ state: 'starting', pid: 4101 })
    expect(spawn.mock.calls[0]![2]).toMatchObject({ detached: true, shell: false })

    child.emit('spawn')
    expect(manager.getSnapshot().state).toBe('checking')
    expect(readiness).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: 'host-a', localHost: '127.0.0.1', localPort: 4738 }),
    )

    resolveReadiness?.(true)
    await settle()
    expect(manager.getSnapshot()).toMatchObject({
      state: 'online',
      pid: 4101,
      attempt: 0,
      lastFailure: null,
    })
  })

  it('uses bounded exponential backoff with injected jitter after spawn failures', () => {
    const timer = new FakeTimer()
    const randomValues = [0, 1, 1]
    const spawn = asSpawn(() => {
      throw new Error('spawn failed')
    })
    const manager = new SshTunnelManager({
      hostId: 'host-a',
      transport: TRANSPORT,
      readiness: () => true,
      backoff: { baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0.2 },
      dependencies: { spawn, timer, random: () => randomValues.shift() ?? 0.5 },
    })

    manager.start()
    expect(timer.pendingDelays()).toEqual([80])
    expect(manager.getSnapshot()).toMatchObject({
      state: 'backoff',
      attempt: 1,
      lastFailure: { kind: 'spawn' },
    })

    timer.runNext()
    expect(timer.pendingDelays()).toEqual([240])
    expect(manager.getSnapshot().attempt).toBe(2)

    timer.runNext()
    expect(timer.pendingDelays()).toEqual([250])
    expect(manager.getSnapshot().attempt).toBe(3)
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('distinguishes child error and exit while reconnecting', async () => {
    const timer = new FakeTimer()
    const first = new FakeChild(undefined)
    const second = new FakeChild(4202)
    const spawn = asSpawn(() => (spawn.mock.calls.length === 1 ? first : second).asChildProcess())
    const manager = new SshTunnelManager({
      hostId: 'host-a',
      transport: TRANSPORT,
      readiness: () => true,
      backoff: { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0 },
      dependencies: { spawn, timer, random: () => 0.5 },
    })

    manager.start()
    first.emit('error', new Error('ssh executable missing'))
    expect(manager.getSnapshot()).toMatchObject({
      state: 'backoff',
      lastFailure: { kind: 'error', message: 'ssh executable missing' },
    })

    timer.runNext()
    second.emit('spawn')
    await settle()
    expect(manager.getSnapshot().state).toBe('online')

    second.emit('exit', 7, 'SIGKILL')
    expect(manager.getSnapshot()).toMatchObject({
      state: 'backoff',
      lastFailure: { kind: 'exit', exitCode: 7, signal: 'SIGKILL' },
    })
    expect(timer.pendingDelays()).toEqual([100])
  })

  it('kills the whole process group and reconnects when readiness fails', async () => {
    const timer = new FakeTimer()
    const first = new FakeChild(4301)
    const second = new FakeChild(4302)
    const spawn = asSpawn(() => (spawn.mock.calls.length === 1 ? first : second).asChildProcess())
    const killProcessGroup = vi.fn()
    const manager = new SshTunnelManager({
      hostId: 'host-a',
      transport: TRANSPORT,
      readiness: () => false,
      dependencies: { spawn, timer, random: () => 0.5, killProcessGroup },
    })

    manager.start()
    first.emit('spawn')
    await settle()

    expect(killProcessGroup).toHaveBeenCalledWith(first, 'SIGTERM')
    expect(manager.getSnapshot()).toMatchObject({
      state: 'backoff',
      lastFailure: { kind: 'readiness' },
    })
    timer.runNext()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('stop aborts readiness, kills the owned group, and suppresses later reconnects', async () => {
    const timer = new FakeTimer()
    const child = new FakeChild(4401)
    const spawn = asSpawn(() => child.asChildProcess())
    const killProcessGroup = vi.fn()
    let readinessSignal: AbortSignal | undefined
    const manager = new SshTunnelManager({
      hostId: 'host-a',
      transport: TRANSPORT,
      readiness: ({ signal }) => {
        readinessSignal = signal
        return new Promise<boolean>(() => {})
      },
      dependencies: { spawn, timer, random: () => 0.5, killProcessGroup },
    })

    manager.start()
    child.emit('spawn')
    expect(readinessSignal?.aborted).toBe(false)

    manager.stop()
    expect(readinessSignal?.aborted).toBe(true)
    expect(killProcessGroup).toHaveBeenCalledWith(child, 'SIGTERM')
    expect(manager.getSnapshot()).toEqual({
      hostId: 'host-a',
      state: 'stopped',
      pid: null,
      attempt: 0,
      retryDelayMs: null,
      lastFailure: null,
    })

    child.emit('exit', 1, null)
    await settle()
    expect(timer.pendingDelays()).toEqual([])
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it.runIf(process.platform !== 'win32')(
    'the default cleanup targets the detached POSIX process group',
    () => {
      const timer = new FakeTimer()
      const child = new FakeChild(4501)
      const spawn = asSpawn(() => child.asChildProcess())
      const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)
      const manager = new SshTunnelManager({
        hostId: 'host-a',
        transport: TRANSPORT,
        readiness: () => true,
        dependencies: { spawn, timer, random: () => 0.5 },
      })

      manager.start()
      manager.stop()
      expect(processKill).toHaveBeenCalledWith(-4501, 'SIGTERM')
      processKill.mockRestore()
    },
  )

  it('stop cancels a pending backoff timer', () => {
    const timer = new FakeTimer()
    const spawn = asSpawn(() => {
      throw new Error('cannot spawn')
    })
    const manager = new SshTunnelManager({
      hostId: 'host-a',
      transport: TRANSPORT,
      readiness: () => true,
      dependencies: { spawn, timer, random: () => 0.5 },
    })

    manager.start()
    expect(timer.pendingDelays()).toHaveLength(1)
    manager.stop()
    expect(timer.pendingDelays()).toEqual([])
    expect(manager.getSnapshot().state).toBe('stopped')
  })
})
