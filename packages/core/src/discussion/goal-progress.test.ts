import { readFile } from 'node:fs/promises'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { publishDiscussionCatalog, publishReportCatalog } from '../project-catalogs.js'
import { parseDiscussion, questionDisplayStatus, validateDiscussionAnswer } from './model.js'
import { deriveDiscussionProgress } from './progress.js'
import { resolveDiscussionRefs } from './refs.js'
import {
  listDiscussions,
  loadDiscussion,
  replyToDiscussion,
  resolveDiscussionQuestion,
  respondToDiscussion,
  setDiscussionWork,
} from './store.js'

afterEach(removeTempDirs)

const fence = (fields: string) => `\`\`\`question\n${fields}\`\`\`\n`
const unit = (title: string, fields: string, body = 'Body.\n') =>
  `## ${title}\n\n${fence(fields)}\n${body}\n`
const readme = (body: string, front = '') =>
  `---\ntitle: Refactor\nstatus: OPEN\n${front}---\n\nIntro.\n\n${body}`

describe('goal-progress metadata', () => {
  it('accepts goal, work, decided_by, refs and subgoals without changing the answer snapshot', () => {
    const plain = unit(
      'Cache',
      'id: CACHE\ntype: choice\ncategory: arch\nstatus: DECIDED\ndecision: a\noptions:\n  - id: a\n    label: A\n',
    )
    const tracked = unit(
      'Cache',
      'id: CACHE\ntype: choice\ncategory: arch\nstatus: DECIDED\ndecision: a\nwork: DONE\ndecided_by: agent\nrefs: [R0012, "R0014#benchmarks"]\noptions:\n  - id: a\n    label: A\n',
    )
    const before = parseDiscussion(readme(plain))
    const after = parseDiscussion(readme(tracked, 'goal: Replace the scheduler\n'))
    expect(after.goal).toBe('Replace the scheduler')
    expect(after.diagnostics).toEqual([])
    expect(after.questions[0]!.metadata).toMatchObject({ work: 'DONE', decided_by: 'agent' })
    expect(after.questions[0]!.snapshot).toBe(before.questions[0]!.snapshot)
    expect(after.questions[0]!.sectionHash).not.toBe(before.questions[0]!.sectionHash)
  })
  it('reports work before a decision without hiding the question', () => {
    const parsed = parseDiscussion(
      readme(unit('Open', 'id: OPEN-Q\ntype: text\ncategory: arch\nstatus: OPEN\nwork: DONE\n')),
    )
    expect(parsed.questions[0]!.metadata).not.toBeNull()
    expect(parsed.diagnostics[0]!.message).toMatch(/work DONE requires/)
  })
  it.each([
    ['options', 'options:\n  - id: a\n    label: A\n'],
    ['decision', 'decision: done\n'],
    ['DECIDED', ''],
  ])('rejects a subgoal with %s', (_label, extra) => {
    const status = _label === 'DECIDED' ? 'DECIDED' : 'OPEN'
    const parsed = parseDiscussion(
      readme(
        unit('Migrate', `id: MIGRATE\ntype: subgoal\ncategory: impl\nstatus: ${status}\n${extra}`),
      ),
    )
    expect(parsed.questions[0]!.metadata).toBeNull()
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
  })
  it('accepts only comments on subgoals and never shows them as revised', () => {
    const q = parseDiscussion(
      readme(
        unit('Migrate', 'id: MIGRATE\ntype: subgoal\ncategory: impl\nstatus: OPEN\nwork: DOING\n'),
      ),
    ).questions[0]!
    expect(validateDiscussionAnswer(q.metadata!, { comment: 'Looks partial' })).toEqual({
      comment: 'Looks partial',
    })
    expect(() => validateDiscussionAnswer(q.metadata!, { text: 'x' })).toThrow(/comment/)
    const status = questionDisplayStatus(q, [
      {
        type: 'response',
        id: 'r1',
        question: 'MIGRATE',
        at: '2026-11-26T10:00:00+08:00',
        by: 'owner',
        snapshot: `sha256:${'0'.repeat(64)}`,
        comment: 'note',
      },
      { type: 'ack', id: 'a1', response: 'r1', at: '2026-11-26T10:01:00+08:00', by: 'agent' },
    ])
    expect(status).toBe('OPEN')
  })
})

