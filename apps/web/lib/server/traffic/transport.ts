// Transport classification and the gateway's probe hook, shared by the
// content gateway (loaded by the custom entry) and the bundled /api/traffic
// routes. In the custom entry's import graph: no `server-only` import.

import type { ProjectConfig } from '@memon/core'
import type { ProbeStep, TrafficTransport } from './tracker'

/** Which transport carries a Project's forwarded service traffic. */
export function serviceTransportOf(project: ProjectConfig): TrafficTransport {
  if (project.access?.kind === 'agent') return 'file-agent'
  if (project.access?.kind === 'sshfs' || project.storage === 'sshfs') return 'ssh-tunnel'
  return 'native'
}

/** Content assets are read through the project file layer, never a service tunnel. */
export function assetTransportOf(project: ProjectConfig): TrafficTransport {
  if (project.access?.kind === 'agent') return 'file-agent'
  if (project.access?.kind === 'sshfs' || project.storage === 'sshfs') return 'sshfs'
  return 'native'
}

export interface ServiceFetchProbeInput {
  host: string
  project: string
  kind: 'wiki' | 'report'
  id: string
  path: string
  maxBytes: number
  timeoutMs: number
}

/** Owner-triggered re-fetch through the live forwarding target (see /api/traffic/probe). */
export interface ServiceProbeHook {
  fetch(input: ServiceFetchProbeInput): Promise<ProbeStep>
}

const SERVICE_PROBE_KEY = Symbol.for('memon.content-gateway.service-probe.v1')

export function serviceProbeHook(): ServiceProbeHook | undefined {
  return (globalThis as unknown as Record<symbol, ServiceProbeHook | undefined>)[SERVICE_PROBE_KEY]
}

export function registerServiceProbeHook(hook: ServiceProbeHook): void {
  ;(globalThis as unknown as Record<symbol, ServiceProbeHook | undefined>)[SERVICE_PROBE_KEY] = hook
}
