// GET|HEAD /api/wiki-assets/[project]/[W-id]/[...path]
//
// Bundle assets of one wiki page (`docs/wiki/<kind>/W<NNNN>-<slug>/…`), with
// MIME types, range support, and etag / last-modified validators — the same
// contract as the Report bundle route, so both kinds share one asset client.
// Dot-segments are rejected here before any filesystem call, and the stream
// service independently enforces containment inside the bundle directory.

import { Readable } from 'node:stream'
import { BackendStreamServiceError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { isNotModified, parseByteRange } from '../../../../../../lib/server/asset-validators'
import { getRuntime } from '../../../../../../lib/server/runtime'
import { standaloneServices } from '../../../../../../lib/server/standalone-services'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ project: string; id: string; path: string[] | string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  return serve(request, context, true)
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return serve(request, context, false)
}

async function serve(request: NextRequest, context: RouteContext, includeBody: boolean) {
  const params = await context.params
  let project: string
  let id: string
  let resource: string
  try {
    project = decodeURIComponent(params.project)
    id = decodeURIComponent(params.id)
    const segments = Array.isArray(params.path) ? params.path : params.path.split('/')
    const decoded = segments.map((segment) => decodeURIComponent(segment))
    if (
      decoded.length === 0 ||
      decoded.some(
        (segment) =>
          segment === '' ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('/') ||
          segment.includes('\\'),
      )
    ) {
      return error(400, 'BAD_REQUEST', 'invalid wiki resource path')
    }
    resource = decoded.join('/')
  } catch {
    return error(400, 'BAD_REQUEST', 'invalid wiki resource encoding')
  }
  try {
    const runtime = await getRuntime()
    const service = standaloneServices(runtime.config).streaming
    const asset = await service.resolveWikiAsset(project, id, resource)
    const headers = new Headers({
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-cache',
      'content-type': asset.contentType,
      etag: asset.etag,
      'last-modified': new Date(asset.mtimeMs).toUTCString(),
      'x-content-type-options': 'nosniff',
      'x-memon-resource-version': asset.version,
    })
    if (asset.contentSecurityPolicy)
      headers.set('content-security-policy', asset.contentSecurityPolicy)
    if (isNotModified(request, asset.etag, asset.mtimeMs)) {
      return new NextResponse(null, { status: 304, headers })
    }
    const range = request.headers.get('range')
    const selected = range ? parseByteRange(range, asset.size) : null
    if (range && !selected) {
      headers.set('content-range', `bytes */${asset.size}`)
      headers.set('content-length', '0')
      return new NextResponse(null, { status: 416, headers })
    }
    const length = selected ? selected.end - selected.start + 1 : asset.size
    headers.set('content-length', String(length))
    if (selected) {
      headers.set('content-range', `bytes ${selected.start}-${selected.end}/${asset.size}`)
    }
    const body =
      includeBody && request.method !== 'HEAD'
        ? (Readable.toWeb(service.openByteStream(asset, selected ?? undefined)) as ReadableStream)
        : null
    return new NextResponse(body, { status: selected ? 206 : 200, headers })
  } catch (caught) {
    if (caught instanceof BackendStreamServiceError) {
      const status =
        caught.code === 'INVALID_RESOURCE' ? 403 : caught.code === 'AMBIGUOUS_RESOURCE' ? 409 : 404
      return error(status, caught.code, caught.message)
    }
    return error(500, 'INTERNAL', 'wiki resource failed')
  }
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}
