// GET|PUT /api/wiki/[id]?project=NAME
//
// GET returns the summary projection plus `content`, `hash`, and the
// centrally-resolved `components[]` (with the component diagnostics merged
// into `diagnostics`). PUT writes through the atomic rename + mtime/hash
// optimistic lock; a write that would change `id` or `kind` is rejected,
// because identity moves only through `memon wiki move`.

import { WIKI_ID_REGEX } from '@memon/core'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime, type Runtime } from '../../../../lib/runtime'
import {
  parseWikiWriteBody,
  wikiError,
  wikiPageDto,
  wikiProjectTarget,
  wikiWriteIdentityError,
} from '../../../../lib/server/wiki-route'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const id = (await context.params).id
  if (!WIKI_ID_REGEX.test(id)) {
    return wikiError(400, 'BAD_REQUEST', 'wiki id must match W<NNNN>')
  }
  const page = await runtime.wikiCache.getWikiPage(target.project, id)
  if (!page) return wikiError(404, 'NOT_FOUND', `wiki page ${id} not found`)
  return NextResponse.json(
    wikiPageDto(target.project, page.summary, page.content, page.hash, {
      fileExists: bundleProbe(runtime, target.project, id),
    }),
  )
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const runtime = await getRuntime()
  const target = wikiProjectTarget(runtime, new URL(request.url).searchParams)
  if ('error' in target) return target.error
  const id = (await context.params).id
  if (!WIKI_ID_REGEX.test(id)) {
    return wikiError(400, 'BAD_REQUEST', 'wiki id must match W<NNNN>')
  }
  const summary = runtime.wikiCache.getWikiSummary(target.project, id)
  if (!summary) return wikiError(404, 'NOT_FOUND', `wiki page ${id} not found`)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return wikiError(400, 'BAD_REQUEST', 'invalid JSON body')
  }
  const write = parseWikiWriteBody(raw)
  if (!write) return wikiError(400, 'BAD_REQUEST', 'invalid write request')
  const identityError = wikiWriteIdentityError(summary, write.content)
  if (identityError) return wikiError(400, 'BAD_REQUEST', identityError)

  const result = await runtime.wikiCache.putWikiPage(
    target.project,
    id,
    write.content,
    write.expectedMtime,
    write.expectedHash,
  )
  if (!result.ok) {
    if (result.code === 'NOT_FOUND') {
      return wikiError(404, 'NOT_FOUND', `wiki page ${id} not found`)
    }
    if (result.code === 'CONFLICT') {
      return NextResponse.json(
        {
          error: { code: 'CONFLICT', message: 'wiki page changed on disk' },
          currentMtime: result.currentMtime,
          currentHash: result.currentHash,
          currentContent: result.currentContent,
        },
        { status: 409 },
      )
    }
    return wikiError(500, 'INTERNAL', result.message ?? 'wiki write failed')
  }

  const written = runtime.wikiCache.getWikiSummary(target.project, id) ?? summary
  return NextResponse.json({
    ok: true,
    mtime: result.mtime,
    hash: result.hash,
    page: wikiPageDto(target.project, written, write.content, result.hash, {
      fileExists: bundleProbe(runtime, target.project, id),
    }),
    finalContent: write.content,
  })
}

/**
 * Bundle-relative existence probe for `memon-data` file payloads, backed by
 * the cache's asset listing. A single-file page has no bundle, so every
 * relative payload path is unresolvable by construction.
 */
function bundleProbe(
  runtime: Runtime,
  project: string,
  id: string,
): (relativePath: string) => boolean {
  const assets = new Set(runtime.wikiCache.getPageRecord(project, id)?.assets ?? [])
  return (relativePath) => assets.has(relativePath.replace(/^\.\//, ''))
}
