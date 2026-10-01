// Response DTOs: Hypotheses and journal bodies (`/api/hypotheses`, `/api/journal/**`).
// Shared by the route handlers that build these bodies and the client
// fetchers in `lib/api.ts`. Types and pure helpers only — no server imports.

import type { JournalEvent, ParsedHypotheses, ParsedJournal } from '@memon/core'

/** Named response contracts for content-bearing project collections. */
export type HypothesesResponse = { path?: string } & ParsedHypotheses

export interface JournalCountResponse {
  totalEvents: number
}

export interface JournalInvocationRecordView {
  version: number
  id: string
  startedAt: string
  finishedAt: string | null
  command: string
  origin: 'cli' | 'web'
  parameters: Record<string, unknown>
  outcome: 'running' | 'success' | 'failure' | 'conflict' | 'noop' | 'partial'
  errorCode?: string
  details?: Array<Record<string, unknown>>
}

export interface JournalHistoryResponse {
  project: string
  legacy: {
    present: boolean
    events: JournalEvent[]
    parseErrors: ParsedJournal['parseErrors']
    parseWarnings: ParsedJournal['parseWarnings']
  }
  invocations: JournalInvocationRecordView[]
  unreadableReceipts: Array<{ file: string; reason: string }>
}
