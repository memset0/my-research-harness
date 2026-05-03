import { describe, expect, it } from 'vitest'
import { parseReadme } from './parse.js'
import { reserializeReadme, serializeReadme } from './serialize.js'

const SAMPLE = `---
id: foo-260503-082800
name: foo
project: fsdp-comm
status: RUNNING
created_at: 2026-05-03T08:28:00+08:00
finished_at: null
host: m2.cluster
pid: 12345
gpus: [0, 1]
entry: ./run.sh
command: bash run.sh
wandb: null
hypotheses: [H1]
tags: [moe]
---

## Motivation
Verify H1.

## Setup
4x A100

## Method
Train.

## Result
Converges.

## Conclusion
Confirmed.

## Caveats
Small.

## Artifacts
- \`./out\` — output dir
`

describe('serializeReadme', () => {
  it('round-trips through parse+reserialize+parse with stable structure', () => {
    const parsed1 = parseReadme(SAMPLE)
    expect(parsed1.parseErrors).toEqual([])
    const serialized = reserializeReadme(parsed1)
    const parsed2 = parseReadme(serialized)
    expect(parsed2.parseErrors).toEqual([])
    expect(parsed2.frontMatter).toEqual(parsed1.frontMatter)
    expect(parsed2.sections.artifacts).toEqual(parsed1.sections.artifacts)
    expect(parsed2.sections.motivation).toBe(parsed1.sections.motivation)
  })

  it('emits all 7 standard sections in canonical order', () => {
    const parsed = parseReadme(SAMPLE)
    const out = reserializeReadme(parsed)
    const order = ['Motivation', 'Setup', 'Method', 'Result', 'Conclusion', 'Caveats', 'Artifacts']
    let prev = -1
    for (const heading of order) {
      const idx = out.indexOf(`## ${heading}`)
      expect(idx).toBeGreaterThan(prev)
      prev = idx
    }
  })

  it('omits optional New Hypotheses section when empty by default', () => {
    const parsed = parseReadme(SAMPLE)
    const out = reserializeReadme(parsed)
    expect(out).not.toContain('## New Hypotheses')
  })

  it('emits New Hypotheses when content present', () => {
    const parsed = parseReadme(SAMPLE)
    parsed.sections.newHypotheses = 'H7: warmup matters.'
    const out = serializeReadme({ frontMatter: parsed.frontMatter, sections: parsed.sections })
    expect(out).toContain('## New Hypotheses')
    expect(out).toContain('H7: warmup matters.')
  })
})
