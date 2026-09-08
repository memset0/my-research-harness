// GET /api/wiki?project=NAME
//
// The rich list keeps its existing runtime-cache projection. `inventory=1`
// instead performs identity-only discovery so navigation never resolves source
// artifacts or walks bundle attachments.

import { BackendWikiInventoryResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../lib/runtime'
import { wikiProjectTarget, wikiSummaryDto } from '../../../lib/server/wiki-route'
import { standaloneServices } from '../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  if (new URL(request.url).searchParams.get('inventory') === '1') {
    return NextResponse.json(
      BackendWikiInventoryResponseSchema.parse(
        await standaloneServices(runtime.config).documents.listWiki(target.project, {
          inventoryOnly: true,
        }),
      ),
    )
  }
  const pages = runtime.wikiCache
    .getWikiList(target.project)
    .map((summary) => wikiSummaryDto(target.project, summary))
  return NextResponse.json({ pages })
}
