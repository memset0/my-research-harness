// Response DTOs: Run/Experiment Warnings table bodies (`/api/{runs,experiments}/:id/warnings/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { WarningRecord } from '@memon/core'

export interface WarningsListResponse {
  ok: true
  warnings: WarningRecord[]
  mtime: number
  hash: string
}

export interface WarningsOpResponse {
  ok: true
  rowId?: string
  warnings: WarningRecord[]
  mtime: number
  hash: string
}

export interface WarningsConflict {
  error: { code: 'CONFLICT' | 'WARNINGS_SECTION_NOT_TABLE'; message: string }
  mtime?: number
  hash?: string
  content?: string
}
