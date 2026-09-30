// Round-trip tests for parseExperimentReadme + serializeExperimentReadme,
// focused on the v3 `## Plan` section. The Plan section is opaque markdown
// (free-form body, GFM task lists at any nesting depth permitted), and
// the parser/serializer pair must preserve the body verbatim modulo the
// trailing-whitespace normalization the writer performs uniformly across
// all body sections.

import { describe, expect, it } from 'vitest'

import { parseExperimentReadme } from './parse.js'
import { serializeExperimentReadme } from './serialize.js'

const FRONT_MATTER = `---
id: E0001-foo
slug: foo
title: Foo study
status: OPEN
archived: false
runs: [foo-260501-100000]
hypotheses: []
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-01T08:00:00+08:00'
---`

const V3_FRONT_MATTER = `---
id: E0001-foo
slug: foo
title: Foo study
runs: [foo-260501-100000]
hypotheses: []
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-01T08:00:00+08:00'
---`

function makeDoc(planBody: string | null): string {
  const planSection = planBody === null ? '' : `## Plan\n${planBody}\n\n`
  return `${FRONT_MATTER}\n\n## Motivation\nWhy we run this.\n\n## Method\nHow we run it.\n\n${planSection}## Conclusion\n\n## Caveats\n\n## Warnings\n`
}

describe('parseExperimentReadme + serializeExperimentReadme — Plan section', () => {
  it('round-trips a Plan body with nested GFM task lists (covers tasks.md 3.1)', () => {
    const planBody = [
      '- [x] Run baseline at LR=1e-4',
      '  - converged but loss plateaued early; try warmup next',
      '- [ ] Try LR=3e-4 + warmup',
      '  - [ ] Sweep batch size [32, 64, 128]',
      '  - [ ] Compare against rotary baseline',
    ].join('\n')

    const original = makeDoc(planBody)
    const parsed = parseExperimentReadme(original, 'E0001-foo')

    expect(parsed.parseErrors).toEqual([])
    expect(parsed.parseWarnings).toEqual([])
    expect(parsed.sections.plan).toBe(planBody)

    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })

    // The Plan body should be present byte-for-byte (the serializer only
    // .trim()s the section body — internal newlines and `[ ]` / `[x]`
    // markers are preserved exactly).
    expect(out).toContain(`## Plan\n${planBody}`)
  })

  it('round-trips a Plan body with mixed checkbox + paragraph + sub-heading content', () => {
    const planBody = [
      '- [x] First task',
      '',
      'Some free-form reflection paragraph between items.',
      '',
      '### Nested sub-heading',
      '- [ ] A task under the sub-heading',
      '  - [ ] A nested child checkbox',
    ].join('\n')

    const original = makeDoc(planBody)
    const parsed = parseExperimentReadme(original, 'E0001-foo')

    expect(parsed.parseErrors).toEqual([])
    expect(parsed.sections.plan).toBe(planBody)

    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })

    // Every line of the plan body must appear in the output.
    for (const line of planBody.split('\n')) {
      if (line === '') continue
      expect(out).toContain(line)
    }
  })

  it('legacy doc with no `## Plan` heading parses to plan: null with no warning, and serializer emits an empty Plan placeholder in the canonical position (covers tasks.md 3.2)', () => {
    const original = makeDoc(null)
    const parsed = parseExperimentReadme(original, 'E0001-foo')

    expect(parsed.parseErrors).toEqual([])
    // No warning should mention the missing `Plan` section.
    expect(parsed.parseWarnings.some((w) => /plan/i.test(w.message))).toBe(false)
    expect(parsed.sections.plan).toBeNull()

    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })

    // Plan placeholder must exist exactly once, between the Method block
    // and the Conclusion heading.
    const planMatches = out.match(/^## Plan$/gm)
    expect(planMatches?.length ?? 0).toBe(1)

    const planIdx = out.indexOf('## Plan')
    const methodIdx = out.indexOf('## Method')
    const conclusionIdx = out.indexOf('## Conclusion')
    expect(methodIdx).toBeGreaterThanOrEqual(0)
    expect(planIdx).toBeGreaterThan(methodIdx)
    expect(conclusionIdx).toBeGreaterThan(planIdx)
  })

  it('a non-Plan edit (modify Method, leave Plan untouched) preserves the Plan body byte-exact (covers tasks.md 3.3)', () => {
    const planBody = '- [x] Done\n- [ ] Pending\n  - [ ] Nested pending'
    const original = makeDoc(planBody)
    const parsed = parseExperimentReadme(original, 'E0001-foo')
    expect(parsed.sections.plan).toBe(planBody)

    // Mutate Method only.
    const mutated = {
      ...parsed.sections,
      method: 'A brand new methodology description.',
    }

    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: mutated,
      warningsRaw: parsed.warningsRaw,
    })

    // Re-parse the output and assert the Plan body is unchanged.
    const reparsed = parseExperimentReadme(out, 'E0001-foo')
    expect(reparsed.sections.plan).toBe(planBody)
    expect(reparsed.sections.method).toBe('A brand new methodology description.')
  })

  it('canonical section ordering is preserved on serialize: Motivation → Method → Plan → Conclusion → Caveats → Warnings', () => {
    const original = makeDoc('- [ ] Plan item')
    const parsed = parseExperimentReadme(original, 'E0001-foo')
    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })

    const order = [
      '## Motivation',
      '## Method',
      '## Plan',
      '## Conclusion',
      '## Caveats',
      '## Warnings',
    ]
    let cursor = 0
    for (const heading of order) {
      const idx = out.indexOf(heading, cursor)
      expect(idx, `expected ${heading} at or after cursor ${cursor}`).toBeGreaterThanOrEqual(cursor)
      cursor = idx + heading.length
    }
  })
})

