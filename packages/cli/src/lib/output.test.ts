import type { Run } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { formatExperimentTable } from './output.js'

function makeExp(overrides: Partial<Run['frontMatter']> = {}): Run {
  return {
    id: 'foo-260501-100000',
    project: 'p',
    path: '/x',
    mtime: 0,
    readmeMtime: 0,
    hasReadme: true,
    frontMatter: {
      id: 'foo-260501-100000',
      name: 'foo',
      project: 'p',
      status: 'RUNNING',
      createdAt: '2026-05-01T10:00:00+08:00',
      experiment: null,
      updatedAt: '2026-05-01T10:00:00+08:00',
      finishedAt: null,
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      wandb: null,
      hypotheses: ['H0001'],
      tags: ['t'],
      archived: false,
      deprecated: false,
      ...overrides,
    },
    frontMatterKeys: [],
    sections: {
      motivation: null,
      setup: null,
      method: null,
      result: null,
      conclusion: null,
      caveats: null,
      artifacts: [],
      newHypotheses: null,
    },
    warnings: [],
    warningsRaw: null,
    body: '',
    parseErrors: [],
    parseWarnings: [],
  }
}

describe('formatExperimentTable', () => {
  it('renders empty state', () => {
    expect(formatExperimentTable([])).toBe('(no experiments)')
  })
  it('renders header + row with status emoji', () => {
    const out = formatExperimentTable([makeExp()])
    expect(out).toContain('STATUS')
    expect(out).not.toContain('HYPOTHESES')
    expect(out).not.toContain('H0001')
    expect(out).toContain('🟢')
    expect(out).toContain('foo-260501-100000')
  })
})
