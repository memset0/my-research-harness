/**
 * Client-side URL building for the document asset route.
 *
 * A component payload names files the way a human would: relative to the
 * containing document, or absolute inside a configured project root. Both
 * forms travel to `GET /api/doc-assets/<project>/<...project-relative path>`,
 * which is the only thing allowed to decide whether the real path is inside a
 * project root.
 *
 * `componentAssetsDir` is a deliberate small copy of the `@memon/core`
 * function: `lib/api.ts` keeps the core JS module out of the client bundle.
 */

import type { ComponentDocumentRef } from './types'

/** `docs/wiki/note/W1-x.md` → `docs/wiki/note/W1-x__assets`. */
export function componentAssetsDir(documentPath: string): string {
  const slash = documentPath.lastIndexOf('/')
  const directory = slash === -1 ? '' : documentPath.slice(0, slash + 1)
  const file = documentPath.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  return `${directory}${dot <= 0 ? file : file.slice(0, dot)}__assets`
}

/**
 * Normalise a `/`-separated path into segments, dropping `.` and resolving
 * `..` against `base`. A `..` that would climb above the root is dropped: the
 * route refuses escapes anyway, and a clamped path fails as a plain 404
 * instead of as a malformed URL.
 */
function resolveSegments(base: readonly string[], target: string): string[] {
  const out = [...base]
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out
}

function assetRouteUrl(
  doc: ComponentDocumentRef,
  segments: readonly string[],
  absolute: boolean,
): string {
  const encoded = segments.map((segment) => encodeURIComponent(segment))
  if (absolute) encoded[0] = encodeURIComponent(`/${segments[0] ?? ''}`)
  const path = `/api/doc-assets/${encodeURIComponent(doc.project)}/${encoded.join('/')}`
  return doc.host ? `${path}?${new URLSearchParams({ host: doc.host })}` : path
}

/**
 * URL of a resource named by a payload. `target` is either relative to the
 * containing document or absolute; an absolute path keeps its leading `/` in
 * encoded form so the route can tell the two apart.
 */
export function docAssetUrl(doc: ComponentDocumentRef, target: string): string {
  if (target.startsWith('/')) {
    return assetRouteUrl(doc, resolveSegments([], target), true)
  }
  const slash = doc.path.lastIndexOf('/')
  const directory = slash === -1 ? [] : doc.path.slice(0, slash).split('/').filter(Boolean)
  return assetRouteUrl(doc, resolveSegments(directory, target), false)
}

/** URL of one executable block's cache file beside its document. */
export function cacheFileUrl(doc: ComponentDocumentRef, id: string): string {
  return assetRouteUrl(
    doc,
    resolveSegments([], `${componentAssetsDir(doc.path)}/${id}.json`),
    false,
  )
}
