import 'server-only'

// Shared pieces of the owner share API: the runtime's registry, the Project a
// request names (Host-qualified in central mode), and the response row.

import { toHttpError } from '@memon/backend'
import type { NextRequest } from 'next/server'
import type { ScopedShareRow } from '@/lib/dto/shares'
import { publicOrigin } from './auth/public-url'
import { directCentralRuntime } from './central/direct-runtime'
import { getRuntime, type Runtime } from './runtime'
import { type ShareRegistryRecord, shareRegistryFor } from './share-registry'
import { standaloneServices } from './standalone-services'

export async function shareRegistry(runtime?: Runtime) {
  return shareRegistryFor((runtime ?? (await getRuntime())).configPath)
}

/**
 * The configured Project for `{host, project}`: in central mode the Host must
 * be the Project's configured Host; outside central mode no Host is allowed.
 */
export function configuredShareProject(
  runtime: Runtime,
  host: string | null | undefined,
  project: string,
): { host: string | null; project: string } | null {
  const entry = runtime.config.projects.find((candidate) => candidate.name === project)
  if (!entry) return null
  if (runtime.config.central) {
    if (!host || entry.host !== host) return null
    return { host, project }
  }
  return host ? null : { host: null, project }
}

/**
 * One owner read of a Project resource. Host-qualified Projects are served by
 * the central direct runtime (in process); unqualified ones by the standalone
 * services. Returns the HTTP status and JSON body.
 */
async function ownerRead(
  runtime: Runtime,
  host: string | null,
  project: string,
  resource: 'experiments' | 'wiki' | 'reports' | 'runs',
  id: string,
): Promise<{ status: number; body: unknown }> {
  if (host !== null) {
    const direct = directCentralRuntime(runtime.config)
    if (!direct.registry.capabilities(host)) return { status: 404, body: null }
    const search = new URLSearchParams({ host, project })
    const response = await direct.dispatch({
      request: new Request(`http://localhost/api/${resource}/${encodeURIComponent(id)}?${search}`),
      actor: { role: 'owner' },
    })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
  const services = standaloneServices(runtime.config)
  try {
    const body =
      resource === 'wiki'
        ? await services.documents.getWiki(project, id)
        : resource === 'reports'
          ? await services.documents.getReport(project, id)
          : resource === 'runs'
            ? await services.projects.getRun(project, id)
            : await services.projects.getExperiment(project, id)
    return { status: 200, body }
  } catch (error) {
    const status = toHttpError(error)?.status
    if (status === undefined) throw error
    return { status, body: null }
  }
}

/**
 * True when the published catalog resolves this document, false when it is
 * missing, unrefreshed or malformed; any other failure (an unreachable
 * source) is thrown.
 */
export async function sharedDocumentExists(
  runtime: Runtime,
  host: string | null,
  project: string,
  kind: 'experiment' | 'wiki' | 'report',
  id: string,
): Promise<boolean> {
  const resource = kind === 'wiki' ? 'wiki' : kind === 'report' ? 'reports' : 'experiments'
  const { status } = await ownerRead(runtime, host, project, resource, id)
  if (status === 200) return true
  if (status === 404 || status === 400) return false
  throw new Error(`document read failed with HTTP ${status}`)
}

/** The project-relative run directory of a Run, or null when it cannot be read. */
export async function runResource(
  runtime: Runtime,
  host: string | null,
  project: string,
  id: string,
): Promise<string | null> {
  try {
    const { status, body } = await ownerRead(runtime, host, project, 'runs', id)
    const resource = (body as { resource?: unknown } | null)?.resource
    return status === 200 && typeof resource === 'string' ? resource : null
  } catch {
    return null
  }
}

export function shareRow(req: NextRequest, record: ShareRegistryRecord): ScopedShareRow {
  return { ...record, share_url: `${publicOrigin(req)}/s/${encodeURIComponent(record.token)}` }
}
