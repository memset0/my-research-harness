import 'server-only'

// Shared pieces of the owner share API: the runtime's registry, the Project a
// request names (Host-qualified in central mode), and the response row.

import type { NextRequest } from 'next/server'
import type { ScopedShareRow } from '@/lib/dto/shares'
import { publicOrigin } from './auth/public-url'
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

/** True when the published catalog resolves this document. */
export async function sharedDocumentExists(
  runtime: Runtime,
  project: string,
  kind: 'experiment' | 'wiki' | 'report',
  id: string,
): Promise<boolean> {
  const services = standaloneServices(runtime.config)
  try {
    if (kind === 'wiki') await services.documents.getWiki(project, id)
    else if (kind === 'report') await services.documents.getReport(project, id)
    else await services.projects.getExperiment(project, id)
    return true
  } catch {
    return false
  }
}

export function shareRow(req: NextRequest, record: ShareRegistryRecord): ScopedShareRow {
  return { ...record, share_url: `${publicOrigin(req)}/s/${encodeURIComponent(record.token)}` }
}
