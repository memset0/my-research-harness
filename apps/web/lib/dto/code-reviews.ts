// Response DTOs: Code-review listings, detail, progress patches and code previews (`/api/code-
// reviews/**`, `/api/code-preview`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { CodeReviewCompletion, CodeReviewFrontMatter, CodeReviewSummary } from '@memon/core'

export interface FullCodeReview {
  id: string
  scope: 'project' | 'experiment'
  experiment: string | null
  frontmatter: CodeReviewFrontMatter
  body: string
  mtime: number
  hash: string
  completion: CodeReviewCompletion
}

export type CodeReviewProgressPatch =
  | { op: 'commit'; sha: string; reviewed: boolean; expectedMtime: number; expectedHash: string }
  | { op: 'todo'; index: number; done: boolean; expectedMtime: number; expectedHash: string }

export interface CodeReviewsResponse {
  codeReviews: CodeReviewListItem[]
}

export type CodeReviewListItem = Omit<CodeReviewSummary, 'path'> & {
  path?: string
  resource?: string
}

export interface CodePreviewLine {
  n: number
  text: string
  target: boolean
}

export interface CodePreview {
  owner: string
  repo: string
  sha: string
  path: string
  startLine: number
  endLine: number
  lines: CodePreviewLine[]
  truncated: boolean
  // Set when the link resolved but the bytes couldn't be previewed
  // (e.g. the file is too large or binary). `lines` is empty in that case.
  reason?: 'too-large' | 'binary'
}

export interface CodeReviewPatchResponse {
  ok: true
  mtime: number
  hash: string
  completion: CodeReviewCompletion
}
