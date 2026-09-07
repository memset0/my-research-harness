// GET /api/wiki?project=NAME
//
// Canonically ordered wiki list (kind order, deprecated last within kind,
// `updated_at` descending) with staleness, review state, and lint
// diagnostics. Served entirely from the runtime's wiki cache: no directory
// scan, no file read, and no git subprocess on this path.

import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { wikiProjectTarget, wikiSummaryDto } from '../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const pages = runtime.wikiCache
    .getWikiList(target.project)
    .map((summary) => wikiSummaryDto(target.project, summary))
  return NextResponse.json({ pages })
}
