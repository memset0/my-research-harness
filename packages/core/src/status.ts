// Status enum normalization.
//
// Per spec experiment-readme:
//   - Lowercase status (e.g., 'running') is normalized to 'RUNNING' with a parse warning
//   - Unknown values (e.g., 'completed') normalize to 'UNKNOWN' with a parse error
//
// This module is the single source of truth for that conversion so all readers
// (CLI, web backend, agents) behave identically.

import type { ParseIssue, Status } from './types.js'
import { STATUS_VALUES } from './types.js'

export interface NormalizedStatus {
  value: Status
  issue: ParseIssue | null
}

const VALID_SET = new Set<string>(STATUS_VALUES)

export function normalizeStatus(input: unknown): NormalizedStatus {
  if (typeof input !== 'string') {
    return {
      value: 'UNKNOWN',
      issue: {
        field: 'status',
        message: `status must be a string; received ${typeof input}`,
        severity: 'error',
      },
    }
  }
  const trimmed = input.trim()
  if (VALID_SET.has(trimmed)) {
    return { value: trimmed as Status, issue: null }
  }
  const upper = trimmed.toUpperCase()
  if (VALID_SET.has(upper)) {
    return {
      value: upper as Status,
      issue: {
        field: 'status',
        message: `status "${trimmed}" was lowercased; canonical form is "${upper}"`,
        severity: 'warning',
      },
    }
  }
  return {
    value: 'UNKNOWN',
    issue: {
      field: 'status',
      message: `unknown status value "${trimmed}"; expected one of ${STATUS_VALUES.join(', ')}`,
      severity: 'error',
    },
  }
}
