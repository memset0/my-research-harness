// GET /api/wiki/backlinks/[artifact]?project=NAME
//
// Wiki pages whose `sources` cite one artifact — an Experiment (`E0017` or
// `E0017-slug`), a Variant row, a hypothesis, a run directory, or another
// page. Rows are ordered newest `updated_at` first, exactly as the Experiment
// detail projection's `citedBy` is. Served from the cached backlink index.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/runtime'
import { wikiError, wikiProjectTarget } from '../../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ artifact: string }> }) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
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
  return NextResponse.json({
    artifact,
    pages: runtime.wikiCache.getWikiBacklinks(target.project, artifact),
  })
}
