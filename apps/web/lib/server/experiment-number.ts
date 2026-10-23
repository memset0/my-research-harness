import 'server-only'

// `/e/<n>` names an Experiment by number. The page resolves the number to the
// one registered `E<NNNN>-<slug>` directory of that Host-qualified Project
// before rendering; two directories with the same number are a repair error,
// never a guess.

import { BackendResourceInventoryResponseSchema, type ProjectRef } from '@memon/core'
import { artifactIdPrefix } from '../project-routes'
import { proxyCentralApiRequest } from './central/backend-proxy'
import { directCentralRuntime } from './central/direct-runtime'
import { getCentralFleet } from './central/fleet-runtime'
import { getRuntime } from './runtime'

export type ExperimentNumberResolution =
  | { kind: 'found'; id: string }
  | { kind: 'missing' }
  | { kind: 'duplicate'; ids: string[] }
  /** The catalog could not be read (an unreachable source): not a missing number. */
  | { kind: 'unavailable' }

/** The registered Experiment ids of a Project: an owner read of its published catalog. */
async function experimentInventory(project: ProjectRef): Promise<string[] | null> {
  const runtime = await getRuntime()
  const search = new URLSearchParams({ host: project.host, project: project.project })
  search.set('inventory', '1')
  const request = new Request(`http://localhost/api/experiments?${search}`)
  const direct = directCentralRuntime(runtime.config)
  let response: Response
  if (direct.registry.capabilities(project.host)) {
    response = await direct
      .dispatch({ request, actor: { role: 'owner' } })
      .catch(() => new Response(null, { status: 502 }))
  } else {
    const fleet = await getCentralFleet().catch(() => null)
    if (!fleet) return null
    response = await proxyCentralApiRequest(request, {
      registry: fleet.registry,
      actor: { role: 'owner' },
    }).catch(() => new Response(null, { status: 502 }))
  }
  if (!response.ok) return null
  const parsed = BackendResourceInventoryResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
  return parsed.success ? parsed.data.items.map((item) => item.id) : null
}

/** Resolve Experiment number `n` of a Project to its directory id. */
export async function resolveExperimentNumber(
  project: ProjectRef,
  number: number,
): Promise<ExperimentNumberResolution> {
  const ids = await experimentInventory(project)
  if (!ids) return { kind: 'unavailable' }
  const prefix = `${artifactIdPrefix('E', number)}-`
  const matches = ids.filter((id) => id.startsWith(prefix)).sort()
  if (matches.length === 1) return { kind: 'found', id: matches[0]! }
  if (matches.length > 1) return { kind: 'duplicate', ids: matches }
  return { kind: 'missing' }
}
