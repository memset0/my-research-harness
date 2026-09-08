// @vitest-environment node

import {
  BACKEND_API_MAJOR,
  MEMON_RELEASE,
  type BackendCapabilities,
  type BackendMetadata,
  type CentralConfig,
} from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { BackendProbeError } from './backend-client'
import {
  type BackendMetadataProbe,
  CentralFleetController,
  type ManagedSshTunnel,
  type SshTunnelFactory,
} from './fleet-controller'
import type { SshTunnelManagerOptions, SshTunnelSnapshot } from './ssh-tunnel'

const TOKEN_A = 'a'.repeat(32)
const TOKEN_B = 'b'.repeat(32)
const capabilities: BackendCapabilities = {
  projects: true,
  mutations: true,
  events: true,
  logStreaming: true,
  reportAssets: true,
  wikiAssets: true,
  git: true,
  shares: true,
  slurm: false,
}

const config: CentralConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  hosts: [
    {
      id: 'host-a',
      label: 'Cluster A',
      tokens: { current: TOKEN_A },
      transport: {
        kind: 'url',
        baseUrl: 'https://a.example.test',
        allowInsecureHttp: false,
      },
    },
    {
      id: 'host-b',
      tokens: { current: TOKEN_B },
      transport: {
        kind: 'ssh',
        executable: 'ssh',
        target: 'tunnel@b.example.test',
        knownHostsFile: '/run/known_hosts',
        localPort: 4738,
        remoteHost: '127.0.0.1',
        remotePort: 3738,
      },
    },
  ],
}

function metadata(host: string, release: string = MEMON_RELEASE): BackendMetadata {
  return {
    host: host as BackendMetadata['host'],
    release: release as BackendMetadata['release'],
    apiMajor: BACKEND_API_MAJOR,
    revision: '0123456789abcdef' as BackendMetadata['revision'],
    instanceEpoch: '9c64885c-6671-4eb5-9648-d03e04987464' as BackendMetadata['instanceEpoch'],
    ready: true,
    capabilities,
  }
}

class FakeTunnel implements ManagedSshTunnel {
  starts = 0
  stops = 0

  constructor(readonly options: SshTunnelManagerOptions) {}
  start(): void {
    this.starts += 1
  }
  stop(): void {
    this.stops += 1
  }
  state(state: SshTunnelSnapshot['state']): void {
    this.options.onStateChange?.({
      hostId: this.options.hostId,
      state,
      pid: state === 'online' ? 123 : null,
      attempt: 0,
      retryDelayMs: null,
      lastFailure: null,
    })
  }
}

