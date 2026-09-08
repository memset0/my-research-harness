// lintRun is format/schema/structure only: it flags malformed documents and
// stays silent about research judgement (deprecation, staleness, missing
// narrative content).

import { describe, expect, it } from 'vitest'

import type { Run } from '../types.js'
import { lintRun } from './lint.js'
import { parseReadme } from './parse.js'

function run(content: string, id = 'foo-260901-100000'): Run {
  const parsed = parseReadme(content)
  return {
    id,
    project: 'p',
    path: `/tmp/logs/${id}`,
    mtime: 0,
    readmeMtime: 1,
    hasReadme: true,
    frontMatter: parsed.frontMatter,
    sections: parsed.sections,
    warnings: parsed.warnings,
    warningsRaw: parsed.warningsRaw,
    body: parsed.body,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
    frontMatterKeys: parsed.frontMatterKeys,
  }
}

const MINIMAL = `---
id: foo-260901-100000
status: FINISHED
created_at: '2026-09-01T10:00:00+08:00'
---

## Execution notes
Actual deviation from the Variant.

## Conclusion
Legacy prose remains readable without relocation advice.
`

describe('lintRun', () => {
  it('passes a minimal record with a free-form body', () => {
    expect(lintRun(run(MINIMAL))).toEqual([])
  })

  it('passes a deprecated run — deprecation is not a defect', () => {
    const diagnostics = lintRun(run(MINIMAL.replace('status:', 'deprecated: true\nstatus:')))
    expect(diagnostics).toEqual([])
  })

  it('flags an id that disagrees with the directory name', () => {
    const diagnostics = lintRun(run(MINIMAL, 'other-260901-100000'))
    expect(diagnostics.map((d) => d.code)).toContain('RUN_ID_MISMATCH')
  })

  it('flags a malformed experiment reference and timestamp', () => {
    const diagnostics = lintRun(
      run(
        MINIMAL.replace(
          "created_at: '2026-09-01T10:00:00+08:00'",
          "experiment: E1-foo\ncreated_at: '2026-09-01 10:00'",
        ),
      ),
    )
    const codes = diagnostics.map((d) => d.code)
    expect(codes).toContain('RUN_EXPERIMENT_REF_MALFORMED')
    expect(codes).toContain('RUN_TIMESTAMP_MALFORMED')
  })

  it('reports a wrong-typed flag as schema breakage', () => {
    const diagnostics = lintRun(run(MINIMAL.replace('status:', 'deprecated: yesterday\nstatus:')))
    expect(diagnostics.some((d) => d.field === 'deprecated' && d.severity === 'error')).toBe(true)
  })

  it('says nothing about a stale RUNNING run', () => {
    expect(lintRun(run(MINIMAL.replace('FINISHED', 'RUNNING')))).toEqual([])
  })
})
