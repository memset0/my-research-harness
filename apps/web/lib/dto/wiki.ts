// Response DTOs: Wiki listings, pages, review log and backlinks (`/api/wiki/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { WikiBacklink, WikiPage, WikiSummary } from '@memon/core'

/**
 * Standalone serves the core projection (with its project-relative `path`)
 * plus the `project` / `resource` pair; a Host-scoped Backend response omits
 * `path` and carries `resource` only. Read the location as
 * `page.resource ?? page.path`.
 */
export type WikiListItem = Omit<WikiSummary, 'path'> & {
  project: string
  path?: string
  resource?: string
}

export type WikiPageDetail = Omit<WikiPage, 'path'> & {
  project: string
  path?: string
  resource?: string
}

export interface WikiPagesResponse {
  pages: WikiListItem[]
}

export interface WikiPutResponse {
  ok: true
  mtime: number
  hash: string
  page: WikiPageDetail
  /** Content as written — the editor re-baselines its buffer from this. */
  finalContent: string
}

export interface WikiReviewCommit {
  sha: string
  authoredAt: string
  subject: string
  /** Page ids the commit touched. */
  pages: string[]
  verified: boolean
  verifiedAt: string | null
  note: string | null
}

export interface WikiReviewResponse {
  /** Newest sequentially verified wiki commit, or null when none is marked. */
  verifiedThrough: string | null
  /** Wiki commits, oldest first. */
  commits: WikiReviewCommit[]
}

export interface WikiBacklinksResponse {
  artifact: string
  pages: WikiBacklink[]
}
