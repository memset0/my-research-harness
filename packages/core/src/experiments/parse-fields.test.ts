import { describe, expect, it } from 'vitest'
import { parseReadme } from '../readme/parse.js'
import { parseExperimentReadme } from './parse.js'

function experimentReadme(frontmatter: string): string {
  return `---\nid: E0001-foo\nslug: foo\ntitle: Foo\nstatus: OPEN\nruns: []\n${frontmatter}\ncreated_at: "2026-05-01T00:00:00+08:00"\nupdated_at: "2026-05-01T00:00:00+08:00"\n---\n\n## Motivation\n\nm\n`
}

function runReadme(frontmatter: string): string {
  return `---\nid: foo-260501-100000\nname: foo\nstatus: RUNNING\ncreated_at: "2026-05-01T10:00:00+08:00"\n${frontmatter}\n---\n\n## Setup\n\ns\n`
}

const hypothesisWarnings = (warnings: { field?: string; message: string }[]) =>
  warnings.filter((w) => w.field === 'hypotheses').map((w) => w.message)

describe('Experiment and Run parsers share frontmatter field helpers', () => {
  it('retired metadata does not produce hypothesis diagnostics', () => {
    const parsed = parseExperimentReadme(
      experimentReadme('hypotheses: [H0001, 7]\ntags: []'),
      'E0001-foo',
    )
    expect(parsed.frontMatter.hypotheses).toEqual(['H0001'])
    expect(hypothesisWarnings(parsed.parseWarnings)).toEqual([])
    expect(parsed.parseErrors.some((issue) => issue.field?.startsWith('hypotheses'))).toBe(false)
  })

  it('legacy H identifiers are preserved without domain validation', () => {
    const exp = parseExperimentReadme(experimentReadme('hypotheses: [H3]\ntags: []'), 'E0001-foo')
    const run = parseReadme(runReadme('hypotheses: [H3]'))
    expect(hypothesisWarnings(exp.parseWarnings)).toEqual(hypothesisWarnings(run.parseWarnings))
    expect(hypothesisWarnings(exp.parseWarnings)).toEqual([])
    expect(exp.frontMatter.hypotheses).toEqual(['H3'])
    expect(run.frontMatter.hypotheses).toEqual(['H3'])
  })

  it('Experiment: non-string tags and title fall back like the Run parser', () => {
    const parsed = parseExperimentReadme(
      experimentReadme('hypotheses: []\ntags: [a, 1, b]').replace('title: Foo', 'title: 5'),
      'E0001-foo',
    )
    expect(parsed.frontMatter.tags).toEqual(['a', 'b'])
    expect(parsed.frontMatter.title).toBe('')
  })
})
