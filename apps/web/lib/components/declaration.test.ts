// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { parseComponentDeclaration } from './declaration'

describe('parseComponentDeclaration', () => {
  it('parses pinned, unpinned, and id-bearing declarations', () => {
    expect(parseComponentDeclaration('yaml datatable@1 #metrics')).toEqual({
      kind: 'component',
      declaration: { lang: 'yaml', type: 'datatable', version: 1, id: 'metrics' },
    })
    expect(parseComponentDeclaration('html embed')).toEqual({
      kind: 'component',
      declaration: { lang: 'html', type: 'embed', version: null, id: null },
    })
  })

  it('keeps one-token and attribute-like fences ordinary', () => {
    expect(parseComponentDeclaration('python')).toEqual({ kind: 'plain' })
    expect(parseComponentDeclaration('yaml title="x"')).toEqual({ kind: 'plain' })
  })

  it.each([
    'yaml datatable@0',
    'yaml datatable@1 not-an-id',
    'yaml datatable@1 #ok extra',
  ])('rejects malformed component-shaped info %s', (info) => {
    expect(parseComponentDeclaration(info).kind).toBe('invalid')
  })
})
