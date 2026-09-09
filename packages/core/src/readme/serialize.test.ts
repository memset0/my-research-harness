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

## Artifacts
- \`./out\` — output dir
`

// v2 shape: carries the Experiment-inherited keys that v3+ stopped writing.
const V2_SAMPLE = `---
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

  it('emits present sections in canonical order and preserves legacy chapters', () => {
    const parsed = parseReadme(SAMPLE)
    const out = reserializeReadme(parsed)
    const order = ['Motivation', 'Setup', 'Method', 'Result', 'Conclusion', 'Artifacts']
    let prev = -1
    for (const heading of order) {
      const idx = out.indexOf(`## ${heading}`)
      expect(idx).toBeGreaterThan(prev)
      prev = idx
    }
    // Legacy chapters are content: an unrelated edit must not delete them.
    expect(out).toContain('Train.')
    expect(out).toContain('Confirmed.')
    // Absent chapters are not invented.
    expect(out).not.toContain('## Caveats')
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

  it('throws on non-canonical hypothesis ref when building a document', () => {
    const parsed = parseReadme(SAMPLE)
    parsed.frontMatter.hypotheses = ['H0001', 'H3']
    expect(() =>
      serializeReadme({ frontMatter: parsed.frontMatter, sections: parsed.sections }),
    ).toThrowError(/H3/)
  })

  it('drops legacy v2 fields (project / hypotheses / tags) when building a document', () => {
    const parsed = parseReadme(V2_SAMPLE)
    const out = serializeReadme({ frontMatter: parsed.frontMatter, sections: parsed.sections })
    expect(out).not.toContain('experiment:')
    expect(out).toContain('updated_at:')
    expect(out).not.toContain('project:')
    expect(out).not.toContain('hypotheses:')
    expect(out).not.toContain('tags:')
  })
})

describe('reserializeReadme', () => {
  it('preserves declared legacy keys and the body across a metadata mutation', () => {
    const parsed = parseReadme(V2_SAMPLE)
    parsed.frontMatter.status = 'FAILED'
    const out = reserializeReadme(parsed)

    expect(out).toContain('status: FAILED')
    // A v2 document keeps the keys it declared — an unrelated status edit is
    // not a migration, and dropping them would silently rewrite history.
    expect(out).toContain('project: old-sub-project')
    expect(out).toContain('hypotheses: [H0001, H0002]')
    expect(out).toContain('tags: [old, legacy]')
    // Body verbatim: no invented headings, nothing reordered.
    expect(out.slice(out.indexOf('## Motivation'))).toBe(
      V2_SAMPLE.slice(V2_SAMPLE.indexOf('## Motivation')),
    )
    expect(out).not.toContain('## Setup')
  })

  it('does not reject a legacy document with a malformed hypothesis ref', () => {
    const parsed = parseReadme(V2_SAMPLE.replace('[H0001, H0002]', '[H0001, H3]'))
    parsed.frontMatter.archived = true
    expect(() => reserializeReadme(parsed)).not.toThrow()
  })
})
