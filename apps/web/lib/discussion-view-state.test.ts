// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  changedDiscussionItems,
  discussionViewState,
  parseDiscussionViewState,
} from './discussion-view-state'
import type { DiscussionDetail } from './dto/discussions'

const document = {
  title: 'Design',
  status: 'OPEN',
  categories: ['design'],
  parts: [],
  questions: [
    { metadata: { id: 'Q1' }, sectionHash: 'source-1', displayStatus: 'OPEN', history: [] },
  ],
} as unknown as DiscussionDetail
describe('discussion browser baseline', () => {
  it('initializes quietly and detects only the changed question', () => {
    const first = discussionViewState(document)
    expect(changedDiscussionItems(null, first)).toEqual([])
    const next = discussionViewState({
      ...document,
      questions: document.questions.map((q) => ({ ...q, sectionHash: 'source-2' })),
    })
    expect(changedDiscussionItems(first, next)).toEqual(['Q1'])
    expect(changedDiscussionItems(next, next)).toEqual([])
  })
  it('retains a parseable reload baseline without saving research text', () => {
    const state = discussionViewState(document),
      text = JSON.stringify(state)
    expect(parseDiscussionViewState(text)).toEqual(state)
    expect(text).not.toContain('Design')
    for (const invalid of ['broken', '{}', '{"version":1,"items":{"Q1":{}}}'])
      expect(parseDiscussionViewState(invalid)).toBeNull()
  })
})
