// GET|HEAD /api/doc-assets/[project]/[...projectRelativePath][?host=NAME][&thumbnail=1]
//
// One file belonging to a document: a component execution cache
// (`<dir>/<stem>__assets/<id>.json`), or an image or video a `figure` block
// points at. Videos rely on the byte-range support below for metadata reads
// and seeking.
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
import { projectFs, withProjectFileContext } from '@memon/core'

const { realpath } = projectFs

import { Readable } from 'node:stream'
import { extname, resolve, sep } from '@memon/file-protocol/paths'
import { type NextRequest, NextResponse } from 'next/server'
import { isNotModified, parseByteRange } from '../../../../../lib/server/asset-validators'
import { assertWithinProjectRoots } from '../../../../../lib/server/path-safety'
import { findConfiguredProject } from '../../../../../lib/server/project-lookup'
import { getRuntime } from '../../../../../lib/server/runtime'
import { withLocalSourceFile } from '../../../../../lib/server/source-materialization'
import { standaloneError } from '../../../../../lib/server/standalone-error'
import { extractVideoThumbnail } from '../../../../../lib/server/video-thumbnail'

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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
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
  const thumbnail = new URL(request.url).searchParams.get('thumbnail') === '1'
  if (thumbnail && !contentType.startsWith('video/')) {
    return error(404, 'NOT_FOUND', 'thumbnails exist only for videos')
  }

  const runtime = await getRuntime()
  const project = findConfiguredProject(
    runtime.config,
    projectName,
    new URL(request.url).searchParams.get('host'),
  )
  if (!project) return error(404, 'NOT_FOUND', 'Project not found')

  try {
    return await withProjectFileContext(
      {
        root: project.root,
        storage: project.storage,
        cachePolicy: project.access?.cache,
        reason: 'open',
        readOnly: true,
        persistentCache: project.persistentCache,
      },
      async () => {
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
        } catch (cause) {
          if (['EACCES', 'OUTSIDE_PROJECT'].includes((cause as { code?: string }).code ?? ''))
            return error(400, 'BAD_REQUEST', 'document asset escapes the project root')
          if (['ENOENT', 'ENOTDIR'].includes((cause as { code?: string }).code ?? ''))
            return error(404, 'NOT_FOUND', 'document asset not found')
          throw cause
        }
        if (!absolutePath.startsWith(`${root}${sep}`)) {
          return error(400, 'BAD_REQUEST', 'document asset escapes the project root')
        }
        const handle = await projectFs.open(absolutePath, 'r')
        let transferred = false
        try {
          const stats = await handle.stat()
          if (!stats.isFile()) return error(404, 'NOT_FOUND', 'document asset not found')

          if (thumbnail)
            return await serveThumbnail(
              request,
              runtime.config.media?.ffmpeg ?? 'ffmpeg',
              absolutePath,
              stats,
              includeBody,
              handle,
            )

          const etag = `W/"${createHash('sha1')
            .update(
              `${absolutePath}:${stats.size}:${stats.mtimeMs}:${Reflect.get(handle, 'fileId') ?? stats.ino}`,
            )
            .digest('hex')}"`
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
          headers.set(
            'content-length',
            String(selected ? selected.end - selected.start + 1 : stats.size),
          )
          if (selected) {
            headers.set('content-range', `bytes ${selected.start}-${selected.end}/${stats.size}`)
          }
          const body =
            includeBody && request.method !== 'HEAD'
              ? (Readable.toWeb(
                  handle.createReadStream({
                    ...(selected ? { start: selected.start, end: selected.end } : {}),
                    highWaterMark: 64 * 1024,
                  }),
                ) as ReadableStream)
              : null
          transferred = body !== null
          return new NextResponse(body, { status: selected ? 206 : 200, headers })
        } finally {
          if (!transferred) await handle.close()
        }
      },
    )
  } catch (cause) {
    if (['ENOENT', 'ENOTDIR'].includes((cause as { code?: string }).code ?? ''))
      return error(404, 'NOT_FOUND', 'document asset not found')
    return standaloneError(cause)
  }
}

function error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}

/**
 * First-frame JPEG of a figure video. Validators come from the video's stat,
 * so a revalidation answers 304 before any ffmpeg process starts.
 */
async function serveThumbnail(
  request: NextRequest,
  ffmpeg: string,
  absolutePath: string,
  stats: { size: number; mtimeMs: number; ino?: number },
  includeBody: boolean,
  handle: Awaited<ReturnType<typeof projectFs.open>>,
) {
  const etag = `W/"${createHash('sha1')
    .update(
      `${absolutePath}:${stats.size}:${stats.mtimeMs}:${Reflect.get(handle, 'fileId') ?? stats.ino}:thumb-v1`,
    )
    .digest('hex')}"`
  const headers = new Headers({
    'cache-control': 'private, no-cache',
    'content-type': 'image/jpeg',
    etag,
    'last-modified': new Date(stats.mtimeMs).toUTCString(),
    'x-content-type-options': 'nosniff',
  })
  if (isNotModified(request, etag, stats.mtimeMs)) {
    return new NextResponse(null, { status: 304, headers })
  }
  const jpeg = await withLocalSourceFile(
    absolutePath,
    (local) => extractVideoThumbnail(ffmpeg, local),
    handle,
  )
  if (!jpeg)
    return error(404, 'THUMBNAIL_UNAVAILABLE', 'no thumbnail could be extracted from this video')
  headers.set('content-length', String(jpeg.length))
  return new NextResponse(includeBody && request.method !== 'HEAD' ? new Uint8Array(jpeg) : null, {
    status: 200,
    headers,
  })
}
