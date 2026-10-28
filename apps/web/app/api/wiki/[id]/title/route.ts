// POST /api/wiki/[id]/title?project=NAME  { "title": "…" }
//
// Owner-only rename of a Wiki page's display title. Only the title bytes of
// the page (and its catalog entry) change; a read-only Project needs
// `allowed_edits: [title]`.

import { WIKI_ID_REGEX } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../lib/server/runtime'
import { standaloneError } from '../../../../../lib/server/standalone-error'
import { withStandaloneRequest } from '../../../../../lib/server/standalone-request'
import { standaloneServices } from '../../../../../lib/server/standalone-services'
import { wikiError, wikiProjectTarget } from '../../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

async function scopedPOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const id = (await context.params).id
  if (!WIKI_ID_REGEX.test(id)) return wikiError(400, 'BAD_REQUEST', 'wiki id must match W<NNNN>')
  const body = (await request.json().catch(() => null)) as { title?: unknown } | null
  try {
    const page = await standaloneServices(runtime.config).documents.setWikiTitle(
      target.project,
      id,
      { title: body?.title },
    )
    return NextResponse.json({ ok: true, title: page.title })
  } catch (error) {
    return standaloneError(error)
  }
}

export const POST = withStandaloneRequest(scopedPOST)
