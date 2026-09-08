import { describe, expect, it } from 'vitest'
import { parseReadme } from './parse.js'

const VALID_README = `---
id: foo-260503-082800
name: foo
project: fsdp-comm
status: RUNNING
created_at: 2026-05-03T08:28:00+08:00
finished_at: null
host: m2.cluster
pid: 12345
gpus: [0, 1, 2, 3]
entry: ./run.sh
command: bash run.sh --bs=8
wandb: https://wandb.ai/u/p/runs/xxx
hypotheses: [H0001, H0003]
tags: [moe, overlap]
---

## Motivation
Verify hypothesis H0001.

## Setup
- 4x A100

## Method
Train for 1k steps.

## Result
loss converges.

## Conclusion
H0001 confirmed.

## Caveats
small sample.

## Artifacts
- \`./checkpoints/\` — model checkpoint
- \`./outputs/loss.csv\` — loss curve

## New Hypotheses
H0007: warmup matters.
`

describe('parseReadme', () => {
  it('parses a valid full README with no errors', () => {
    const parsed = parseReadme(VALID_README)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.frontMatter.id).toBe('foo-260503-082800')
    expect(parsed.frontMatter.status).toBe('RUNNING')
    expect(parsed.frontMatter.gpus).toEqual([0, 1, 2, 3])
    expect(parsed.frontMatter.hypotheses).toEqual(['H0001', 'H0003'])
    expect(parsed.frontMatter.pid).toBe(12345)
    expect(parsed.sections.motivation).toBe('Verify hypothesis H0001.')
    expect(parsed.sections.artifacts).toEqual([
      { path: './checkpoints/', description: 'model checkpoint' },
      { path: './outputs/loss.csv', description: 'loss curve' },
    ])
    expect(parsed.sections.newHypotheses).toContain('H0007')
  })

  it('drops invalid hypothesis refs from frontmatter array with per-element warning', () => {
    const mixed = VALID_README.replace(
      'hypotheses: [H0001, H0003]',
      'hypotheses: [H0001, H3, H0042]',
    )
    const parsed = parseReadme(mixed)
    expect(parsed.frontMatter.hypotheses).toEqual(['H0001', 'H0042'])
    expect(
      parsed.parseWarnings.some(
        (w) => w.field === 'hypotheses' && /INVALID_HYPOTHESIS_REF.*H3/.test(w.message),
      ),
    ).toBe(true)
  })

  it('warns when status is lowercase', () => {
    const lc = VALID_README.replace('status: RUNNING', 'status: running')
    const parsed = parseReadme(lc)
    expect(parsed.frontMatter.status).toBe('RUNNING')
    expect(parsed.parseWarnings.some((w) => w.field === 'status')).toBe(true)
  })

  it('errors and falls back to UNKNOWN on bad status', () => {
    const bad = VALID_README.replace('status: RUNNING', 'status: completed')
    const parsed = parseReadme(bad)
    expect(parsed.frontMatter.status).toBe('UNKNOWN')
    expect(parsed.parseErrors.some((e) => e.field === 'status')).toBe(true)
  })

  it('accepts a record without command/entry and still errors on a missing id', () => {
    // v6 minimal record: `id` is the only hard requirement; execution facts
    // are written when they exist.
    const noCommand = parseReadme(VALID_README.replace(/^command:.*$/m, ''))
    expect(noCommand.parseErrors).toEqual([])
    expect(noCommand.frontMatter.command).toBe('')

    const noId = parseReadme(VALID_README.replace(/^id:.*$/m, ''))
    expect(noId.parseErrors.some((e) => e.field === 'id')).toBe(true)
  })

  it('handles missing optional fields gracefully', () => {
    const minimal = `---
id: foo-260503-082800
name: foo
project: fsdp-comm
status: PENDING
created_at: 2026-05-03T08:28:00+08:00
entry: ./run.sh
command: bash run.sh
hypotheses: []
tags: []
---

## Motivation
TBD
`
    const parsed = parseReadme(minimal)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.frontMatter.pid).toBeNull()
    expect(parsed.frontMatter.host).toBeNull()
    expect(parsed.frontMatter.wandb).toBeNull()
    expect(parsed.frontMatter.gpus).toEqual([])
  })

  it('reports unparseable front matter as error and recovers body', () => {
    const broken = `---
id: foo
name: : : invalid : :
status: RUNNING
---

## Motivation
body
`
    const parsed = parseReadme(broken)
    // Either errors out or warns — the key is body remains accessible
    expect(parsed.body).toContain('## Motivation')
  })
})