describe('parseExperimentReadme + serializeExperimentReadme — v4 lifecycle frontmatter', () => {
  it('round-trips a v4 frontmatter with status + archived (covers tasks.md 2.5)', () => {
    const original = makeDoc('- [ ] Plan item')
    const parsed = parseExperimentReadme(original, 'E0001-foo')

    expect(parsed.parseErrors).toEqual([])
    expect(parsed.parseWarnings).toEqual([])
    expect(parsed.frontMatter.status).toBe('OPEN')
    expect(parsed.frontMatter.archived).toBe(false)

    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })

    expect(out).toContain('status: OPEN')
    expect(out).toContain('archived: false')
    // Canonical key order: status between title and archived; archived between status and runs.
    const titleIdx = out.indexOf('title:')
    const statusIdx = out.indexOf('status:')
    const archivedIdx = out.indexOf('archived:')
    const runsIdx = out.indexOf('runs:')
    expect(statusIdx).toBeGreaterThan(titleIdx)
    expect(archivedIdx).toBeGreaterThan(statusIdx)
    expect(runsIdx).toBeGreaterThan(archivedIdx)
  })

  it('preserves a non-default status + archived round-trip', () => {
    const fm = `---
id: E0001-foo
slug: foo
title: Foo study
status: RESOLVED
archived: true
runs: [foo-260501-100000]
hypotheses: []
tags: []
created_at: '2026-05-01T08:00:00+08:00'
updated_at: '2026-05-13T12:00:00+08:00'
---`
    const original = `${fm}\n\n## Motivation\n\n## Method\n\n## Conclusion\nWe got it.\n\n## Caveats\n\n## Warnings\n`
    const parsed = parseExperimentReadme(original, 'E0001-foo')

    expect(parsed.parseErrors).toEqual([])
    expect(parsed.parseWarnings).toEqual([])
    expect(parsed.frontMatter.status).toBe('RESOLVED')
    expect(parsed.frontMatter.archived).toBe(true)

    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })
    expect(out).toContain('status: RESOLVED')
    expect(out).toContain('archived: true')
  })

  it('a v3-shaped doc (no status / archived) parses with defaulted values + warnings; serializer produces v4 shape (covers tasks.md 2.6)', () => {
    const original = `${V3_FRONT_MATTER}\n\n## Motivation\n\n## Method\n\n## Conclusion\n\n## Caveats\n\n## Warnings\n`
    const parsed = parseExperimentReadme(original, 'E0001-foo')

    expect(parsed.parseErrors).toEqual([])
    // Expect the two MISSING warnings.
    const codes = parsed.parseWarnings.map((w) => w.message.split(':')[0])
    expect(codes).toContain('MISSING_EXP_STATUS')
    expect(codes).toContain('MISSING_ARCHIVED_FIELD')
    // Defaulted values.
    expect(parsed.frontMatter.status).toBe('OPEN')
    expect(parsed.frontMatter.archived).toBe(false)

    // Serializer (re-emit) produces v4 shape with the defaulted values.
    const out = serializeExperimentReadme({
      frontMatter: parsed.frontMatter,
      sections: parsed.sections,
      warningsRaw: parsed.warningsRaw,
    })
    expect(out).toContain('status: OPEN')
    expect(out).toContain('archived: false')
  })
})
