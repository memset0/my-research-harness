// What the Results card shows, from the Experiment detail and from explicit
// Refreshes of the Results snapshot (web-dashboard "Results can refresh
// independently" and "Results show a blocking error for inconsistent
// inputs"):
//
// - an ok summary replaces the displayed table and its input time;
// - RESULT_SCHEMA_MISMATCH / RESULT_DUPLICATE_ROW replace the table with the
//   blocking error (no Variant row);
// - an invalid or missing description file keeps the last good table and its
//   time with a local error — unless no good table is displayed yet, in which
//   case the error itself is shown;
// - a failed request (authorization, network, server) keeps everything and
//   shows a local error with Refresh still available.

import type {
  ResultsErrorResponsePayload,
  ResultsSummaryErrorPayload,
  ResultsSummaryPayload,
} from '../dto/experiments'

export interface ResultsCardState {
  /** The displayed ok summary, when a table is shown. */
  good: { summary: ResultsSummaryPayload; updatedAt: string | null } | null
  /** The blocking error that replaces the table. */
  blocking: { error: ResultsSummaryErrorPayload; updatedAt: string | null } | null
  /** A non-blocking problem of the last update (the previous content stays). */
  localError: string | null
  pending: boolean
}

export type ResultsSnapshotOutcome =
  | { ok: true; summary: ResultsSummaryPayload; updatedAt: string | null }
  | { ok: false; status: number; body: ResultsErrorResponsePayload | null; message: string }

export type ResultsCardAction =
  | { type: 'summary'; summary: ResultsSummaryPayload | null; updatedAt: string | null }
  | { type: 'refresh-start' }
  | { type: 'refresh-done'; outcome: ResultsSnapshotOutcome }

const BLOCKING: ReadonlySet<string> = new Set(['RESULT_SCHEMA_MISMATCH', 'RESULT_DUPLICATE_ROW'])

export function initialResultsCardState(
  summary: ResultsSummaryPayload | null,
  updatedAt: string | null,
): ResultsCardState {
  return applySummary(
    { good: null, blocking: null, localError: null, pending: false },
    summary,
    updatedAt,
  )
}

function applyError(
  state: ResultsCardState,
  error: ResultsSummaryErrorPayload,
  updatedAt: string | null,
): ResultsCardState {
  // A schema mismatch or duplicate row always replaces the table.
  if (BLOCKING.has(error.code)) {
    return { ...state, blocking: { error, updatedAt }, localError: null }
  }
  // An invalid or missing description file is shown only when nothing else
  // is (or when it replaces an earlier error of the same kind)...
  if (state.blocking === null ? state.good === null : !BLOCKING.has(state.blocking.error.code)) {
    return { ...state, blocking: { error, updatedAt }, localError: null }
  }
  // ...otherwise the displayed content stays, with a local error.
  return { ...state, localError: `${error.code}: ${error.message}` }
}

function applySummary(
  state: ResultsCardState,
  summary: ResultsSummaryPayload | null,
  updatedAt: string | null,
): ResultsCardState {
  if (summary === null) return state
  if (summary.outcome === 'ok') {
    return { ...state, good: { summary, updatedAt }, blocking: null, localError: null }
  }
  if (!summary.error) return state
  return applyError(state, summary.error, updatedAt)
}

export function resultsCardReducer(
  state: ResultsCardState,
  action: ResultsCardAction,
): ResultsCardState {
  switch (action.type) {
    case 'summary':
      return applySummary(state, action.summary, action.updatedAt)
    case 'refresh-start':
      return { ...state, pending: true }
    case 'refresh-done': {
      const settled = { ...state, pending: false }
      const { outcome } = action
      if (outcome.ok) return applySummary(settled, outcome.summary, outcome.updatedAt)
      if (outcome.body) {
        return applyError(
          settled,
          {
            code: outcome.body.error.code,
            message: outcome.body.error.message,
            files: outcome.body.files,
            ...(outcome.body.upgradeCommand ? { upgradeCommand: outcome.body.upgradeCommand } : {}),
            ...(outcome.body.expectedVersion
              ? { expectedVersion: outcome.body.expectedVersion }
              : {}),
            diagnostics: outcome.body.diagnostics,
          },
          outcome.body.updatedAt,
        )
      }
      return { ...settled, localError: outcome.message }
    }
  }
}

/** The input time the card displays (the shown table's or the shown error's). */
export function displayedUpdatedAt(state: ResultsCardState): string | null {
  if (state.blocking) return state.blocking.updatedAt
  return state.good?.updatedAt ?? null
}
