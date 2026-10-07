import { withStandaloneRequest } from '../../../lib/server/standalone-request'
// GET /api/wiki?project=NAME
//
// The rich list keeps its existing runtime-cache projection. `inventory=1`
// instead performs identity-only discovery so navigation never resolves source
// artifacts or walks bundle attachments.

import { BackendWikiInventoryResponseSchema, BackendWikiPagesResponseSchema } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import type { WikiPagesResponse } from '@/lib/dto/wiki'
import { getRuntime } from '../../../lib/server/runtime'
import { standaloneServices } from '../../../lib/server/standalone-services'
import { wikiProjectTarget } from '../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

async function scopedGET(request: NextRequest) {
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
  const { pages } = BackendWikiPagesResponseSchema.parse(
    await standaloneServices(runtime.config).documents.listWiki(target.project),
  )
  return NextResponse.json({
    pages: pages.map((page) => ({ ...page, path: page.resource })),
  } satisfies WikiPagesResponse)
}

export const GET = withStandaloneRequest(scopedGET)
