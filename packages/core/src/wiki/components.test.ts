import { describe, expect, it } from 'vitest'

import { maskWikiCode, parseWikiComponentBlocks, parseWikiFencedBlocks } from './components.js'

describe('parseWikiComponentBlocks', () => {
  it('reads name, pinned version, attributes, and 1-based line', () => {
    const body = ['intro', '', '```memon-data@1 title="FID by step"', 'rows: []', '```', ''].join(
      '\n',
    )
    expect(parseWikiComponentBlocks(body)).toEqual([
      {
        index: 0,
        name: 'memon-data',
        version: 1,
        line: 3,
        info: 'title="FID by step"',
        payload: 'rows: []\n',
      },
    ])
  })

  it('reports an unpinned info string as version null', () => {
    const blocks = parseWikiComponentBlocks('```memon-data\nrows: []\n```\n')
    expect(blocks[0]?.version).toBeNull()
  })

  it('keeps a nested shorter fence inside a longer one as payload', () => {
    const body = ['````html-embed@1 height=280', '```', 'inner', '```', '````', ''].join('\n')
    const blocks = parseWikiComponentBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.payload).toBe('```\ninner\n```\n')
  })

  it('ignores a fence whose info string is not component-shaped', () => {
    expect(parseWikiComponentBlocks('```Python 3\nx = 1\n```\n')).toEqual([])
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

  it('blanks indented code blocks', () => {
    const masked = maskWikiCode('prose\n\n    @W0001 inside an indented block\n')
    expect(masked).not.toContain('@W0001')
  })
})
