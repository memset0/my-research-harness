// GET /api/wiki/backlinks/[artifact]?project=NAME
//
// Wiki pages whose `sources` cite one artifact — an Experiment (`E0017` or
// `E0017-slug`), a Variant row, a hypothesis, a run directory, or another
// page. Rows are ordered newest `updated_at` first and loaded independently
// of Experiment details, so source resolution cannot delay their response.

import { type NextRequest, NextResponse } from 'next/server'
import type { WikiBacklinksResponse } from '@/lib/dto/wiki'
import { servesProjectsDirectly } from '../../../../../lib/server/central/direct-projects'
import { directCentralRuntime } from '../../../../../lib/server/central/direct-runtime'
import { getRuntime } from '../../../../../lib/server/runtime'
import { wikiError, wikiProjectTarget } from '../../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ artifact: string }> },
) {
  const runtime = await getRuntime()
  const searchParams = new URL(request.url).searchParams
  const target = wikiProjectTarget(runtime, searchParams)
  if ('error' in target) return target.error
  let artifact: string
  try {
    artifact = decodeURIComponent((await context.params).artifact)
  } catch {
    return wikiError(400, 'BAD_REQUEST', 'invalid artifact encoding')
  }
  if (artifact === '' || artifact.includes('/') || artifact.length > 512) {
    return wikiError(400, 'BAD_REQUEST', 'invalid artifact selector')
  }
  // A directly served Project has no warm wiki cache: project the citing
  // pages from the Project's own files through the file store, with the same
  // version/status/epoch envelope every polled resource carries.
  if (servesProjectsDirectly(runtime.config)) {
    const response = await directCentralRuntime(runtime.config).readJsonResource(
      { host: searchParams.get('host'), project: target.project, request },
      async (documents) => ({
        artifact,
        pages: await documents.wikiBacklinks(target.project, artifact),
      }),
    )
    return response ?? wikiError(404, 'NOT_FOUND', 'project is not served by this instance')
  }
  return NextResponse.json({
    artifact,
    pages: runtime.wikiCache.getWikiBacklinks(target.project, artifact),
  } satisfies WikiBacklinksResponse)
}
