import { describe, expect, it } from 'vitest'
import { normalizeStatus } from './status.js'

describe('normalizeStatus', () => {
  it('passes valid uppercase enum through with no issue', () => {
    expect(normalizeStatus('RUNNING')).toEqual({ value: 'RUNNING', issue: null })
    expect(normalizeStatus('PENDING')).toEqual({ value: 'PENDING', issue: null })
    expect(normalizeStatus('FINISHED')).toEqual({ value: 'FINISHED', issue: null })
    expect(normalizeStatus('FAILED')).toEqual({ value: 'FAILED', issue: null })
    expect(normalizeStatus('UNKNOWN')).toEqual({ value: 'UNKNOWN', issue: null })
  })

  it('warns and uppercases lowercase status', () => {
    const r = normalizeStatus('running')
    expect(r.value).toBe('RUNNING')
    expect(r.issue).toMatchObject({ severity: 'warning', field: 'status' })
  })

  it('errors and falls back to UNKNOWN for unknown values', () => {
    const r = normalizeStatus('completed')
    expect(r.value).toBe('UNKNOWN')
    expect(r.issue).toMatchObject({ severity: 'error', field: 'status' })
  })

  it('errors for non-string input', () => {
    const r = normalizeStatus(42)
    expect(r.value).toBe('UNKNOWN')
    expect(r.issue?.severity).toBe('error')
  })

  it('trims whitespace before checking', () => {
    expect(normalizeStatus('  RUNNING ').value).toBe('RUNNING')
  })
})
