import { describe, expect, it } from 'vitest'
import { splitFrontmatter } from './frontmatter'

describe('splitFrontmatter', () => {
  it('splits valid frontmatter from body', () => {
    const src =
      '---\nhypothesis: H0001\nstatus: CONFIRMED\nexperiments:\n  - foo\n  - bar\n---\n# Findings\n\nbody text'
    const { frontmatter, body } = splitFrontmatter(src)
    expect(frontmatter).toEqual({
      hypothesis: 'H0001',
      status: 'CONFIRMED',
      experiments: ['foo', 'bar'],
    })
    expect(body).toBe('# Findings\n\nbody text')
  })

  it('returns full content when there is no frontmatter', () => {
    const src = '# 2026-05-03\n\nno frontmatter here'
    const { frontmatter, body } = splitFrontmatter(src)
    expect(frontmatter).toBeNull()
    expect(body).toBe(src)
  })

  it('falls back when frontmatter YAML is malformed', () => {
    const src = '---\nbroken: [unbalanced\n---\nbody'
    const { frontmatter, body } = splitFrontmatter(src)
    expect(frontmatter).toBeNull()
    expect(body).toBe(src)
  })

  it('does not split when --- appears later but not at the start', () => {
    const src = '# title\n\n---\nthis is a thematic break\n---\n'
    const { frontmatter, body } = splitFrontmatter(src)
    expect(frontmatter).toBeNull()
    expect(body).toBe(src)
  })

  it('treats empty frontmatter as no frontmatter', () => {
    const src = '---\n---\nbody'
    const { frontmatter, body } = splitFrontmatter(src)
    expect(frontmatter).toBeNull()
    expect(body).toBe(src)
  })
})
