import { describe, expect, it } from 'vitest'
import { extractTitle } from './title.js'

describe('extractTitle', () => {
  it('returns the first H1 heading', () => {
    expect(extractTitle('# Hello world\n\nbody text')).toBe('Hello world')
  })

  it('skips YAML frontmatter at top of file', () => {
    const content = `---
foo: bar
---

# Real title

body
`
    expect(extractTitle(content)).toBe('Real title')
  })

  it('ignores H1 inside fenced code blocks', () => {
    const content = '```md\n# not the title\n```\n\n# actual title\n'
    expect(extractTitle(content)).toBe('actual title')
  })

  it('returns null when no H1 exists', () => {
    expect(extractTitle('## only h2\n\nbody')).toBeNull()
  })

  it('returns null on empty input', () => {
    expect(extractTitle('')).toBeNull()
  })

  it('trims trailing whitespace from the title', () => {
    expect(extractTitle('#    Hello    \n')).toBe('Hello')
  })

  it('treats unclosed leading frontmatter as body content', () => {
    // A lone `---` at top with no closing — fall back to scanning the body.
    // Permissive: a malformed frontmatter shouldn't lock the title parser out.
    expect(extractTitle('---\n# but no close')).toBe('but no close')
  })
})
