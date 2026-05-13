// Status enum normalization.
//
// Per spec experiment-readme:
//   - Lowercase status (e.g., 'running') is normalized to 'RUNNING' with a parse warning
//   - Unknown values (e.g., 'completed') normalize to 'UNKNOWN' (run side) or
//     'OPEN' (exp side) with a parse error
//
// This module is the single source of truth for that conversion so all readers
// (CLI, web backend, agents) behave identically.

import type { ExperimentStatus, ParseIssue, Status } from './types.js'
import { EXPERIMENT_STATUS_VALUES, STATUS_VALUES } from './types.js'

export interface NormalizedStatus {
  value: Status
  issue: ParseIssue | null
}

export interface NormalizedExperimentStatus {
  value: ExperimentStatus
  issue: ParseIssue | null
}

const VALID_SET = new Set<string>(STATUS_VALUES)
const EXP_VALID_SET = new Set<string>(EXPERIMENT_STATUS_VALUES)

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

export function normalizeExperimentStatus(input: unknown): NormalizedExperimentStatus {
  if (typeof input !== 'string') {
    return {
      value: 'OPEN',
      issue: {
        field: 'status',
        message: `experiment status must be a string; received ${typeof input}`,
        severity: 'error',
      },
    }
  }
  const trimmed = input.trim()
  if (EXP_VALID_SET.has(trimmed)) {
    return { value: trimmed as ExperimentStatus, issue: null }
  }
  const upper = trimmed.toUpperCase()
  if (EXP_VALID_SET.has(upper)) {
    return {
      value: upper as ExperimentStatus,
      issue: {
        field: 'status',
        message: `experiment status "${trimmed}" was lowercased; canonical form is "${upper}"`,
        severity: 'warning',
      },
    }
  }
  return {
    value: 'OPEN',
    issue: {
      field: 'status',
      message: `unknown experiment status value "${trimmed}"; expected one of ${EXPERIMENT_STATUS_VALUES.join(', ')}`,
      severity: 'error',
    },
  }
}
