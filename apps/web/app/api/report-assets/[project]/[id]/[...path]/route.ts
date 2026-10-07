import { Readable } from 'node:stream'
import { BackendStreamServiceError } from '@memon/backend'
import { type NextRequest, NextResponse } from 'next/server'
import { getRuntime } from '../../../../../../lib/server/runtime'
import { standaloneError } from '../../../../../../lib/server/standalone-error'
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
      return error(400, 'BAD_REQUEST', 'invalid report resource path')
    }
    resource = decoded.join('/')
  } catch {
    return error(400, 'BAD_REQUEST', 'invalid report resource encoding')
  }
  try {
    const runtime = await getRuntime()
    const service = standaloneServices(runtime.config).streaming
    const asset = await service.resolveReportAsset(project, id, resource)
    try {
      const headers = new Headers({
        'accept-ranges': 'bytes',
        'cache-control': 'private, no-cache',
        'content-type': asset.contentType,
        etag: asset.etag,
        'last-modified': new Date(asset.mtimeMs).toUTCString(),
        'x-content-type-options': 'nosniff',
        'x-memon-resource-version': asset.version,
      })
      if (notModified(request, asset.etag, asset.mtimeMs)) {
        return new NextResponse(null, { status: 304, headers })
      }
      const range = request.headers.get('range')
      const selected = range ? parseRange(range, asset.size) : null
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
    } finally {
      await service.closeByteResource?.(asset)
    }
  } catch (caught) {
    if (caught instanceof BackendStreamServiceError) {
      const status =
        caught.code === 'INVALID_RESOURCE' ? 403 : caught.code === 'AMBIGUOUS_RESOURCE' ? 409 : 404
      return error(status, caught.code, caught.message)
    }
    return standaloneError(caught)
  }
}

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || size <= 0) return null
  if (!match[1]) {
    const suffix = Number(match[2])
    return Number.isSafeInteger(suffix) && suffix > 0
      ? { start: Math.max(0, size - suffix), end: size - 1 }
      : null
  }
  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < size &&
    end >= start
    ? { start, end: Math.min(end, size - 1) }
    : null
}

function notModified(request: NextRequest, etag: string, mtimeMs: number): boolean {
  const noneMatch = request.headers.get('if-none-match')
  if (noneMatch) return noneMatch.split(',').some((value) => ['*', etag].includes(value.trim()))
  const since = request.headers.get('if-modified-since')
  if (!since) return false
  const parsed = Date.parse(since)
  return Number.isFinite(parsed) && Math.floor(mtimeMs / 1000) <= Math.floor(parsed / 1000)
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}
