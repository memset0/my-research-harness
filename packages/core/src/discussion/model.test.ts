import { describe, expect, it } from 'vitest'
import {
  type DiscussionResponse,
  discussionHash,
  parseDiscussion,
  parseDiscussionEvents,
  pendingDiscussionResponses,
  questionDisplayStatus,
  responseWithSection,
  validateDiscussionAnswer,
} from './model.js'

const question = (id = 'STORE', extra = '') =>
  `## Storage\n\n\`\`\`question\nid: ${id}\ntype: choice\ncategory: design\nstatus: OPEN\noptions:\n  - id: a\n    label: Files\n  - id: b\n    label: Database\n${extra}\`\`\`\n\nDescription.\n`
const readme = (body: string) =>
  `---\ntitle: Design\nstatus: OPEN\ncategories: [design, other]\n---\n\nIntroduction.\n\n${body}`
const response = (snapshot: string): DiscussionResponse => ({
  type: 'response',
  id: 'r1',
  question: 'STORE',
  at: '2026-11-08T10:00:00-08:00',
  by: 'owner',
  choice: 'a',
  snapshot,
})
describe('discussion sections', () => {
  it('parses exact sections, nested prose and fenced examples', () => {
    const nested = `${question()}\n### Evidence\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n\`\`\`\`\n## Example\n\`\`\`question\nid: EXAMPLE\n\`\`\`\n\`\`\`\`\n\n`
    const text = readme(`${nested}## Ordinary\n\nOutside.\n\n${question('OTHER')}`)
    const parsed = parseDiscussion(text)
    expect(parsed.title).toBe('Design')
    expect(parsed.questions.map((q) => q.metadata?.id)).toEqual(['STORE', 'OTHER'])
    expect(parsed.questions[0]!.body).toContain('### Evidence')
    expect(parsed.questions[0]!.section).not.toContain('Outside.')
    expect(parsed.questions[0]!.sectionHash).toBe(
      discussionHash(text.slice(parsed.questions[0]!.start, parsed.questions[0]!.end)),
    )
    expect(
      parsed.parts.filter((p) => p.type === 'prose').some((p) => p.markdown.includes('Outside.')),
    ).toBe(true)
  })
  it('requires question as the first block after a heading', () => {
    expect(
      parseDiscussion(readme('## Title\n\nFirst paragraph.\n\n```question\nid: NO\n```\n'))
        .questions,
    ).toHaveLength(0)
  })
  it('reports every duplicate and illegal ID with lines', () => {
    const parsed = parseDiscussion(readme(question() + question() + question('lower')))
    expect(parsed.questions.every((q) => q.metadata === null)).toBe(true)
    expect(parsed.diagnostics).toHaveLength(3)
    expect(parsed.diagnostics.every((d) => d.line > 1)).toBe(true)
  })
  it('rejects duplicate YAML fields and unclosed fences visibly', () => {
    expect(
      parseDiscussion(readme(question('STORE', 'status: DECIDED\n'))).diagnostics.length,
    ).toBeGreaterThan(0)
    expect(
      parseDiscussion(
        readme('## Q\n```question\nid: Q\ntype: text\ncategory: general\nstatus: OPEN\n'),
      ).diagnostics[0]!.message,
    ).toContain('not closed')
  })
  it('validates preferences and decisions against options', () => {
    expect(
      parseDiscussion(readme(question('STORE', 'prefer: {option: z}\n'))).questions[0]!.metadata,
    ).toBeNull()
    expect(
      parseDiscussion(readme(question('STORE', 'prefer: {option: a, reason: Portable}\n')))
        .questions[0]!.metadata?.prefer?.option,
    ).toBe('a')
  })
})
describe('discussion feedback', () => {
  it('validates answer types, options and comment-only responses', () => {
    const q = parseDiscussion(readme(question())).questions[0]!.metadata!
    expect(validateDiscussionAnswer(q, { comment: 'Need more detail' })).toEqual({
      comment: 'Need more detail',
    })
    expect(validateDiscussionAnswer(q, { choice: 'a' })).toEqual({ choice: 'a' })
    for (const bad of [
      { choice: 'z' },
      { choices: ['a'] },
      { confirm: false },
      {},
      { by: 'agent', choice: 'a' },
    ])
      expect(() => validateDiscussionAnswer(q, bad)).toThrow()
    expect(
      validateDiscussionAnswer({ ...q, type: 'confirm', options: undefined }, { confirm: false }),
    ).toEqual({ confirm: false })
    expect(() =>
      validateDiscussionAnswer({ ...q, type: 'multi' }, { choices: ['a', 'a'] }),
    ).toThrow()
  })
  it('preserves later feedback when an older response is acknowledged', () => {
    const q = parseDiscussion(readme(question())).questions[0]!
    const events = [
      response(q.snapshot),
      { ...response(q.snapshot), id: 'r2' },
      {
        type: 'ack' as const,
        response: 'r1',
        at: '2026-11-08T11:00:00-08:00',
        by: 'agent' as const,
      },
    ]
    expect(pendingDiscussionResponses(events).map((e) => e.id)).toEqual(['r2'])
    expect(questionDisplayStatus(q, events)).toBe('ANSWERED')
    expect(questionDisplayStatus({ ...q, snapshot: discussionHash('changed') }, events)).toBe(
      'REVISED',
    )
  })
  it('reports corrupt, duplicate, orphan and incomplete log lines', () => {
    const r = response(discussionHash('q'))
    const parsed = parseDiscussionEvents(
      `${JSON.stringify(r)}\n${JSON.stringify(r)}\nnot-json\n${JSON.stringify({ type: 'ack', response: 'missing', by: 'agent', at: r.at })}\n{`,
    )
    expect(parsed.events).toHaveLength(1)
    expect(parsed.diagnostics.map((d) => d.line)).toEqual([2, 3, 4, 5])
  })
  it('bounds a Unicode fallback by the entire encoded line and labels truncation', () => {
    const r = responseWithSection(response(discussionHash('q')), '汉字🙂'.repeat(3000))
    expect(Buffer.byteLength(`${JSON.stringify(r)}\n`)).toBeLessThanOrEqual(4096)
    expect(r.section_truncated).toBe(true)
    expect(r.section).not.toContain('\uFFFD')
    expect(responseWithSection(response(discussionHash('q')), 'short').section_truncated).toBe(
      false,
    )
    expect(() =>
      responseWithSection({ ...response(discussionHash('q')), comment: 'x'.repeat(5000) }, ''),
    ).toThrow('4096')
  })
})

it('keeps answer validity through category and processing changes, but detects revised options', () => {
  const original = readme(question())
  const before = parseDiscussion(original).questions[0]!
  const resolved = original
    .replace('category: design', 'category: next')
    .replace('status: OPEN\noptions:', 'status: DECIDED\ndecision: a\nrationale: Adopted\noptions:')
  const after = parseDiscussion(resolved).questions[0]!
  expect(after.snapshot).toBe(before.snapshot)
  expect(after.sectionHash).not.toBe(before.sectionHash)
  const events = [
    response(before.snapshot),
    { type: 'ack' as const, response: 'r1', at: '2026-11-08T12:00:00-08:00', by: 'agent' as const },
  ]
  expect(questionDisplayStatus(after, events)).toBe('DECIDED')
  expect(
    questionDisplayStatus(
      parseDiscussion(resolved.replace('label: Files', 'label: Files with export')).questions[0]!,
      events,
    ),
  ).toBe('REVISED')
})