describe('progress', () => {
  it('partitions the mixed discussion from the spec', () => {
    const progress = deriveDiscussionProgress([
      { type: 'choice', status: 'DECIDED', work: 'DONE', displayStatus: 'DECIDED' },
      { type: 'text', status: 'DECIDED', work: 'SKIP', displayStatus: 'DECIDED' },
      { type: 'choice', status: 'DECIDED', displayStatus: 'DECIDED' },
      { type: 'subgoal', status: 'OPEN', work: 'DOING', displayStatus: 'OPEN' },
      { type: 'choice', status: 'OPEN', displayStatus: 'OPEN' },
      { type: 'text', status: 'OPEN', displayStatus: 'ANSWERED' },
      { type: 'choice', status: 'DROPPED', displayStatus: 'DROPPED' },
    ])
    expect(progress).toMatchObject({
      counted: 6,
      settled: 4,
      completed: 2,
      awaitingWork: 2,
      waitingOwner: 1,
      awaitingAgent: 1,
      otherUnsettled: 0,
      dropped: 1,
    })
  })
  it('counts pending feedback on a settled unit as awaiting the agent and excludes deferred/invalid', () => {
    const progress = deriveDiscussionProgress([
      { type: 'choice', status: 'DECIDED', work: 'TODO', displayStatus: 'ANSWERED' },
      { type: 'choice', status: 'DEFERRED', displayStatus: 'DEFERRED' },
      { type: null, status: null, displayStatus: 'INVALID' },
    ])
    expect(progress).toMatchObject({ counted: 1, awaitingAgent: 1, deferred: 1, invalid: 1 })
  })
})

describe('report references', () => {
  const reports = [
    { id: 'R0012', resource: 'docs/reports/R0012-bench/README.md', title: 'Bench' },
    { id: 'R0014', resource: 'docs/reports/perf/R0014-scaling.md', title: 'Scaling' },
  ]
  it('resolves fields and relative links, dedupes, and diagnoses missing Reports', () => {
    const parsed = parseDiscussion(
      readme(
        unit(
          'Cache',
          'id: CACHE\ntype: text\ncategory: arch\nstatus: OPEN\nrefs: [R0012, R0012, R0099]\n',
          'See [bench](../../reports/R0012-bench/#numbers) and [web](https://example.com).\n',
        ),
      ),
    )
    const { refs, diagnostics } = resolveDiscussionRefs(
      'docs/discussions/D0001-refactor/README.md',
      parsed.questions,
      [
        {
          type: 'reply',
          id: 'p1',
          question: 'CACHE',
          at: '2026-11-26T10:00:00+08:00',
          by: 'agent',
          text: 'Details in [scaling](../../reports/perf/R0014-scaling.md).',
        },
      ],
      reports,
    )
    expect(refs.get('CACHE')).toEqual([
      { report: 'R0012', title: 'Bench', resource: reports[0]!.resource, source: 'field' },
      {
        report: 'R0012',
        anchor: 'numbers',
        title: 'Bench',
        resource: reports[0]!.resource,
        source: 'link',
      },
      { report: 'R0014', title: 'Scaling', resource: reports[1]!.resource, source: 'link' },
    ])
    expect(diagnostics.map((d) => d.message)).toEqual(['ref R0099 is not a registered Report'])
  })
})

