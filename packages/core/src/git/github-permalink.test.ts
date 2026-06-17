import { describe, it, expect } from 'vitest'
import { parseGithubPermalink, sliceContext } from './github-permalink.js'

describe('parseGithubPermalink', () => {
  it('parses a single-line permalink', () => {
    expect(
      parseGithubPermalink('https://github.com/acme/proj/blob/abc123/src/foo.ts#L42'),
    ).toEqual({
      owner: 'acme',
      repo: 'proj',
      sha: 'abc123',
      path: 'src/foo.ts',
      startLine: 42,
      endLine: 42,
    })
  })

  it('parses a range permalink with a nested path', () => {
    expect(
      parseGithubPermalink('https://github.com/o/r/blob/deadbeef/a/b/c.cc#L10-L20'),
    ).toMatchObject({ owner: 'o', repo: 'r', sha: 'deadbeef', path: 'a/b/c.cc', startLine: 10, endLine: 20 })
  })

  it('strips a trailing ?plain=1 query', () => {
    const p = parseGithubPermalink('https://github.com/o/r/blob/sha/x.md?plain=1#L3-L4')
    expect(p?.path).toBe('x.md')
    expect(p?.startLine).toBe(3)
    expect(p?.endLine).toBe(4)
  })

  it('rejects non-blob, no-anchor, and non-github URLs', () => {
    expect(parseGithubPermalink('https://github.com/o/r/commit/sha')).toBeNull()
    expect(parseGithubPermalink('https://github.com/o/r/blob/sha/x.ts')).toBeNull()
    expect(parseGithubPermalink('https://example.com/o/r/blob/sha/x.ts#L1')).toBeNull()
    expect(parseGithubPermalink('not a url')).toBeNull()
    expect(parseGithubPermalink('')).toBeNull()
  })

  it('rejects an inverted range', () => {
    expect(parseGithubPermalink('https://github.com/o/r/blob/s/x.ts#L20-L10')).toBeNull()
  })
})

describe('sliceContext', () => {
  const content = Array.from({ length: 50 }, (_, i) => `line${i + 1}`).join('\n')

  it('windows around the range with context + target flags', () => {
    const c = sliceContext(content, 20, 22, 5, 400)
    expect(c.startLine).toBe(15)
    expect(c.endLine).toBe(27)
    expect(c.lines[0]).toEqual({ n: 15, text: 'line15', target: false })
    expect(c.lines.find((l) => l.n === 20)!.target).toBe(true)
    expect(c.lines.find((l) => l.n === 22)!.target).toBe(true)
    expect(c.lines.find((l) => l.n === 23)!.target).toBe(false)
    expect(c.truncated).toBe(false)
  })

  it('clamps to file start and end', () => {
    expect(sliceContext(content, 1, 2, 5, 400).startLine).toBe(1)
    expect(sliceContext(content, 49, 50, 5, 400).endLine).toBe(50)
  })

  it('caps at maxLines and sets truncated', () => {
    const c = sliceContext(content, 1, 50, 12, 10)
    expect(c.lines.length).toBe(10)
    expect(c.truncated).toBe(true)
  })
})
