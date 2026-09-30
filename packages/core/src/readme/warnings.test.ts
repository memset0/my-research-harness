import { describe, expect, it } from 'vitest'
import {
  applyWarningOp,
  findWarningsSectionRange,
  generateRowId,
  parseWarningsBody,
  serializeWarningRow,
  WARNING_CATEGORIES,
  WarningOpError,
  type Warning,
} from './warnings.js'

const SAMPLE_README = `---
id: foo-260501-100000
name: foo
project: ''
status: RUNNING
created_at: '2026-05-01T10:00:00+08:00'
finished_at: null
host: null
pid: null
gpus: []
entry: ./run.sh
command: ./run.sh
wandb: null
hypotheses: []
tags: []
---

## Motivation

m

## Setup

s

## Method

x

## Result

r

## Conclusion

c

## Caveats

cav

## Artifacts

- \`./run.log\` — log
`

const SAMPLE_WARNING_OPEN: Warning = {
  rowId: 'w_2026-05-05T14-32-00+0800_a3f1',
  status: 'OPEN',
  created: '2026-05-05T14:32:00+08:00',
  run: null,
  category: 'result',
  message: 'loss spike at step 1500',
  resolved: null,
  note: null,
}

describe('parseWarningsBody', () => {
  it('returns empty array for blank body', () => {
    const r = parseWarningsBody('')
    expect(r.warnings).toEqual([])
    expect(r.raw).toBeNull()
    expect(r.parseWarnings).toEqual([])
  })

  it('parses a populated table', () => {
    const body = [
      '',
      '| Status | Created | Category | Message | Resolved | Note |',
      '|--------|---------|----------|---------|----------|------|',
      '| OPEN | 2026-05-05T14:32:00+08:00 | result | loss spike at step 1500 | — | — | <!-- id:w_a -->',
      '| RESOLVED | 2026-05-04T09:15:00+08:00 | config | bs=256 vs paper 512 | 2026-05-04T11:00:00+08:00 | intentional, A100 OOM at 512 | <!-- id:w_b -->',
    ].join('\n')
    const r = parseWarningsBody(body)
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings[0]!.rowId).toBe('w_a')
    expect(r.warnings[0]!.status).toBe('OPEN')
    expect(r.warnings[0]!.category).toBe('result')
    expect(r.warnings[0]!.note).toBeNull()
    expect(r.warnings[1]!.status).toBe('RESOLVED')
    expect(r.warnings[1]!.note).toBe('intentional, A100 OOM at 512')
    expect(r.parseWarnings).toEqual([])
  })

  it('preserves out-of-enum category with parse warning', () => {
    const body = [
      '| Status | Created | Category | Message | Resolved | Note |',
      '|--------|---------|----------|---------|----------|------|',
      '| OPEN | 2026-05-05T14:32:00+08:00 | aesthetic | foo | — | — | <!-- id:w_a -->',
    ].join('\n')
    const r = parseWarningsBody(body)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]!.category).toBe('aesthetic')
    expect(r.parseWarnings.some((p) => p.message.includes('UNKNOWN_WARNING_CATEGORY'))).toBe(true)
  })

  it('normalises lowercase status', () => {
    const body = [
      '| Status | Created | Category | Message | Resolved | Note |',
      '|--------|---------|----------|---------|----------|------|',
      '| open | 2026-05-05T14:32:00+08:00 | result | foo | — | — | <!-- id:w_a -->',
    ].join('\n')
    const r = parseWarningsBody(body)
    expect(r.warnings[0]!.status).toBe('OPEN')
    expect(r.parseWarnings.some((p) => p.message.includes('WARNING_STATUS_LOWERCASE'))).toBe(true)
  })

  it('flags non-table content as not-a-table', () => {
    const body = 'This is just prose, not a table.\n'
    const r = parseWarningsBody(body)
    expect(r.warnings).toEqual([])
    expect(r.raw).toBe(body)
    expect(r.parseWarnings.some((p) => p.message.includes('WARNINGS_SECTION_NOT_TABLE'))).toBe(true)
  })

  it('round-trips pipe-escaped messages', () => {
    const w: Warning = {
      ...SAMPLE_WARNING_OPEN,
      rowId: 'w_pipe',
      message: 'loss = a|b at step 1500',
    }
    const row = serializeWarningRow(w)
    expect(row).toContain('a\\|b')
    // Writer always emits the v3 7-col header; parser handles either shape.
    const body = `| Status | Created | Run | Category | Message | Resolved | Note |\n|--------|---------|-----|----------|---------|----------|------|\n${row}`
    const parsed = parseWarningsBody(body)
    expect(parsed.warnings[0]!.message).toBe('loss = a|b at step 1500')
  })

  it('round-trips <br>-encoded newlines', () => {
    const w: Warning = {
      ...SAMPLE_WARNING_OPEN,
      rowId: 'w_br',
      message: 'line one\nline two',
    }
    const row = serializeWarningRow(w)
    expect(row).toContain('line one<br>line two')
    const body = `| Status | Created | Run | Category | Message | Resolved | Note |\n|--------|---------|-----|----------|---------|----------|------|\n${row}`
    const parsed = parseWarningsBody(body)
    expect(parsed.warnings[0]!.message).toBe('line one\nline two')
  })

  it('parses a v3 7-col table with Run column populated and null', () => {
    const body = [
      '| Status | Created | Run | Category | Message | Resolved | Note |',
      '|--------|---------|-----|----------|---------|----------|------|',
      '| OPEN | 2026-05-05T14:32:00+08:00 | foo-260501-100000 | result | spike | — | — | <!-- id:w_a -->',
      '| RESOLVED | 2026-05-04T09:15:00+08:00 | — | config | drift | 2026-05-04T11:00:00+08:00 | done | <!-- id:w_b -->',
    ].join('\n')
    const r = parseWarningsBody(body)
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings[0]!.run).toBe('foo-260501-100000')
    expect(r.warnings[1]!.run).toBeNull()
    expect(r.parseWarnings).toEqual([])
  })

  it('legacy v2 6-col table back-compat: run defaults to null', () => {
    const body = [
      '| Status | Created | Category | Message | Resolved | Note |',
      '|--------|---------|----------|---------|----------|------|',
      '| OPEN | 2026-05-05T14:32:00+08:00 | result | foo | — | — | <!-- id:w_legacy -->',
    ].join('\n')
    const r = parseWarningsBody(body)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]!.run).toBeNull()
    expect(r.parseWarnings).toEqual([])
  })
})

