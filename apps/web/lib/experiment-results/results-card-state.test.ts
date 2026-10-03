// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { ResultsSummaryPayload } from '../dto/experiments'
import { resultsDocument, variant } from './fixtures.test-helpers'
import {
  displayedUpdatedAt,
  initialResultsCardState,
  resultsCardReducer,
} from './results-card-state'

const OK: ResultsSummaryPayload = resultsDocument([variant('V1')])
const failed = (code: string, extra: Record<string, unknown> = {}): ResultsSummaryPayload => ({
  ...resultsDocument([]),
  columns: [],
  outcome: 'failed',
  error: {
    code: code as never,
    message: `${code} message`,
    files: [{ file: 'logs/a-261001-000000/result.csv', version: 1 }],
    ...extra,
  },
})

describe('Results card state', () => {
  it('renders the first summary from the detail response without a request', () => {
    const state = initialResultsCardState(OK, '2026-10-01T00:00:00+08:00')
    expect(state.good?.summary).toBe(OK)
    expect(displayedUpdatedAt(state)).toBe('2026-10-01T00:00:00+08:00')
    expect(
      initialResultsCardState(failed('RESULT_SCHEMA_MISMATCH'), null).blocking?.error.code,
    ).toBe('RESULT_SCHEMA_MISMATCH')
    // First load of an invalid description file: the error itself is shown.
    expect(initialResultsCardState(failed('INVALID_RESULTS'), null).blocking?.error.code).toBe(
      'INVALID_RESULTS',
    )
  })

  it('replaces the table on a schema mismatch or duplicate row and recovers on ok', () => {
    let state = initialResultsCardState(OK, 't0')
    state = resultsCardReducer(state, { type: 'refresh-start' })
    expect(state.pending).toBe(true)
    state = resultsCardReducer(state, {
      type: 'refresh-done',
      outcome: {
        ok: false,
        status: 422,
        message: 'mismatch',
        body: {
          error: { code: 'RESULT_SCHEMA_MISMATCH', message: 'mismatch' },
          files: [{ file: 'logs/a-261001-000000/result.csv', version: 1 }],
          upgradeCommand: 'memon experiment schema upgrade E0001-a --to 2',
          diagnostics: [],
          updatedAt: 't1',
        },
      },
    })
    expect(state.pending).toBe(false)
    expect(state.blocking?.error.upgradeCommand).toBe(
      'memon experiment schema upgrade E0001-a --to 2',
    )
    expect(displayedUpdatedAt(state)).toBe('t1')
    state = resultsCardReducer(state, {
      type: 'summary',
      summary: failed('RESULT_DUPLICATE_ROW'),
      updatedAt: 't2',
    })
    expect(state.blocking?.error.code).toBe('RESULT_DUPLICATE_ROW')
    state = resultsCardReducer(state, {
      type: 'refresh-done',
      outcome: { ok: true, summary: OK, updatedAt: 't3' },
    })
    expect(state.blocking).toBeNull()
    expect(state.good?.updatedAt).toBe('t3')
  })

  it('keeps the last good table and its time on an invalid description file or a failed request', () => {
    let state = initialResultsCardState(OK, 't0')
    state = resultsCardReducer(state, {
      type: 'refresh-done',
      outcome: {
        ok: false,
        status: 400,
        message: 'bad json',
        body: {
          error: { code: 'INVALID_RESULTS', message: 'bad json' },
          files: [],
          diagnostics: [],
          updatedAt: 't1',
        },
      },
    })
    expect(state.good?.summary).toBe(OK)
    expect(state.blocking).toBeNull()
    expect(state.localError).toMatch(/^INVALID_RESULTS: bad json/)
    expect(displayedUpdatedAt(state)).toBe('t0')
    state = resultsCardReducer(state, {
      type: 'refresh-done',
      outcome: { ok: false, status: 0, body: null, message: 'network down' },
    })
    expect(state.localError).toBe('network down')
    expect(state.good?.summary).toBe(OK)
    state = resultsCardReducer(state, { type: 'summary', summary: OK, updatedAt: 't0' })
    expect(state.localError).toBeNull()
  })
})
