// Response DTOs: Run listings, Run detail, Run file trees and Run status/archive patches
// (`/api/runs/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { Run, WarningRecord } from '@memon/core'

export interface IndexedRun
  extends Pick<
    Run,
    | 'id'
    | 'project'
    | 'mtime'
    | 'readmeMtime'
    | 'hasReadme'
    | 'frontMatter'
    | 'parseErrors'
    | 'parseWarnings'
  > {
  /** Standalone-only absolute directory; central uses portable resource. */
  path?: string
  resource?: string
  stale: boolean
}

export interface FullExperiment
  extends Pick<
    Run,
    | 'id'
    | 'project'
    | 'mtime'
    | 'readmeMtime'
    | 'hasReadme'
    | 'frontMatter'
    | 'sections'
    | 'body'
    | 'parseErrors'
    | 'parseWarnings'
  > {
  /** Standalone-only absolute directory; central uses portable resource. */
  path?: string
  resource?: string
  stale: boolean
  resources: null
  warnings: WarningRecord[]
  warningsRaw: string | null
}

export interface RunFileTreeNode {
  type: 'file' | 'dir'
  resource: string
  size?: number
  mtime?: number
  children?: RunFileTreeNode[]
}

export interface PatchStatusResponse {
  mtime: number
  prevStatus?: string
  nextStatus?: string
  unchanged?: boolean
  /** v4: present when the on-disk pre-write archived was true. */
  warning?: 'archived'
}

export interface PatchStatusForbidden {
  error: { code: 'ARCHIVE_RUNNING_FORBIDDEN'; message: string; id?: string }
}

export interface PatchArchiveResponse {
  ok: true
  archived: boolean
  mtime: number
  noop?: boolean
}

export interface PatchArchiveForbidden {
  error: { code: 'ARCHIVE_RUNNING_FORBIDDEN'; message: string; id?: string }
}
