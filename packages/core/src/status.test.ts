import { describe, expect, it } from 'vitest'
import { normalizeExperimentStatus, normalizeStatus } from './status.js'

describe('normalizeStatus', () => {
  it('passes valid uppercase enum through with no issue', () => {
    expect(normalizeStatus('RUNNING')).toEqual({ value: 'RUNNING', issue: null })
    expect(normalizeStatus('PENDING')).toEqual({ value: 'PENDING', issue: null })
    expect(normalizeStatus('FINISHED')).toEqual({ value: 'FINISHED', issue: null })
    expect(normalizeStatus('INTERRUPTED')).toEqual({ value: 'INTERRUPTED', issue: null })
    expect(normalizeStatus('FAILED')).toEqual({ value: 'FAILED', issue: null })
    expect(normalizeStatus('UNKNOWN')).toEqual({ value: 'UNKNOWN', issue: null })
  })

  it('warns and uppercases lowercase status', () => {
    const r = normalizeStatus('running')
    expect(r.value).toBe('RUNNING')
    expect(r.issue).toMatchObject({ severity: 'warning', field: 'status' })
  })

  it('warns and uppercases lowercase interrupted', () => {
    const r = normalizeStatus('interrupted')
    expect(r.value).toBe('INTERRUPTED')
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

describe('normalizeExperimentStatus', () => {
  it('passes valid uppercase enum through with no issue', () => {
    expect(normalizeExperimentStatus('OPEN')).toEqual({ value: 'OPEN', issue: null })
    expect(normalizeExperimentStatus('RESOLVED')).toEqual({ value: 'RESOLVED', issue: null })
    expect(normalizeExperimentStatus('ABANDONED')).toEqual({ value: 'ABANDONED', issue: null })
  })

  it('warns and uppercases lowercase status', () => {
    const r = normalizeExperimentStatus('open')
    expect(r.value).toBe('OPEN')
    expect(r.issue).toMatchObject({ severity: 'warning', field: 'status' })
    const r2 = normalizeExperimentStatus('resolved')
    expect(r2.value).toBe('RESOLVED')
    expect(r2.issue).toMatchObject({ severity: 'warning', field: 'status' })
  })

  it('errors and falls back to OPEN for unknown values', () => {
    const r = normalizeExperimentStatus('closed')
    expect(r.value).toBe('OPEN')
    expect(r.issue).toMatchObject({ severity: 'error', field: 'status' })
  })

  it('errors for non-string input but falls back to OPEN', () => {
    const r = normalizeExperimentStatus(null)
    expect(r.value).toBe('OPEN')
    expect(r.issue?.severity).toBe('error')
  })

  it('trims whitespace before checking', () => {
    expect(normalizeExperimentStatus('  OPEN ').value).toBe('OPEN')
  })
})
