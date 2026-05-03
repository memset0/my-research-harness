import { describe, expect, it } from 'vitest'
import { splitH2Sections } from './sections.js'

describe('splitH2Sections', () => {
  it('captures sections in order with bodies', () => {
    const md = [
      '# Title',
      '',
      'preamble line',
      '',
      '## Foo',
      'foo body',
      '',
      '## Bar',
      'bar body line 1',
      'bar body line 2',
    ].join('\n')

    const split = splitH2Sections(md)
    expect(split.order).toEqual(['Foo', 'Bar'])
    expect(split.preamble).toContain('preamble line')
    expect(split.sections.get('Foo')).toBe('foo body')
    expect(split.sections.get('Bar')).toBe('bar body line 1\nbar body line 2')
  })

  it('does not split inside fenced code blocks', () => {
    const md = ['## Real', 'before', '```', '## Not a heading', '```', 'after'].join('\n')
    const split = splitH2Sections(md)
    expect(split.order).toEqual(['Real'])
    expect(split.sections.get('Real')).toContain('## Not a heading')
  })

  it('handles empty body', () => {
    const split = splitH2Sections('')
    expect(split.order).toEqual([])
    expect(split.preamble).toBe('')
  })
})
