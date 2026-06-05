import { describe, it, expect } from 'vitest'
import {
  parseCodeReview,
  deriveCompletion,
  toggleCommitReviewed,
  toggleTodoDone,
} from './parse.js'
import { CODE_REVIEW_FILENAME_REGEX } from '../types.js'

const DOC = `---
title: bf16 fix
description: fix the NaN
experiment: E0042-attn
created_at: 2026-05-24T15:30:00+08:00
updated_at: 2026-05-24T15:30:00+08:00
commits:
  - repo: .
    sha: aaa111
    url: https://github.com/o/r/commit/aaa111
    subject: "fix: clamp logits"
    reviewed: false
  - repo: third_party/flash-attn
    sha: bbb222
    url: https://github.com/o/r2/commit/bbb222
    reviewed: true
review_todolist:
  - item: check short seq
    done: false
  - item: check scale default
    done: true
---

# bf16 fix

## Requirement
Body content with $E=mc^2$ and a literal --- mid-line that must survive.
`

describe('CODE_REVIEW_FILENAME_REGEX', () => {
  it('matches and captures date + slug', () => {
    const m = CODE_REVIEW_FILENAME_REGEX.exec('2026-05-24-bf16-fix.md')
    expect(m).not.toBeNull()
    expect(m![1]).toBe('2026-05-24')
    expect(m![2]).toBe('bf16-fix')
  })

  it('rejects non-matching names', () => {
    expect(CODE_REVIEW_FILENAME_REGEX.test('notes.md')).toBe(false)
    expect(CODE_REVIEW_FILENAME_REGEX.test('2026-5-24-x.md')).toBe(false)
    expect(CODE_REVIEW_FILENAME_REGEX.test('2026-05-24-Bad_Slug.md')).toBe(false)
    expect(CODE_REVIEW_FILENAME_REGEX.test('2026-05-24-.md')).toBe(false)
  })
})

describe('parseCodeReview', () => {
  it('parses frontmatter + body', () => {
    const { frontmatter, body } = parseCodeReview(DOC)
    expect(frontmatter.title).toBe('bf16 fix')
    expect(frontmatter.experiment).toBe('E0042-attn')
    expect(frontmatter.commits).toHaveLength(2)
    expect(frontmatter.commits[0]!.sha).toBe('aaa111')
    expect(frontmatter.commits[0]!.subject).toBe('fix: clamp logits')
    expect(frontmatter.commits[0]!.reviewed).toBe(false)
    expect(frontmatter.commits[1]!.reviewed).toBe(true)
    expect(frontmatter.reviewTodolist).toHaveLength(2)
    expect(body).toContain('# bf16 fix')
    expect(body).toContain('literal --- mid-line')
  })

  it('applies lenient defaults', () => {
    const doc = `---
title: x
created_at: 2026-05-24T00:00:00+08:00
updated_at: 2026-05-24T00:00:00+08:00
commits:
  - repo: .
    sha: zzz
    url: https://x/c/zzz
review_todolist:
  - item: do thing
---
body`
    const { frontmatter } = parseCodeReview(doc)
    expect(frontmatter.description).toBe('')
    expect(frontmatter.experiment).toBeNull()
    expect(frontmatter.commits[0]!.reviewed).toBe(false)
    expect(frontmatter.reviewTodolist[0]!.done).toBe(false)
  })

  it('throws on missing frontmatter', () => {
    expect(() => parseCodeReview('# just a body, no frontmatter')).toThrow()
  })
})

describe('deriveCompletion', () => {
  it('counts and flags not-complete', () => {
    const { frontmatter } = parseCodeReview(DOC)
    expect(deriveCompletion(frontmatter)).toEqual({
      totalCommits: 2,
      reviewedCommits: 1,
      totalTodos: 2,
      doneTodos: 1,
      isComplete: false,
    })
  })

  it('all checked → complete', () => {
    const { frontmatter } = parseCodeReview(DOC)
    frontmatter.commits.forEach((c) => (c.reviewed = true))
    frontmatter.reviewTodolist.forEach((t) => (t.done = true))
    expect(deriveCompletion(frontmatter).isComplete).toBe(true)
  })

  it('empty review is not complete', () => {
    expect(
      deriveCompletion({
        title: '',
        description: '',
        experiment: null,
        createdAt: '',
        updatedAt: '',
        commits: [],
        reviewTodolist: [],
      }).isComplete,
    ).toBe(false)
  })
})

describe('toggle helpers', () => {
  const NOW = '2026-06-01T00:00:00+08:00'

  it('toggles a commit by sha, bumps updated_at, preserves the body', () => {
    const out = toggleCommitReviewed(DOC, 'aaa111', true, NOW)
    expect(out).not.toBeNull()
    const after = parseCodeReview(out!)
    expect(after.frontmatter.commits.find((c) => c.sha === 'aaa111')!.reviewed).toBe(true)
    expect(after.frontmatter.commits.find((c) => c.sha === 'bbb222')!.reviewed).toBe(true)
    expect(after.frontmatter.updatedAt).toBe(NOW)
    expect(after.body).toBe(parseCodeReview(DOC).body)
  })

  it('returns null for an unknown sha', () => {
    expect(toggleCommitReviewed(DOC, 'does-not-exist', true, NOW)).toBeNull()
  })

  it('toggles a todo by index', () => {
    const out = toggleTodoDone(DOC, 0, true, NOW)
    expect(out).not.toBeNull()
    const after = parseCodeReview(out!)
    expect(after.frontmatter.reviewTodolist[0]!.done).toBe(true)
    expect(after.frontmatter.reviewTodolist[1]!.done).toBe(true)
    expect(after.frontmatter.updatedAt).toBe(NOW)
    expect(after.body).toBe(parseCodeReview(DOC).body)
  })

  it('returns null for an out-of-range index', () => {
    expect(toggleTodoDone(DOC, 5, true, NOW)).toBeNull()
    expect(toggleTodoDone(DOC, -1, true, NOW)).toBeNull()
  })

  it('returns null on malformed content', () => {
    expect(toggleCommitReviewed('no frontmatter', 'x', true, NOW)).toBeNull()
    expect(toggleTodoDone('no frontmatter', 0, true, NOW)).toBeNull()
  })
})