describe('CentralFleetController', () => {
  it('returns safe display Hosts in configured order with optional labels', () => {
    const controller = new CentralFleetController(config)
    const hosts = controller.listDisplayHosts()
    expect(hosts.map((host) => host.host)).toEqual(['host-a', 'host-b'])
    expect(hosts[0]).toMatchObject({ host: 'host-a', label: 'Cluster A', state: 'connecting' })
    expect(hosts[1]).toMatchObject({ host: 'host-b', state: 'connecting' })
    expect(hosts[1]).not.toHaveProperty('label')
    expect(JSON.stringify(hosts)).not.toContain(TOKEN_A)
  })

  it('probes URL Hosts under a deadline while starting SSH Hosts independently', async () => {
    const probe = vi.fn(async (host) => metadata(host.id))
    const tunnels: FakeTunnel[] = []
    const createSshTunnel: SshTunnelFactory = (options) => {
      const tunnel = new FakeTunnel(options)
      tunnels.push(tunnel)
      return tunnel
    }
    const controller = new CentralFleetController(config, {
      probe,
      createSshTunnel,
      probeTimeoutMs: 1234,
    })

    await controller.start()
    expect(probe).toHaveBeenCalledWith(config.hosts[0], { timeoutMs: 1234 })
    expect(tunnels).toHaveLength(1)
    expect(tunnels[0]?.starts).toBe(1)
    expect(controller.registry.getAvailability('host-a')?.state).toBe('online')
    expect(controller.registry.getAvailability('host-b')?.state).toBe('connecting')

    controller.stop()
    expect(tunnels[0]?.stops).toBe(1)
  })

  it('uses authenticated SSH readiness but preserves identity compatibility as Host state', async () => {
    const probe = vi.fn(async () => metadata('wrong-host'))
    let tunnel: FakeTunnel | undefined
    const controller = new CentralFleetController(config, {
      probe,
      createSshTunnel: (options) => {
        tunnel = new FakeTunnel(options)
        return tunnel
      },
    })
    await controller.start()
    const signal = new AbortController().signal
    await expect(
      tunnel?.options.readiness({
        hostId: 'host-b',
        localHost: '127.0.0.1',
        localPort: 4738,
        signal,
      }),
    ).resolves.toBe(true)
    expect(controller.registry.getAvailability('host-b')?.state).toBe('identity_mismatch')
  })

  it('retries only transient SSH readiness failures while OpenSSH binds the forward', async () => {
    let sshAttempts = 0
    const probe = vi.fn<BackendMetadataProbe>(async (host) => {
      if (host.id === 'host-a') return metadata('host-a')
      sshAttempts += 1
      if (sshAttempts < 3) throw new BackendProbeError('offline', 'forward not ready')
      return metadata('host-b')
    })
    let tunnel: FakeTunnel | undefined
    const controller = new CentralFleetController(config, {
      probe,
      probeTimeoutMs: 1_000,
      createSshTunnel: (options) => {
        tunnel = new FakeTunnel(options)
        return tunnel
      },
    })
    await controller.start()

    await expect(
      tunnel?.options.readiness({
        hostId: 'host-b',
        localHost: '127.0.0.1',
        localPort: 4738,
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(true)
    expect(probe).toHaveBeenCalledTimes(4)
    expect(controller.registry.getAvailability('host-b')?.state).toBe('online')
  })

  it.each([
    ['authentication_failed', 'authentication_failed'],
    ['misconfigured', 'misconfigured'],
    ['offline', 'offline'],
  ] as const)('keeps URL probe failure %s distinct', async (probeState, expected) => {
    const controller = new CentralFleetController(config, {
      probe: async () => {
        throw new BackendProbeError(probeState, 'safe failure')
      },
      createSshTunnel: () => new FakeTunnel({} as SshTunnelManagerOptions),
    })
    await controller.start()
    expect(controller.registry.getAvailability('host-a')?.state).toBe(expected)
  })

  it('does not collapse an SSH auth failure into offline backoff', async () => {
    let tunnel: FakeTunnel | undefined
    const controller = new CentralFleetController(config, {
      probe: async () => {
        throw new BackendProbeError('authentication_failed', 'token rejected')
      },
      createSshTunnel: (options) => {
        tunnel = new FakeTunnel(options)
        return tunnel
      },
    })
    await controller.start()
    await expect(
      tunnel?.options.readiness({
        hostId: 'host-b',
        localHost: '127.0.0.1',
        localPort: 4738,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(BackendProbeError)
    tunnel?.state('backoff')
    expect(controller.registry.getAvailability('host-b')?.state).toBe('authentication_failed')
  })

  it('isolates one URL failure and never retains stale Projects for it', async () => {
    let failA = false
    const controller = new CentralFleetController(config, {
      probe: async (host) => {
        if (host.id === 'host-a' && failA) throw new BackendProbeError('offline', 'down')
        return metadata(host.id)
      },
      createSshTunnel: () => new FakeTunnel({} as SshTunnelManagerOptions),
    })
    await controller.start()
    controller.registry.setLiveProjects('host-a', ['project-x'])
    failA = true
    await controller.refreshHost('host-a')
    expect(controller.registry.getAvailability('host-a')?.state).toBe('offline')
    expect(controller.registry.listLiveProjects()).toEqual([])
  })

  it('bounds refreshAll and returns every configured Host without rejecting the fanout', async () => {
    const controller = new CentralFleetController(config, {
      probe: async (host) => {
        if (host.id === 'host-a') throw new BackendProbeError('offline', 'down')
        return metadata(host.id)
      },
      createSshTunnel: () => new FakeTunnel({} as SshTunnelManagerOptions),
    })
    await controller.start()
    await expect(controller.refreshAll()).resolves.toHaveLength(2)
  })

  it('keeps the full compatibility and failure matrix distinct while usable Hosts continue', async () => {
    const fixtures = [
      'current',
      'prior',
      'too-old',
      'newer',
      'major',
      'offline',
      'auth-failed',
      'identity-mismatch',
      'misconfigured',
    ] as const
    const matrixConfig: CentralConfig = {
      bindAddr: '127.0.0.1',
      bindPort: 3737,
      hosts: fixtures.map((id, index) => ({
        id,
        tokens: { current: String.fromCharCode(97 + index).repeat(32) },
        transport: {
          kind: 'url' as const,
          baseUrl: `https://${id}.example.test`,
          allowInsecureHttp: false,
        },
      })),
    }
    const controller = new CentralFleetController(matrixConfig, {
      centralRelease: '6.2.0',
      probe: async (host) => {
        switch (host.id) {
          case 'current':
            return metadata(host.id, '6.2.9')
          case 'prior':
            return metadata(host.id, '6.1.99')
          case 'too-old':
            return metadata(host.id, '6.0.9')
          case 'newer':
            return metadata(host.id, '6.3.0')
          case 'major':
            return metadata(host.id, '7.0.0')
          case 'offline':
            throw new BackendProbeError('offline', 'unreachable')
          case 'auth-failed':
            throw new BackendProbeError('authentication_failed', 'rejected')
          case 'identity-mismatch':
            return metadata('another-host', '6.2.0')
          case 'misconfigured':
            throw new BackendProbeError('misconfigured', 'invalid metadata')
          default:
            throw new BackendProbeError('misconfigured', 'unknown fixture')
        }
      },
    })

    await controller.start()
    expect(
      Object.fromEntries(controller.listDisplayHosts().map((host) => [host.host, host.state])),
    ).toEqual({
      current: 'online',
      prior: 'update_available',
      'too-old': 'upgrade_required',
      newer: 'central_update_required',
      major: 'filesystem_migration_required',
      offline: 'offline',
      'auth-failed': 'authentication_failed',
      'identity-mismatch': 'identity_mismatch',
      misconfigured: 'misconfigured',
    })

    controller.registry.setLiveProjects('current', ['shared'])
    controller.registry.setLiveProjects('prior', ['shared'])
    expect(controller.registry.listLiveProjects()).toEqual([
      { host: 'current', project: 'shared' },
      { host: 'prior', project: 'shared' },
    ])
  })
})
