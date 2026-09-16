import { describe, expect, it } from 'vitest'

import { maskWikiCode, parseWikiComponentBlocks, parseWikiFencedBlocks } from './components.js'

describe('parseWikiComponentBlocks', () => {
  it('reads lang, type, pinned version, id, and 1-based line', () => {
    const body = ['intro', '', '```yaml datatable@1 #fid', 'data: []', '```', ''].join('\n')
    expect(parseWikiComponentBlocks(body)).toEqual([
      {
        index: 0,
        lang: 'yaml',
        type: 'datatable',
        version: 1,
        id: 'fid',
        line: 3,
        payload: 'data: []\n',
        executable: false,
      },
    ])
  })

  it('reports an unpinned declaration as version null and a missing id as null', () => {
    const blocks = parseWikiComponentBlocks('```yaml datatable\ndata: []\n```\n')
    expect(blocks[0]?.version).toBeNull()
    expect(blocks[0]?.id).toBeNull()
  })

  it('marks a payload carrying `script` or `code` executable', () => {
    const script = parseWikiComponentBlocks(
      '```yaml datatable@1 #fid\nscript: ./collect.py::collect\nrun_dir: logs/x\n```\n',
    )
    expect(script[0]?.executable).toBe(true)
    const code = parseWikiComponentBlocks(
      '```yaml datatable@1 #fid\ncode: |\n  def collect():\n      return {}\n```\n',
    )
    expect(code[0]?.executable).toBe(true)
    const html = parseWikiComponentBlocks('```html embed@1 #chart\nscript: not-yaml\n```\n')
    expect(html[0]?.executable).toBe(false)
  })

  it('keeps a nested shorter fence inside a longer one as payload', () => {
    const body = ['````html embed@1 #chart', '```', 'inner', '```', '````', ''].join('\n')
    const blocks = parseWikiComponentBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.payload).toBe('```\ninner\n```\n')
  })

  it('ignores a fence whose info string is not a component declaration', () => {
    expect(parseWikiComponentBlocks('```python\nx = 1\n```\n')).toEqual([])
    expect(parseWikiComponentBlocks('```yaml title="x"\nx: 1\n```\n')).toEqual([])
    // Grammar violations are the central registry's WIKI_COMPONENT_INVALID.
    expect(parseWikiComponentBlocks('```yaml datatable@1 #fid extra\nx: 1\n```\n')).toEqual([])
  })

  it('runs an unterminated fence to the end of the body', () => {
    const blocks = parseWikiFencedBlocks('```mermaid\nflowchart LR\n  A --> B\n')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.endLine).toBe(4)
  })
})

describe('maskWikiCode', () => {
  it('blanks fenced blocks and inline code while preserving line geometry', () => {
    const body = ['see `@W0001` here', '```', '@W0002', '```', '@W0003'].join('\n')
    const masked = maskWikiCode(body)
    expect(masked.split('\n')).toHaveLength(5)
    expect(masked).not.toContain('@W0001')
    expect(masked).not.toContain('@W0002')
    expect(masked).toContain('@W0003')
    expect(masked.split('\n')[0]).toHaveLength('see `@W0001` here'.length)
  })

  it('blanks a component block like any other fenced block', () => {
    const masked = maskWikiCode('```yaml datatable@1 #fid\nnote: "@W0001"\n```\n')
    expect(masked).not.toContain('@W0001')
  })

  it('blanks indented code blocks', () => {
    const masked = maskWikiCode('prose\n\n    @W0001 inside an indented block\n')
    expect(masked).not.toContain('@W0001')
  })
})
