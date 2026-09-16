// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { setChecklistStatus } from './checklist/v1/update'
import { BlockRewriteError, replaceBlockPayload } from './rewrite'

const duplicateBlocks = [
  '---', 'id: W0010', '---', '# Plan', '',
  '```yaml checklist@1 #first', 'items:', '  - title: Parent', '    children:', '      - title: Child', '```', '',
  '~~~yaml checklist@1 #second', 'items:', '  - title: Parent', '    children:', '      - title: Child', '~~~', '',
].join('\n')
const payload = 'items:\n  - title: Parent\n    children:\n      - title: Child'

describe('replaceBlockPayload', () => {
  it('addresses duplicate payloads by id and preserves the chosen fence and every outside byte', () => {
    const next = replaceBlockPayload(duplicateBlocks, { id: 'second' }, payload, `${payload}\n    status:\n      agent_completed: true`)
    expect(next).toContain('```yaml checklist@1 #first\n' + payload + '\n```')
    expect(next).toContain('~~~yaml checklist@1 #second\n' + payload + '\n    status:\n      agent_completed: true\n~~~')
  })

  it('preserves indentation and CRLF while accepting an LF expected payload', () => {
    const document = ['before', '  ````yaml figure@1 #fig', '  image: x.svg', '  caption: Old', '  ````', 'after'].join('\r\n')
    const next = replaceBlockPayload(document, { line: 2 }, 'image: x.svg\ncaption: Old', 'image: y.svg\ncaption: New')
    expect(next).toBe(['before', '  ````yaml figure@1 #fig', '  image: y.svg', '  caption: New', '  ````', 'after'].join('\r\n'))
  })


  it('does not invent a blank body line when replacing with an empty payload', () => {
    const document = '```yaml figure@1 #fig\nimage: x\ncaption: X\n```\n'
    expect(replaceBlockPayload(document, { id: 'fig' }, 'image: x\ncaption: X', '')).toBe(
      '```yaml figure@1 #fig\n```\n',
    )
  })
  it('refuses stale payloads and ambiguous duplicate ids', () => {
    expect(() => replaceBlockPayload(duplicateBlocks, { id: 'first' }, `${payload}\n`, payload)).toThrow(BlockRewriteError)
    const duplicateIds = duplicateBlocks.replace('#second', '#first')
    expect(() => replaceBlockPayload(duplicateIds, { id: 'first' }, payload, payload)).toThrow(/used by 2 blocks/)
  })
})

describe('setChecklistStatus', () => {
  it('edits one nested flag by id after frontmatter', () => {
    const next = setChecklistStatus(duplicateBlocks, {
      target: { id: 'second' }, payload, path: [0, 0], field: 'human_acknowledged', value: true,
    })
    expect(next.split('human_acknowledged: true')).toHaveLength(2)
    expect(next.indexOf('human_acknowledged: true')).toBeGreaterThan(next.indexOf('#second'))
  })

  it('refuses a stale payload', () => {
    expect(() => setChecklistStatus(duplicateBlocks, {
      target: { id: 'first' }, payload: 'items: []', path: [0], field: 'human_reviewed', value: true,
    })).toThrow(/changed since it was rendered/)
  })
})
