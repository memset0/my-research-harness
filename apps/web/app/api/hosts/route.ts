import type { HostAvailability } from '@memon/core'
import type { DisplayHostAvailability } from '../../../lib/central/fleet-controller'
import { getCentralFleet } from '../../../lib/central/fleet-runtime'

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
    const fleet = await getCentralFleet()
    return Response.json(buildHostsResponse(fleet.listDisplayHosts()), {
      headers: { 'cache-control': 'no-store' },
    })
  } catch {
    return Response.json(
      { error: { message: 'Host registry is unavailable' } },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    )
  }
}
