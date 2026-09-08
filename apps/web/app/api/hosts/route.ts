import type { HostAvailability } from '@memon/core'
import { servesProjectsDirectly } from '../../../lib/central/direct-projects'
import { directCentralRuntime } from '../../../lib/central/direct-runtime'
import type { DisplayHostAvailability } from '../../../lib/central/fleet-controller'
import { getCentralFleet } from '../../../lib/central/fleet-runtime'
import { getRuntime } from '../../../lib/runtime'

export interface HostsResponse {
  hosts: DisplayHostAvailability[]
}

export function buildHostsResponse(
  hosts: readonly (HostAvailability & { label?: string })[],
): HostsResponse {
  return { hosts: hosts.map((host) => structuredClone(host)) }
}

export async function GET(): Promise<Response> {
  try {
    const runtime = await getRuntime()
    const hosts: DisplayHostAvailability[] = []
    // Host namespaces served from this instance's own filesystem are online
    // as soon as the process is: no probe, no service token, no fan-in.
    if (servesProjectsDirectly(runtime.config)) {
      hosts.push(...directCentralRuntime(runtime.config).registry.listAvailability())
    }
    if ((runtime.config.central?.hosts.length ?? 0) > 0) {
      hosts.push(...(await getCentralFleet()).listDisplayHosts())
    }
    if (hosts.length === 0) {
      return Response.json(
        { error: { message: 'Host registry is unavailable' } },
        { status: 404, headers: { 'cache-control': 'no-store' } },
      )
    }
    return Response.json(buildHostsResponse(hosts), {
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return Response.json(
      { error: { message: 'Host registry is unavailable' } },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    )
  }
}
