// Document-scoped share authorization.
//
// A viewer whose grant for a Project names one Experiment, Wiki page or
// Report may read only that document: its page, its detail/backlink/asset
// reads and, for an Experiment, its README, results, documents and the Runs
// and logs under its own run directory. `documentTargetFor` maps a read
// request to the document it addresses (or null — fail closed), and
// `grantCovers` decides whether a grant reaches that target. Run IDs carry no
// path, so they are resolved by the caller before `grantCovers` is asked.

import type { ShareDocumentGrant } from './identity'

export type DocumentTarget =
  /** One document by identity (Experiment IDs are full `E<NNNN>-<slug>`). */
  | { kind: 'experiment' | 'wiki' | 'report'; id: string }
  /** Backlinks of a document ID of any kind. */
  | { kind: 'backlinks'; id: string }
  /** A project-relative file or directory path. */
  | { kind: 'path'; path: string }
  /** A Run by ID; resolve it to its `path` before checking coverage. */
  | { kind: 'run'; id: string }

const PAGE = /^(?:\/h\/[^/]+)?\/p\/[^/]+\/(wiki|reports|e)\/([^/?]+)\/?$/
const PAGE_KIND = { wiki: 'wiki', reports: 'report', e: 'experiment' } as const

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** A clean project-relative path, or null for anything that could escape or alias. */
export function cleanProjectPath(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null
  if (value.startsWith('/') || /[\\\0]/.test(value)) return null
  const parts = value.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return value
}

function segments(pathname: string, prefix: string): string[] | null {
  if (!pathname.startsWith(prefix)) return null
  const parts = pathname.slice(prefix.length).split('/')
  const out: string[] = []
  for (const part of parts) {
    const value = decoded(part)
    if (value === null) return null
    out.push(value)
  }
  return out
}

/** The document a read request addresses, or null when it addresses none. */
export function documentTargetFor(
  method: string,
  pathname: string,
  search: URLSearchParams,
): DocumentTarget | null {
  if (method !== 'GET' && method !== 'HEAD') return null
  const page = PAGE.exec(pathname)
  if (page) {
    const id = decoded(page[2]!)
    return id ? { kind: PAGE_KIND[page[1] as keyof typeof PAGE_KIND], id } : null
  }
  const wikiBacklinks = segments(pathname, '/api/wiki/backlinks/')
  if (wikiBacklinks)
    return wikiBacklinks.length === 1 ? { kind: 'backlinks', id: wikiBacklinks[0]! } : null
  for (const [prefix, kind] of [
    ['/api/wiki-assets/', 'wiki'],
    ['/api/report-assets/', 'report'],
  ] as const) {
    const parts = segments(pathname, prefix)
    if (parts) return parts.length >= 3 ? { kind, id: parts[1]! } : null
  }
  const docAsset = segments(pathname, '/api/doc-assets/')
  if (docAsset) {
    const path = cleanProjectPath(docAsset.slice(1).join('/'))
    return path ? { kind: 'path', path } : null
  }
  for (const [prefix, kind] of [
    ['/api/wiki/', 'wiki'],
    ['/api/reports/', 'report'],
  ] as const) {
    const parts = segments(pathname, prefix)
    if (parts) return parts.length === 1 ? { kind, id: parts[0]! } : null
  }
  const experiment = segments(pathname, '/api/experiments/')
  if (experiment) {
    const [id, sub, ...rest] = experiment
    if (
      !id ||
      rest.length ||
      (sub !== undefined && !['readme', 'results', 'research'].includes(sub))
    )
      return null
    return { kind: 'experiment', id }
  }
  const run = segments(pathname, '/api/runs/')
  if (run) {
    const [id, sub, ...rest] = run
    if (!id || rest.length || (sub !== undefined && sub !== 'files')) return null
    return { kind: 'run', id }
  }
  if (
    pathname === '/api/readme' ||
    pathname === '/api/log' ||
    pathname === '/api/log-files' ||
    pathname === '/api/log/stream'
  ) {
    const values = [
      search.getAll('resource'),
      search.getAll('path'),
      search.getAll('expPath'),
    ].flat()
    if (values.length !== 1) return null
    const path = cleanProjectPath(values[0])
    return path ? { kind: 'path', path } : null
  }
  return null
}

function ownsPath(grant: ShareDocumentGrant, path: string): boolean {
  if (grant.kind === 'experiment') {
    return (
      path === `docs/experiments/${grant.id}` ||
      path.startsWith(`docs/experiments/${grant.id}/`) ||
      path === `docs/experiments/${grant.id}.md` ||
      path === `logs/${grant.id.slice(0, 5)}` ||
      path.startsWith(`logs/${grant.id.slice(0, 5)}/`)
    )
  }
  const pattern =
    grant.kind === 'wiki'
      ? new RegExp(`^docs/wiki/[^/]+/${grant.id}-[^/]+(?:/|\\.md$)`)
      : new RegExp(`^docs/reports/(?:[^/]+/)?${grant.id}-[^/]+(?:/|\\.md$)`)
  return pattern.test(path)
}

/** Whether a document grant reaches a resolved target (Runs resolved to `path`). */
export function grantCovers(grant: ShareDocumentGrant, target: DocumentTarget): boolean {
  switch (target.kind) {
    case 'backlinks':
      return target.id === grant.id
    case 'path':
      return ownsPath(grant, target.path)
    case 'run':
      return false
    default:
      return target.kind === grant.kind && target.id === grant.id
  }
}