describe('goal-progress store workflow', () => {
  const resource = 'docs/discussions/D0001-refactor/README.md'
  const body =
    unit(
      'Cache',
      'id: CACHE\ntype: choice\ncategory: arch\nstatus: OPEN\nrefs: [R0012]\noptions:\n  - id: a\n    label: A\n',
    ) +
    unit('Migrate CLI', 'id: MIGRATE\ntype: subgoal\ncategory: impl\nstatus: OPEN\n') +
    'Trailing prose.\n'
  async function fixture() {
    const p = await createTempProject({
      files: {
        '.memon/project.yml': 'schema_version: 1\n',
        'docs/reports/R0012-bench/README.md': '---\ntitle: Bench\n---\n\n# Bench\n',
        [resource]: readme(body, 'goal: Ship the refactor\n'),
      },
    })
    await publishReportCatalog(p.root)
    await publishDiscussionCatalog(p.root)
    return p
  }
  it('publishes goal, types and refs and derives live progress', async () => {
    const p = await fixture()
    const [summary] = await listDiscussions(p.root)
    expect(summary!.goal).toBe('Ship the refactor')
    expect(summary!.questions.map((q) => q.type)).toEqual(['choice', 'subgoal'])
    expect(summary!.questions[0]!.refs?.[0]).toMatchObject({ report: 'R0012', title: 'Bench' })
    expect(summary!.progress).toMatchObject({ counted: 2, waitingOwner: 1, awaitingWork: 1 })
    const doc = await loadDiscussion(p.root, 'D0001')
    expect(doc.questions[0]!.refs[0]).toMatchObject({ report: 'R0012', source: 'field' })
  })
  it('records the decider, marks work without acks or byte damage, and refuses work before decision', async () => {
    const p = await fixture()
    await expect(setDiscussionWork(p.root, 'D0001/CACHE', 'DONE')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    let doc = await resolveDiscussionQuestion(p.root, 'D0001/CACHE', {
      status: 'DECIDED',
      decision: 'a',
    })
    expect(doc.questions[0]!.metadata).toMatchObject({ decided_by: 'agent' })
    const loaded = await loadDiscussion(p.root, 'D0001')
    await respondToDiscussion(p.root, 'D0001', {
      question: 'MIGRATE',
      snapshot: loaded.questions[1]!.snapshot,
      answer: { comment: 'Keep old flags' },
    })
    const before = await readFile(p.path(resource), 'utf8')
    doc = await setDiscussionWork(p.root, 'D0001/MIGRATE', 'DONE')
    const after = await readFile(p.path(resource), 'utf8')
    expect(after.replace('work: DONE\n', '')).toBe(before)
    expect(doc.questions[1]!.displayStatus).toBe('ANSWERED')
    expect(doc.events.filter((e) => e.type === 'ack')).toEqual([])
    doc = await resolveDiscussionQuestion(p.root, 'D0001/CACHE', { status: 'OPEN' })
    expect(doc.questions[0]!.metadata?.decided_by).toBeUndefined()
  })
  it('records owner as decider when resolve processes owner feedback', async () => {
    const p = await fixture()
    const loaded = await loadDiscussion(p.root, 'D0001')
    await respondToDiscussion(p.root, 'D0001', {
      question: 'CACHE',
      snapshot: loaded.questions[0]!.snapshot,
      answer: { choice: 'a' },
    })
    const doc = await resolveDiscussionQuestion(p.root, 'D0001/CACHE', {
      status: 'DECIDED',
      decision: 'a',
      work: 'TODO',
    })
    expect(doc.questions[0]!.metadata).toMatchObject({ decided_by: 'owner', work: 'TODO' })
  })
  it('republishes reply citations', async () => {
    const p = await fixture()
    await replyToDiscussion(p.root, 'D0001/MIGRATE', 'See [bench](../../reports/R0012-bench/).')
    const [summary] = await listDiscussions(p.root)
    expect(summary!.questions[1]!.refs?.[0]).toMatchObject({ report: 'R0012', source: 'link' })
  })
})
