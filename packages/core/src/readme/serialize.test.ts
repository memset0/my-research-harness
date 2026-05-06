import { describe, expect, it } from 'vitest'
import { parseReadme } from './parse.js'
import { reserializeReadme, serializeReadme } from './serialize.js'

// v3 shape: drops legacy `project` / `hypotheses` / `tags` fields and adds
// `experiment` / `updated_at`. The serializer no longer emits the legacy
// fields, so the round-trip below would otherwise see a difference.
const SAMPLE = `---
id: foo-260503-082800
name: foo
status: RUNNING
experiment: E0001-fsdp-coll
created_at: 2026-05-03T08:28:00+08:00
updated_at: 2026-05-03T08:28:00+08:00
finished_at: null
host: m2.cluster
pid: 12345
gpus: [0, 1]
entry: ./run.sh
command: bash run.sh
wandb: null
---

## Motivation
Verify H0001.

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
    parsed.sections.newHypotheses = 'H0007: warmup matters.'
    const out = serializeReadme({ frontMatter: parsed.frontMatter, sections: parsed.sections })
    expect(out).toContain('## New Hypotheses')
    expect(out).toContain('H0007: warmup matters.')
  })

  it('throws on non-canonical hypothesis ref in frontmatter', () => {
    const parsed = parseReadme(SAMPLE)
    parsed.frontMatter.hypotheses = ['H0001', 'H3']
    expect(() => reserializeReadme(parsed)).toThrowError(/H3/)
  })

  it('v3 task 4.2: legacy v2 fields (project / hypotheses / tags) are dropped from new writes', () => {
    // Feed a v2-shaped SAMPLE through parse then serialize — the output
    // should contain `experiment:` + `updated_at:` and NOT contain the
    // dropped fields. This ensures the writer pretty-prints to the v3
    // canonical shape regardless of input shape.
    const v2Sample = `---
id: legacy-260101-000000
name: legacy
project: old-sub-project
status: FINISHED
created_at: 2026-01-01T00:00:00+08:00
finished_at: 2026-01-01T01:00:00+08:00
host: null
pid: null
gpus: []
entry: ''
command: ''
wandb: null
hypotheses: [H0001, H0002]
tags: [old, legacy]
---

## Motivation
Old run.
`
    const parsed = parseReadme(v2Sample)
    const out = reserializeReadme(parsed)
    expect(out).toContain('experiment:')
    expect(out).toContain('updated_at:')
    expect(out).not.toContain('project:')
    expect(out).not.toContain('hypotheses:')
    expect(out).not.toContain('tags:')
  })
})
