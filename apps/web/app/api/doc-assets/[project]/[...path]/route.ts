// GET|HEAD /api/doc-assets/[project]/[...projectRelativePath][?host=NAME]
//
// One file belonging to a document: a component execution cache
// (`<dir>/<stem>__assets/<id>.json`) or an image a `figure` block points at.
// The address is the project-relative path of the file itself, so every
// Markdown surface can serve its own neighbouring assets without a
// per-document id space.
//
// Containment is decided before any filesystem call — decoded segments may
// not be empty, dot-segments, encoded separators or contain NUL — and again
// after `realpath`, so neither a traversal nor an escaping symlink can leave
// the addressed Project root. Cache JSON is never cached by the browser: a
// recompute must be visible on the next read.

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { type NextRequest, NextResponse } from 'next/server'
import { assertWithinProjectRoots } from '../../../../../lib/path-safety'
import { getRuntime } from '../../../../../lib/runtime'
import { isNotModified, parseByteRange } from '../../../../../lib/server/asset-validators'
import { findConfiguredProject } from '../../../../../lib/server/project-lookup'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ project: string; path: string[] | string }>
}

/** Everything this route will serve; anything else is not a document asset. */
const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

/** An SVG is a document: deny every fetch and inline script, allow styling. */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'"

export async function GET(request: NextRequest, context: RouteContext) {
  return serve(request, context, true)
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return serve(request, context, false)
}

async function serve(request: NextRequest, context: RouteContext, includeBody: boolean) {
  const params = await context.params
  let projectName: string
  let relative: string
  try {
    projectName = decodeURIComponent(params.project)
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
          segment.includes('\\') ||
          segment.includes('\0'),
      )
    ) {
      return error(400, 'BAD_REQUEST', 'invalid document asset path')
    }
    relative = decoded.join('/')
  } catch {
    return error(400, 'BAD_REQUEST', 'invalid document asset encoding')
  }
  if (projectName === '' || projectName.includes('\0')) {
    return error(400, 'BAD_REQUEST', 'invalid project selector')
  }

  const extension = extname(relative).toLowerCase()
  const contentType = CONTENT_TYPES[extension]
  if (!contentType) return error(404, 'NOT_FOUND', 'not a document asset type')

  const runtime = await getRuntime()
  const project = findConfiguredProject(
    runtime.config,
    projectName,
    new URL(request.url).searchParams.get('host'),
  )
  if (!project) return error(404, 'NOT_FOUND', 'Project not found')

  // The addressed Project decides the scope a viewer share was checked
  // against, so the file must live under *that* root — not merely under some
  // configured root.
  const root = resolve(project.root)
  const target = resolve(root, relative)
  if (!target.startsWith(`${root}${sep}`)) {
    return error(400, 'BAD_REQUEST', 'document asset escapes the project root')
  }
  try {
    assertWithinProjectRoots(target, runtime.config)
  } catch {
    return error(400, 'BAD_REQUEST', 'document asset escapes the project root')
  }

  let absolutePath: string
  try {
    absolutePath = await realpath(target)
  } catch {
    return error(404, 'NOT_FOUND', 'document asset not found')
  }
  if (!absolutePath.startsWith(`${root}${sep}`)) {
    return error(400, 'BAD_REQUEST', 'document asset escapes the project root')
  }
  const stats = await stat(absolutePath).catch(() => null)
  if (!stats?.isFile()) return error(404, 'NOT_FOUND', 'document asset not found')

  const etag = `W/"${createHash('sha1').update(`${absolutePath}:${stats.size}:${stats.mtimeMs}`).digest('hex')}"`
  const headers = new Headers({
    'accept-ranges': 'bytes',
    // A recomputed cache file must be visible on the next read; images are
    // content-addressed by their validators like every other bundle asset.
    'cache-control': extension === '.json' ? 'no-store' : 'private, no-cache',
    'content-type': contentType,
    etag,
    'last-modified': new Date(stats.mtimeMs).toUTCString(),
    'x-content-type-options': 'nosniff',
  })
  if (contentType === 'image/svg+xml') headers.set('content-security-policy', SVG_CSP)
  if (isNotModified(request, etag, stats.mtimeMs)) {
    return new NextResponse(null, { status: 304, headers })
  }

  const range = request.headers.get('range')
  const selected = range ? parseByteRange(range, stats.size) : null
  if (range && !selected) {
    headers.set('content-range', `bytes */${stats.size}`)
    headers.set('content-length', '0')
    return new NextResponse(null, { status: 416, headers })
  }
  headers.set('content-length', String(selected ? selected.end - selected.start + 1 : stats.size))
  if (selected) {
    headers.set('content-range', `bytes ${selected.start}-${selected.end}/${stats.size}`)
  }
  const body =
    includeBody && request.method !== 'HEAD'
      ? (Readable.toWeb(
          createReadStream(absolutePath, {
            ...(selected ? { start: selected.start, end: selected.end } : {}),
            highWaterMark: 64 * 1024,
          }),
        ) as ReadableStream)
      : null
  return new NextResponse(body, { status: selected ? 206 : 200, headers })
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}
