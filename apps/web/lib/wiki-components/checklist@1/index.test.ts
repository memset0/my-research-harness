// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { checklistV1 } from './index'
import { ChecklistEditError, setChecklistStatus } from './update'
import { listComponentBlocks, lintComponents } from '../registry'

const unchecked = { agent_completed: false, human_acknowledged: false, human_reviewed: false }

describe('checklist@1 parsing', () => {
  it('defaults every flag to false and normalises empty content and children', () => {
    const data = checklistV1.parsePayload(
      ['items:', '  - title: Parent', '    children:', '      - title: Child', '        content: null', '        children: null'].join('\n'),
      {},
    )
    expect(data).toEqual({
      items: [
        {
          title: 'Parent',
          content: '',
          status: unchecked,
          children: [{ title: 'Child', content: '', status: unchecked, children: [] }],
        },
      ],
    })
  })

  it('keeps the three flags independent', () => {
    const data = checklistV1.parsePayload(
      ['items:', '  - title: Only reviewed', '    status:', '      human_reviewed: true'].join('\n'),
      {},
    )
    expect(data.items[0]?.status).toEqual({ ...unchecked, human_reviewed: true })
  })

  it('accepts an empty root list', () => {
    expect(checklistV1.parsePayload('items: []', {}).items).toEqual([])
    expect(checklistV1.parsePayload('items:', {}).items).toEqual([])
  })

  it.each([
    ['string flag', 'items:\n  - title: A\n    status:\n      agent_completed: "false"'],
    ['unknown item field', 'items:\n  - title: A\n    done: true'],
    ['unknown status field', 'items:\n  - title: A\n    status:\n      reviewed: true'],
    ['blank title', 'items:\n  - title: "  "'],
    ['alias', 'items:\n  - &a\n    title: A\n  - *a'],
    ['scalar root', 'just text'],
    ['malformed yaml', 'items: ['],
  ])('rejects %s', (_label, payload) => {
    expect(() => checklistV1.parsePayload(payload, {})).toThrow()
  })

  it('round-trips through the Markdown projection and lints its examples', () => {
    const data = checklistV1.parsePayload(checklistV1.example.split('\n').slice(1, -1).join('\n'), {})
    expect(listComponentBlocks(checklistV1.toMarkdown(data))[0]?.data).toEqual(data)
    expect(lintComponents(checklistV1.example)).toEqual([])
    for (const invalid of checklistV1.invalidExamples) {
      expect(lintComponents(invalid.block)[0]?.code).toBe(invalid.code)
    }
  })
})

const page = [
  '---',
  'id: W0010',
  'kind: note',
  '---',
  '# Plan',
  '',
  'Intro paragraph.',
  '',
  '```checklist@1',
  'items:',
  '  - title: First # keep this comment',
  '    children:',
  '      - title: Nested',
  '        content: |',
  '          two',
  '          lines',
  '```',
  '',
  'Between.',
  '',
  '```checklist@1',
  'items:',
  '  - title: First # keep this comment',
  '    children:',
  '      - title: Nested',
  '        content: |',
  '          two',
  '          lines',
  '```',
  '',
  'Outro.',
  '',
].join('\n')

const payload = page.split('\n').slice(9, 16).join('\n')

describe('setChecklistStatus', () => {
  it('flips exactly one flag in the addressed block and preserves everything else', () => {
    const next = setChecklistStatus(page, {
      line: 21,
      payload,
      path: [0, 0],
      field: 'human_acknowledged',
      value: true,
    })
    const before = page.split('\n')
    const after = next.split('\n')
    expect(after.slice(0, 20)).toEqual(before.slice(0, 20))
    expect(after.slice(-4)).toEqual(before.slice(-4))
    expect(next).toContain('  - title: First # keep this comment')
    expect(next).toContain(
      '        content: |\n          two\n          lines\n        status:\n          human_acknowledged: true',
    )
    expect(next.split('human_acknowledged: true')).toHaveLength(2)
    const blocks = listComponentBlocks(next)
    expect(blocks[0]?.data).toEqual(listComponentBlocks(page)[0]?.data)
    const second = checklistV1.parsePayload(blocks[1]?.payload ?? '', {})
    expect(second.items[0]?.children[0]?.status).toEqual({ ...unchecked, human_acknowledged: true })
  })

  it('clears a flag and preserves CRLF line endings', () => {
    const crlf = page
      .replace('      - title: Nested', '      - title: Nested\n        status:\n          agent_completed: true')
      .replace(/\n/g, '\r\n')
    const next = setChecklistStatus(crlf, {
      line: 9,
      payload: crlf.split('\r\n').slice(9, 18).join('\n'),
      path: [0, 0],
      field: 'agent_completed',
      value: false,
    })
    expect(next.split('\r\n')).toHaveLength(crlf.split('\r\n').length)
    expect(/[^\r]\n/.test(next)).toBe(false)
    expect(next).toContain('agent_completed: false')
  })

  it('refuses stale payloads, missing items, and non-checklist blocks', () => {
    expect(() =>
      setChecklistStatus(page, { line: 9, payload: `${payload}\n`, path: [0], field: 'human_reviewed', value: true }),
    ).toThrow(ChecklistEditError)
    expect(() =>
      setChecklistStatus(page, { line: 9, payload, path: [0, 3], field: 'human_reviewed', value: true }),
    ).toThrow(ChecklistEditError)
    expect(() =>
      setChecklistStatus(page, { line: 5, payload, path: [0], field: 'human_reviewed', value: true }),
    ).toThrow(ChecklistEditError)
  })
})
