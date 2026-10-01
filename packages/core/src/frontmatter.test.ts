import { describe, expect, it } from 'vitest'
import { parseCodeReview, splitCodeReviewFrontmatter } from './code-review/parse.js'
import { splitFrontmatter } from './frontmatter.js'
import { patchRunFrontMatter } from './readme/frontmatter-patch.js'
import { parseWikiFrontmatter } from './wiki/frontmatter.js'

interface Fixture {
  name: string
  text: string
  status: 'ok' | 'none' | 'unterminated'
  /** Parsed YAML mapping when status is `ok`. */
  data?: Record<string, unknown>
  body?: string
}

const FIXTURES: Fixture[] = [
  { name: 'LF', text: '---\nid: a\n---\nbody\n', status: 'ok', data: { id: 'a' }, body: 'body\n' },
  {
    name: 'CRLF',
    text: '---\r\nid: a\r\n---\r\nbody\r\n',
    status: 'ok',
    data: { id: 'a' },
    body: 'body\r\n',
  },
  {
    name: 'BOM',
    text: '﻿---\nid: a\n---\nbody\n',
    status: 'ok',
    data: { id: 'a' },
    body: 'body\n',
  },
  {
    name: 'BOM + CRLF',
    text: '﻿---\r\nid: a\r\n---\r\n\r\nbody',
    status: 'ok',
    data: { id: 'a' },
    body: '\r\nbody',
  },
  { name: 'empty block', text: '---\n---\nbody\n', status: 'ok', data: {}, body: 'body\n' },
  {
    name: 'trailing spaces on delimiters',
    text: '--- \nid: a\n---\t\nbody',
    status: 'ok',
    data: { id: 'a' },
    body: 'body',
  },
  {
    name: 'dots terminator',
    text: '---\nid: a\n...\nbody',
    status: 'ok',
    data: { id: 'a' },
    body: 'body',
  },
  {
    name: 'terminator at end of text',
    text: '---\nid: a\n---',
    status: 'ok',
    data: { id: 'a' },
    body: '',
  },
  { name: 'no frontmatter', text: '# Title\n\nbody\n', status: 'none' },
  { name: 'dashes not on their own line', text: '----\nid: a\n---\n', status: 'none' },
  { name: 'unterminated', text: '---\nid: a\nbody\n', status: 'unterminated' },
]

describe('splitFrontmatter — one rule across document kinds', () => {
  it.each(FIXTURES)('$name: splitter', (fixture) => {
    const split = splitFrontmatter(fixture.text)
    expect(split.status).toBe(fixture.status)
    if (split.status === 'ok') {
      expect(split.body).toBe(fixture.body)
      expect(fixture.text.slice(split.bodyStart)).toBe(fixture.body)
      expect(fixture.text.slice(split.rawStart, split.rawEnd)).toBe(split.raw)
      expect(split.bom).toBe(fixture.text.startsWith('﻿'))
    }
  })

  it.each(FIXTURES)('$name: wiki pages', (fixture) => {
    const parsed = parseWikiFrontmatter(fixture.text)
    if (fixture.status === 'ok') {
      expect(parsed.frontmatter).toEqual(fixture.data)
      expect(parsed.body).toBe(fixture.body)
    } else {
      expect(parsed.frontmatter).toBeNull()
      expect(parsed.body).toBe(fixture.text)
    }
  })

  it.each(FIXTURES)('$name: code-review docs', (fixture) => {
    const split = splitCodeReviewFrontmatter(fixture.text)
    if (fixture.status === 'ok') {
      expect(split).toEqual({ data: fixture.data, body: fixture.body })
    } else {
      expect(split).toBeNull()
    }
  })

  it.each(FIXTURES)('$name: Run frontmatter patch', (fixture) => {
    if (fixture.status === 'ok') {
      const patched = patchRunFrontMatter(fixture.text, { status: 'FINISHED' })
      const after = splitFrontmatter(patched)
      expect(after.status).toBe('ok')
      if (after.status === 'ok') expect(after.body).toBe(fixture.body)
      expect(patched.startsWith('﻿')).toBe(fixture.text.startsWith('﻿'))
      expect(patched).toContain('status: FINISHED')
    } else {
      expect(() => patchRunFrontMatter(fixture.text, { status: 'FINISHED' })).toThrow(
        fixture.status === 'none' ? /no YAML frontmatter/ : /not terminated/,
      )
    }
  })
})

describe('code-review parse keeps throwing without frontmatter', () => {
  it('throws on a document without a block', () => {
    expect(() => parseCodeReview('# no frontmatter\n')).toThrow()
  })
})
