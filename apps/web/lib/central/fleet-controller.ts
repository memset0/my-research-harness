import type {
  BackendMetadata,
  CentralConfig,
  CentralHostConfig,
  HostAvailability,
} from '@memon/core'
import {
  BackendProbeError,
  type BackendProbeOptions,
  normalizeBackendUpstream,
  probeBackendMetadata,
} from './backend-client'
import { CentralHostRegistry } from './host-registry'
import {
  SshTunnelManager,
  type SshTunnelManagerOptions,
  type SshTunnelSnapshot,
} from './ssh-tunnel'

export interface ManagedSshTunnel {
  start(): void
  stop(): void
}

export type SshTunnelFactory = (options: SshTunnelManagerOptions) => ManagedSshTunnel
export type BackendMetadataProbe = (
  host: CentralHostConfig,
  options?: BackendProbeOptions,
) => Promise<BackendMetadata>

export interface CentralFleetControllerOptions {
  centralRelease?: string
  probeTimeoutMs?: number
  probe?: BackendMetadataProbe
  createSshTunnel?: SshTunnelFactory
  now?: () => Date
}

export type DisplayHostAvailability = HostAvailability & { label?: string }

const SSH_READINESS_RETRY_DELAY_MS = 100

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Owns transport startup/probes while CentralHostRegistry owns public state.
 * Callers schedule `refreshAll()` at their chosen health cadence; each probe
 * has its own hard deadline and one Host failure never rejects the whole fanout.
 */
export class CentralFleetController {
  readonly registry: CentralHostRegistry

  private readonly hosts = new Map<string, CentralHostConfig>()
  private readonly tunnels = new Map<string, ManagedSshTunnel>()
  private readonly probeTimeoutMs: number
  private readonly probe: BackendMetadataProbe
  private readonly createSshTunnel: SshTunnelFactory
  private started = false

  constructor(config: CentralConfig, options: CentralFleetControllerOptions = {}) {
    this.registry = new CentralHostRegistry(config, {
      centralRelease: options.centralRelease,
      now: options.now,
    })
    for (const host of config.hosts) this.hosts.set(host.id, host)
    this.probeTimeoutMs = options.probeTimeoutMs ?? 5_000
    this.probe = options.probe ?? defaultProbe
    this.createSshTunnel =
      options.createSshTunnel ?? ((managerOptions) => new SshTunnelManager(managerOptions))
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const urlRefreshes: Promise<HostAvailability>[] = []
    for (const host of this.hosts.values()) {
      if (host.transport.kind === 'url') {
        urlRefreshes.push(this.refreshHost(host.id))
        continue
      }
      const tunnel = this.createSshTunnel({
        hostId: host.id,
        transport: host.transport,
        readiness: async ({ signal }) => {
          const deadline = Date.now() + this.probeTimeoutMs
          while (!signal.aborted) {
            try {
              const metadata = await this.probe(host, {
                timeoutMs: Math.max(1, deadline - Date.now()),
                signal,
              })
              this.registry.acceptMetadata(host.id, metadata)
              // A valid authenticated response proves the tunnel. Compatibility
              // and identity remain separate registry states that block routing.
              return true
            } catch (error) {
              this.recordProbeFailure(host.id, error)
              if (!(error instanceof BackendProbeError) || error.state !== 'offline') throw error
              const remainingMs = deadline - Date.now()
              if (remainingMs <= 0) throw error
              await waitForRetry(Math.min(SSH_READINESS_RETRY_DELAY_MS, remainingMs), signal)
            }
          }
          throw new BackendProbeError('offline', 'Backend probe was cancelled')
        },
        onStateChange: (snapshot) => this.onTunnelState(host.id, snapshot),
      })
      this.tunnels.set(host.id, tunnel)
      tunnel.start()
    }
    await Promise.all(urlRefreshes)
  }

  stop(): void {
    this.started = false
    for (const tunnel of this.tunnels.values()) tunnel.stop()
    this.tunnels.clear()
  }

  async refreshAll(): Promise<HostAvailability[]> {
    return Promise.all(
      [...this.hosts.values()].map((host) =>
        host.transport.kind === 'url'
          ? this.refreshHost(host.id)
          : Promise.resolve(
              this.registry.getAvailability(host.id) ??
                this.registry.markFailure(host.id, 'misconfigured', 'Host state is missing'),
            ),
      ),
    )
  }

  async refreshHost(hostId: string): Promise<HostAvailability> {
    const host = this.hosts.get(hostId)
    if (!host) throw new Error(`Host ${JSON.stringify(hostId)} is not configured`)
    if (host.transport.kind === 'ssh') {
      return (
        this.registry.getAvailability(hostId) ??
        this.registry.markFailure(hostId, 'misconfigured', 'Host state is missing')
      )
    }

    this.registry.markFailure(hostId, 'connecting', 'Checking Backend readiness')
    try {
      const metadata = await this.probe(host, { timeoutMs: this.probeTimeoutMs })
      return this.registry.acceptMetadata(hostId, metadata)
    } catch (error) {
      return this.recordProbeFailure(hostId, error)
    }
  }

  listDisplayHosts(): DisplayHostAvailability[] {
    return this.registry.listAvailability().map((availability) => {
      const label = this.hosts.get(availability.host)?.label
      return { ...availability, ...(label ? { label } : {}) }
    })
  }

  private recordProbeFailure(hostId: string, error: unknown): HostAvailability {
    if (error instanceof BackendProbeError) {
      return this.registry.markFailure(hostId, error.state, error.message)
    }
    return this.registry.markFailure(hostId, 'offline', 'Backend probe failed')
  }

  private onTunnelState(hostId: string, snapshot: SshTunnelSnapshot): void {
    if (snapshot.state === 'starting' || snapshot.state === 'checking') {
      this.registry.markFailure(hostId, 'connecting', 'Establishing Backend tunnel')
      return
    }
    if (snapshot.state === 'backoff') {
      const current = this.registry.getAvailability(hostId)
      if (
        current?.state !== 'authentication_failed' &&
        current?.state !== 'identity_mismatch' &&
        current?.state !== 'misconfigured'
      ) {
        this.registry.markFailure(hostId, 'offline', 'Backend tunnel is unavailable')
      }
      return
    }
    if (snapshot.state === 'stopped' && this.started) {
      this.registry.markFailure(hostId, 'offline', 'Backend tunnel stopped')
    }
  }
}

async function defaultProbe(
  host: CentralHostConfig,
  options: BackendProbeOptions = {},
): Promise<BackendMetadata> {
  return probeBackendMetadata(normalizeBackendUpstream(host), options)
}
