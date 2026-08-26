/**
 * Pure helpers for recognizing current-project Experiment and Report
 * references. These helpers deliberately know nothing about React or the
 * Report workspace URL shape: callers resolve an identity here, then hand it
 * to the surface-aware navigation builder.
 */

import type { ArtifactNavigationTarget } from './report-workspace-url'

export type ArtifactKind = 'experiment' | 'report'

export interface ArtifactDocument {
  kind: ArtifactKind
  /** Full Experiment id (`E0001-slug`) or Report id (`R0001`). */
  id: string
  /** Absolute path of the artifact's canonical Markdown source. */
  path: string
}

export interface ArtifactInventory {
  project: string
  /** Null/absent for standalone; required to recognize a central canonical route. */
  host?: string | null
  experiments: ReadonlyArray<{ id: string; path: string }>
  reports: ReadonlyArray<{ id: string; path: string }>
}

export type ArtifactTarget = ArtifactNavigationTarget

export type ResolvedArtifactLink = ArtifactTarget & {
  path: string
  /** Retained for recognition/debugging; workspace fragment scrolling is deferred. */
  fragment: string
}

const REPORT_ID_RE = /^R\d{4}$/
const EXPERIMENT_SHORT_ID_RE = /^E\d{4}$/
const EXPERIMENT_ID_RE = /^E\d{4}-[a-z0-9][a-z0-9-]*$/
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

export function artifactDocuments(inventory: ArtifactInventory): ArtifactDocument[] {
  return [
    ...inventory.experiments.map((item) => ({ kind: 'experiment' as const, ...item })),
    ...inventory.reports.map((item) => ({ kind: 'report' as const, ...item })),
  ]
}

/** Resolve a bare canonical Report id, short Experiment id, or full Experiment id. */
export function resolveBareArtifactReference(
  reference: string,
  inventory: ArtifactInventory,
): ArtifactTarget | null {
  if (REPORT_ID_RE.test(reference)) {
    return uniqueIdentity(
      inventory.reports
        .filter((item) => item.id === reference)
        .map((item) => ({ kind: 'report' as const, id: item.id })),
    )
  }

  if (EXPERIMENT_SHORT_ID_RE.test(reference)) {
    return uniqueIdentity(
      inventory.experiments
        .filter((item) => item.id.startsWith(`${reference}-`))
        .map((item) => ({ kind: 'experiment' as const, id: item.id })),
    )
  }

  if (EXPERIMENT_ID_RE.test(reference)) {
    return uniqueIdentity(
      inventory.experiments
        .filter((item) => item.id === reference)
        .map((item) => ({ kind: 'experiment' as const, id: item.id })),
    )
  }

  return null
}

/**
 * Resolve an authored Markdown href to a discovered artifact document.
 *
 * Relative file paths use the source Markdown file (not the browser route) as
 * their base. Absolute local paths and canonical `/p/...` application routes
 * are also recognized. External, malformed, missing, cross-project, and
 * route-ambiguous references return null so the ordinary anchor renderer can
 * retain its existing behavior.
 */
export function resolveArtifactMarkdownHref(
  href: string,
  sourceDocumentPath: string,
  inventory: ArtifactInventory,
): ResolvedArtifactLink | null {
  if (
    href.length === 0 ||
    href.startsWith('#') ||
    href.startsWith('?') ||
    href.startsWith('//') ||
    SCHEME_RE.test(href)
  ) {
    return null
  }

  const split = splitHref(href)
  if (!split || split.path.length === 0) return null

  const routeTarget = resolveCanonicalArtifactRoute(split.path, inventory)
  if (routeTarget) return { ...routeTarget, path: '', fragment: split.fragment }

  const sourcePath = normalizeInventoryPath(sourceDocumentPath)
  if (!sourcePath) return null

  const decodedHrefPath = decodeHrefPath(split.path)
  if (!decodedHrefPath) return null
  const sourceAbsolute = sourcePath.startsWith('/')
  const sourceSegments = sourcePath.split('/').filter(Boolean)
  const candidate = decodedHrefPath.absolute
    ? normalizePathSegments(decodedHrefPath.segments, true)
    : normalizePathSegments(
        [...sourceSegments.slice(0, -1), ...decodedHrefPath.segments],
        sourceAbsolute,
      )
  if (!candidate) return null

  const documents = artifactDocuments(inventory)
  const pathMatches = documents.filter(
    (document) => normalizeInventoryPath(document.path) === candidate,
  )
  if (pathMatches.length !== 1) return null
  const match = pathMatches[0]!

  // A canonical route addresses only kind + id. If a malformed migration
  // exposes the same identity at two source paths, following either path
  // would silently choose a different document downstream.
  if (documents.filter((document) => sameIdentity(document, match)).length !== 1) return null
  return { kind: match.kind, id: match.id, path: match.path, fragment: split.fragment }
}

function resolveCanonicalArtifactRoute(
  rawPath: string,
  inventory: ArtifactInventory,
): ArtifactTarget | null {
  if (!rawPath.startsWith('/')) return null
  const decoded = decodeHrefPath(rawPath)
  if (!decoded) return null
  const segments = decoded.segments.slice()
  if (segments.at(-1) === '') segments.pop()
  let collection: string | undefined
  let id: string | undefined
  if (
    !inventory.host &&
    segments.length === 4 &&
    segments[0] === 'p' &&
    segments[1] === inventory.project
  ) {
    collection = segments[2]
    id = segments[3]
  } else if (
    inventory.host &&
    segments.length === 6 &&
    segments[0] === 'h' &&
    segments[1] === inventory.host &&
    segments[2] === 'p' &&
    segments[3] === inventory.project
  ) {
    collection = segments[4]
    id = segments[5]
  } else {
    return null
  }
  if (collection === 'reports' && id && REPORT_ID_RE.test(id)) {
    return resolveBareArtifactReference(id, inventory)
  }
  if (collection === 'e' && id && EXPERIMENT_ID_RE.test(id)) {
    return resolveBareArtifactReference(id, inventory)
  }
  return null
}

function splitHref(href: string): { path: string; fragment: string } | null {
  const hashAt = href.indexOf('#')
  const fragment = hashAt >= 0 ? href.slice(hashAt) : ''
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const queryAt = beforeHash.indexOf('?')
  return {
    path: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash,
    fragment,
  }
}

function decodeHrefPath(rawPath: string): { absolute: boolean; segments: string[] } | null {
  const absolute = rawPath.startsWith('/')
  const rawSegments = rawPath.split('/')
  if (absolute) rawSegments.shift()
  const segments: string[] = []
  for (const raw of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) return null
    segments.push(decoded)
  }
  return { absolute, segments }
}

function normalizeInventoryPath(path: string): string | null {
  if (!path || path.includes('\\') || path.includes('\0')) return null
  const absolute = path.startsWith('/')
  return normalizePathSegments(path.split('/').slice(absolute ? 1 : 0), absolute)
}

function normalizePathSegments(segments: string[], absolute: boolean): string | null {
  const normalized: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (normalized.length === 0) return null
      normalized.pop()
      continue
    }
    normalized.push(segment)
  }
  return `${absolute ? '/' : ''}${normalized.join('/')}`
}

function sameIdentity(a: ArtifactTarget, b: ArtifactTarget): boolean {
  return a.kind === b.kind && a.id === b.id
}

function uniqueIdentity<T extends ArtifactTarget>(matches: T[]): T | null {
  if (matches.length !== 1) return null
  const match = matches[0]!
  return matches.every((candidate) => sameIdentity(candidate, match)) ? match : null
}
