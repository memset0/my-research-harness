// Shared fixtures for the experiment-results unit tests.

import type { ResultsDocument, ResultVariant } from '@memon/core'

export function variant(id: string, overrides: Partial<ResultVariant> = {}): ResultVariant {
  return {
    id,
    name: `Variant ${id}`,
    status: 'COMPLETED',
    parameters: {},
    metrics: {},
    runs: [],
    attempts: [],
    ...overrides,
  }
}

export function resultsDocument(variants: ResultVariant[]): ResultsDocument {
  return {
    schemaVersion: 1,
    columns: [
      { key: 'lr', label: 'Learning rate', group: 'parameter', type: 'number' },
      { key: 'opt', label: 'Optimizer', group: 'parameter', type: 'string' },
      { key: 'flag', label: 'Flag', group: 'parameter', type: 'boolean' },
      { key: 'loss', label: 'Final loss', group: 'metric', type: 'number' },
      { key: 'notes', label: 'Notes', group: 'metric', type: 'string' },
    ],
    variants,
  }
}
