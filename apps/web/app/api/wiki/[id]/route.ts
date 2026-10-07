import { withStandaloneRequest } from '../../../../lib/server/standalone-request'
// GET|PUT /api/wiki/[id]?project=NAME
//
// GET returns the summary projection plus `content`, `hash`, and the
// centrally-resolved `components[]` (with the component diagnostics merged
// into `diagnostics`). PUT writes through the atomic rename + mtime/hash
// optimistic lock; a write that would change `id` or `kind` is rejected,
// because identity moves only through `memon wiki move`.

import { BackendWikiDocumentSchema, WIKI_ID_REGEX } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../lib/server/runtime'
import { standaloneError } from '../../../../lib/server/standalone-error'
import { standaloneServices } from '../../../../lib/server/standalone-services'
import {
  parseWikiWriteBody,
  wikiComponentProjection,
  wikiError,
  wikiProjectTarget,
} from '../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'
type RouteContext = { params: Promise<{ id: string }> }

function projectPage(value: unknown) {
  const page = BackendWikiDocumentSchema.parse(value)
  const projection = wikiComponentProjection(page.content)
  return {
    ...page,
    path: page.resource,
    components: projection.components,
    diagnostics: [...page.diagnostics, ...projection.diagnostics],
  }
}

async function scopedGET(request: NextRequest, context: RouteContext) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const id = (await context.params).id
  if (!WIKI_ID_REGEX.test(id)) return wikiError(400, 'BAD_REQUEST', 'wiki id must match W<NNNN>')
  try {
    return NextResponse.json(
      projectPage(await standaloneServices(runtime.config).documents.getWiki(target.project, id)),
    )
  } catch (error) {
    return standaloneError(error)
  }
}
async function scopedPUT(request: NextRequest, context: RouteContext) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const id = (await context.params).id
  if (!WIKI_ID_REGEX.test(id)) return wikiError(400, 'BAD_REQUEST', 'wiki id must match W<NNNN>')
  const write = parseWikiWriteBody(await request.json().catch(() => null))
  if (!write) return wikiError(400, 'BAD_REQUEST', 'invalid write request')
  try {
    const result = await standaloneServices(runtime.config).documents.putWiki(
      target.project,
      id,
      write,
    )
    if ('error' in result) return NextResponse.json(result, { status: 409 })
    const page = projectPage(result.page)
    return NextResponse.json({ ...result, page, finalContent: page.content })
  } catch (error) {
    return standaloneError(error)
  }
}

export const GET = withStandaloneRequest(scopedGET)
export const PUT = withStandaloneRequest(scopedPUT)
