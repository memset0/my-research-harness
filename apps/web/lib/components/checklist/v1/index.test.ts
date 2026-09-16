// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { validatePayload } from '../../registry'

describe('checklist@1 schema', () => {
  it('normalises null content, children, status, and omitted flags', () => {
    expect(validatePayload('checklist', 1, { items: [{ title: 'A', content: null, status: null, children: null }] })).toEqual({
      ok: true,
      data: { items: [{ title: 'A', content: '', status: { agent_completed: false, human_acknowledged: false, human_reviewed: false }, children: [] }] },
    })
  })
  it('keeps the three flags independent', () => {
    const result = validatePayload('checklist', 1, { items: [{ title: 'A', status: { human_reviewed: true } }] })
    expect(result.ok && result.data.items).toEqual([{ title: 'A', content: '', status: { agent_completed: false, human_acknowledged: false, human_reviewed: true }, children: [] }])
  })
})