describe('findWarningsSectionRange', () => {
  it('returns null when section absent', () => {
    expect(findWarningsSectionRange(SAMPLE_README.split('\n'))).toBeNull()
  })
  it('locates the section bounded by next H2', () => {
    const md = ['## Caveats', 'cav', '', '## Warnings', '', 'body', '## Artifacts', 'a'].join('\n')
    const range = findWarningsSectionRange(md.split('\n'))
    expect(range).not.toBeNull()
    const r = range!
    expect(r.headingLine).toBe(3)
    expect(r.bodyEnd).toBe(6)
  })
  it('respects code fences', () => {
    const md = ['```', '## Warnings', '```', '## Method', 'x'].join('\n')
    expect(findWarningsSectionRange(md.split('\n'))).toBeNull()
  })
})

describe('applyWarningOp', () => {
  it('adds a warning, inserting the section if missing', () => {
    const out = applyWarningOp(SAMPLE_README, {
      op: 'add',
      category: 'result',
      message: 'loss spike',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_xx',
    })
    expect(out.rowId).toBe('w_xx')
    expect(out.content).toContain('## Warnings')
    // Position: between Caveats and Artifacts
    const cav = out.content.indexOf('## Caveats')
    const warn = out.content.indexOf('## Warnings')
    const art = out.content.indexOf('## Artifacts')
    expect(cav).toBeLessThan(warn)
    expect(warn).toBeLessThan(art)
    // Other sections preserved
    expect(out.content).toContain('## Motivation')
    expect(out.content).toContain('- `./run.log` — log')
  })

  it('appends to an existing warnings section', () => {
    const r1 = applyWarningOp(SAMPLE_README, {
      op: 'add',
      category: 'result',
      message: 'first',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_a',
    })
    const r2 = applyWarningOp(r1.content, {
      op: 'add',
      category: 'config',
      message: 'second',
      created: '2026-05-05T14:33:00+08:00',
      rowId: 'w_b',
    })
    expect(r2.content.split('## Warnings').length).toBe(2)
    expect(r2.content).toContain('w_a')
    expect(r2.content).toContain('w_b')
  })

  it('resolve sets Resolved and Note', () => {
    const r1 = applyWarningOp(SAMPLE_README, {
      op: 'add',
      category: 'result',
      message: 'first',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_a',
    })
    const r2 = applyWarningOp(r1.content, {
      op: 'resolve',
      rowId: 'w_a',
      resolved: '2026-05-05T15:00:00+08:00',
      note: 'looked at it, fine',
    })
    expect(r2.content).toContain('| RESOLVED |')
    expect(r2.content).toContain('looked at it, fine')
    expect(r2.content).toContain('2026-05-05T15:00:00+08:00')
  })

  it('reopen clears Resolved + Note, keeps Created', () => {
    let c = applyWarningOp(SAMPLE_README, {
      op: 'add',
      category: 'result',
      message: 'first',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_a',
    }).content
    c = applyWarningOp(c, {
      op: 'resolve',
      rowId: 'w_a',
      resolved: '2026-05-05T15:00:00+08:00',
      note: 'fine',
    }).content
    const reopened = applyWarningOp(c, { op: 'reopen', rowId: 'w_a' })
    expect(reopened.content).toContain('| OPEN |')
    expect(reopened.content).not.toContain('fine')
    expect(reopened.content).toContain('2026-05-05T14:32:00+08:00')
  })

  it('delete removes the row', () => {
    const c1 = applyWarningOp(SAMPLE_README, {
      op: 'add',
      category: 'result',
      message: 'first',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_a',
    })
    const c2 = applyWarningOp(c1.content, {
      op: 'delete',
      rowId: 'w_a',
    })
    expect(c2.content).not.toContain('w_a')
    expect(c2.deleted!.rowId).toBe('w_a')
  })

  it('throws NOT_FOUND for unknown rowId on resolve', () => {
    expect(() =>
      applyWarningOp(SAMPLE_README, {
        op: 'resolve',
        rowId: 'w_nope',
        resolved: '2026-05-05T15:00:00+08:00',
        note: '',
      }),
    ).toThrow(WarningOpError)
  })

  it('preserves a non-canonical extra section like ## Discussion', () => {
    const md = SAMPLE_README.replace(
      '## Artifacts',
      '## Discussion\n\nUser-added prose here.\n\n## Artifacts',
    )
    const r = applyWarningOp(md, {
      op: 'add',
      category: 'result',
      message: 'first',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_a',
    })
    expect(r.content).toContain('## Discussion')
    expect(r.content).toContain('User-added prose here.')
  })

  it('insertion position falls back to before Artifacts when Caveats is missing', () => {
    const md = SAMPLE_README.replace(/## Caveats\n\ncav\n\n/, '')
    const r = applyWarningOp(md, {
      op: 'add',
      category: 'result',
      message: 'first',
      created: '2026-05-05T14:32:00+08:00',
      rowId: 'w_a',
    })
    const warn = r.content.indexOf('## Warnings')
    const art = r.content.indexOf('## Artifacts')
    expect(warn).toBeLessThan(art)
    expect(warn).toBeGreaterThan(0)
  })
})

describe('generateRowId', () => {
  it('produces the canonical shape', () => {
    const id = generateRowId('2026-05-05T14:32:00+08:00')
    expect(id).toMatch(/^w_2026-05-05T14-32-00\+08-00_[0-9a-f]{4}$/)
  })
})

describe('WARNING_CATEGORIES', () => {
  it('includes the closed enum', () => {
    expect(WARNING_CATEGORIES).toContain('methodology')
    expect(WARNING_CATEGORIES).toContain('other')
    expect(WARNING_CATEGORIES.length).toBe(8)
  })
})

describe('section-bound writer always emits the v3 7-col header', () => {
  // v3-spec-sync task 1.12 — confirms that even when the input table
  // is in legacy v2 6-col form (no `Run` column), applying any
  // section-bound write upgrades the on-disk table to v3 7-col. This
  // is the contract the experiment-readme spec delta promises: 6-col
  // is read-tolerated, but writes always emit 7-col.
  const V2_6COL_README = `---
id: foo-260501-100000
name: foo
project: ''
status: RUNNING
created_at: '2026-05-01T10:00:00+08:00'
finished_at: null
host: null
pid: null
gpus: []
entry: ./run.sh
command: ./run.sh
wandb: null
hypotheses: []
tags: []
---

## Setup
s

## Warnings

| Status | Created | Category | Message | Resolved | Note |
|--------|---------|----------|---------|----------|------|
| OPEN | 2026-05-01T10:00:00+08:00 | result | spike at step 1500 | — | — | <!-- id:w_2026-05-01T10-00-00+08-00_a3f1 -->

## Result
r
`

  it('upgrades a 6-col table to 7-col on add', () => {
    const result = applyWarningOp(V2_6COL_README, {
      op: 'add',
      category: 'config',
      message: 'a new row',
      created: '2026-05-02T10:00:00+08:00',
      rowId: 'w_2026-05-02T10-00-00+08-00_b4f2',
      run: null,
    })
    expect(result.content).toContain(
      '| Status | Created | Run | Category | Message | Resolved | Note |',
    )
    expect(result.content).not.toContain(
      '| Status | Created | Category | Message | Resolved | Note |',
    )
    // Both rows now have 7 cells. The pre-existing row's Run column
    // back-fills as `—` (em dash) since v2 carried no per-row run
    // attribution.
    const lines = result.content
      .split('\n')
      .filter((l) => l.startsWith('| OPEN ') || l.startsWith('| RESOLVED '))
    expect(lines.length).toBe(2)
    for (const l of lines) {
      // Count pipe separators — 7 cells means 8 pipes.
      expect((l.match(/\|/g) ?? []).length).toBeGreaterThanOrEqual(8)
    }
  })

  it('upgrades a 6-col table to 7-col on resolve', () => {
    const result = applyWarningOp(V2_6COL_README, {
      op: 'resolve',
      rowId: 'w_2026-05-01T10-00-00+08-00_a3f1',
      resolved: '2026-05-02T11:00:00+08:00',
      note: 'fixed by config sweep',
    })
    expect(result.content).toContain(
      '| Status | Created | Run | Category | Message | Resolved | Note |',
    )
  })
})
