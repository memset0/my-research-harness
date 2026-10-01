// Conditional-request and byte-range primitives shared by the asset routes
// (`/api/wiki-assets`, `/api/report-assets`, `/api/doc-assets`).
//
// Pure functions over header strings and a file size: no filesystem, no
// Runtime. Keeping them here means every asset route answers `Range`,
// `If-None-Match` and `If-Modified-Since` identically, so one asset client
// serves bundles and document assets alike.

import 'server-only'

export interface ByteRange {
  start: number
  end: number
}

/** Single-range `bytes=` request, clamped to the file; null when unsatisfiable. */
export function parseByteRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || size <= 0) return null
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
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

/** True when the caller's validators already match the current representation. */
export function isNotModified(request: Request, etag: string, mtimeMs: number): boolean {
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === etag)) return true
  const ifModifiedSince = request.headers.get('if-modified-since')
  if (!ifModifiedSince) return false
  const since = Date.parse(ifModifiedSince)
  return Number.isFinite(since) && Math.floor(mtimeMs / 1000) * 1000 <= since
}
