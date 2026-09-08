import { describe, expect, it } from 'vitest'
import type { Run } from '../types.js'
import { isStaleRunning, staleAgeMs } from './stale.js'

function makeExp(overrides: Partial<Run> = {}): Run {
  return {
    id: 'foo-260501-100000',
    project: 'p',
    path: '/tmp/foo',
    mtime: 0,
    readmeMtime: 0,
    hasReadme: true,
    frontMatter: {
      id: 'foo-260501-100000',
      name: 'foo',
      project: 'p',
      status: 'RUNNING',
      createdAt: '',
      experiment: null,
      updatedAt: '',
      finishedAt: null,
      host: null,
      pid: null,
      gpus: [],
      entry: '',
      command: '',
      wandb: null,
      hypotheses: [],
      tags: [],
      archived: false,
      deprecated: false,
    },
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
    frontMatterKeys: [],
    ...overrides,
  }
}

describe('isStaleRunning', () => {
  it('flags RUNNING with old mtime', () => {
    const exp = makeExp({ mtime: 0 }) // 1970
    expect(isStaleRunning(exp, { now: Date.now() })).toBe(true)
  })

  it('does not flag fresh RUNNING', () => {
    const now = Date.now()
    const exp = makeExp({ mtime: now - 1000 })
    expect(isStaleRunning(exp, { now, thresholdMs: 60_000 })).toBe(false)
  })

  it('returns false for non-RUNNING regardless of mtime', () => {
    const exp = makeExp({ mtime: 0 })
    exp.frontMatter.status = 'FINISHED'
    expect(isStaleRunning(exp, { now: Date.now() })).toBe(false)
  })

  it('staleAgeMs returns null when not stale', () => {
    const now = Date.now()
    const exp = makeExp({ mtime: now })
    expect(staleAgeMs(exp, { now })).toBeNull()
  })

  it('staleAgeMs returns elapsed when stale', () => {
    const now = 10_000_000
    const exp = makeExp({ mtime: now - 5000 })
    expect(staleAgeMs(exp, { now, thresholdMs: 1000 })).toBe(5000)
  })
})
