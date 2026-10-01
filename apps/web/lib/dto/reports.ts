// Response DTOs: Report listings and detail (`/api/reports/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { ReportSummary } from '@memon/core'

export interface FullReport {
  id: string
  slug: string
  /** Standalone-only absolute path; central Backend responses deliberately omit it. */
  path?: string
  resource?: string
  mtime: number
  hash: string
  content: string
  format: 'markdown' | 'bundle'
}

export interface ReportListItem extends Omit<ReportSummary, 'path'> {
  /** Standalone-only absolute path; never crosses the Backend boundary. */
  path?: string
  resource?: string
  format: 'markdown' | 'bundle'
}

export interface ReportsResponse {
  reports: ReportListItem[]
}
