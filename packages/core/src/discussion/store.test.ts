import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishDiscussionCatalog } from '../project-catalogs.js'
import { projectFs } from '../project-file-store.js'
import { pendingDiscussionResponses } from './model.js'
import {
  createDiscussion,
  listDiscussions,
  loadDiscussion,
  replyToDiscussion,
  resolveDiscussionQuestion,
  respondToDiscussion,
  setDiscussionStatus,
} from './store.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})
const resource = 'docs/discussions/D0001-design/README.md'
const source =
  '---\ntitle: Design\nstatus: OPEN\n---\n\nIntroduction.\n\n## Choose storage\n\n```question\nid: STORAGE\ntype: choice\ncategory: design\nstatus: OPEN\noptions:\n  - id: a\n    label: Files\n  - id: b\n    label: Database\n```\n\nKeep this prose.\n'
async function fixture() {
  const p = await createTempProject({
    files: { '.memon/project.yml': 'schema_version: 1\n', [resource]: source },
  })
  await publishDiscussionCatalog(p.root)
  return p
}
describe('discussion workflow', () => {
  it('creates an unpublished draft and explicitly publishes it', async () => {
    const p = await createTempProject({ files: { '.memon/project.yml': 'schema_version: 1\n' } })
    const created = await createDiscussion(p.root, 'design', 'Design')
    expect(created.status).toBe('DRAFT')
    expect(await listDiscussions(p.root)).toEqual([])
    await expect(loadDiscussion(p.root, created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await setDiscussionStatus(p.root, created.id, 'OPEN')
    expect((await listDiscussions(p.root))[0]?.status).toBe('OPEN')
  })
  it('answers, replies and resolves without damaging prose or invalidating the decision', async () => {
    const p = await fixture(),
      before = await loadDiscussion(p.root, 'D0001')
    const answered = await respondToDiscussion(p.root, 'D0001', {
      question: 'STORAGE',
      snapshot: before.questions[0]!.snapshot,
      answer: { choice: 'a', comment: 'Keep exportable' },
    })
    expect(answered.questions[0]!.displayStatus).toBe('ANSWERED')
    await replyToDiscussion(p.root, 'D0001/STORAGE', 'Will keep the export.')
    const resolved = await resolveDiscussionQuestion(p.root, 'D0001/STORAGE', {
      status: 'DECIDED',
      decision: 'a',
      note: 'Adopted',
    })
    expect(resolved.questions[0]!.displayStatus).toBe('DECIDED')
    expect(pendingDiscussionResponses(resolved.events)).toEqual([])
    expect(resolved.source.slice(resolved.questions[0]!.fenceEnd)).toBe(
      before.source.slice(before.questions[0]!.fenceEnd),
    )
    expect(resolved.source.slice(0, resolved.questions[0]!.fenceStart)).toBe(
      before.source.slice(0, before.questions[0]!.fenceStart),
    )
    await writeFile(
      p.path(resource),
      resolved.source.replace('Keep this prose.', 'Updated evidence.'),
    )
    expect((await loadDiscussion(p.root, 'D0001')).questions[0]!.displayStatus).toBe('REVISED')
  })
  it('rejects stale answers and lock conflicts, and preserves unanswered questions when closed', async () => {
    const p = await fixture(),
      doc = await loadDiscussion(p.root, 'D0001')
    await expect(
      respondToDiscussion(p.root, 'D0001', {
        question: 'STORAGE',
        snapshot: 'wrong',
        answer: { choice: 'a' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      setDiscussionStatus(p.root, 'D0001', 'CLOSED', { mtime: doc.mtime, hash: 'wrong' }, true),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const closed = await setDiscussionStatus(p.root, 'D0001', 'CLOSED', doc, true)
    expect(closed.questions[0]!.metadata?.status).toBe('OPEN')
    expect(await readFile(p.path(resource), 'utf8')).toBe(
      source.replace('status: OPEN', 'status: "CLOSED"'),
    )
    await expect(
      respondToDiscussion(p.root, 'D0001', {
        question: 'STORAGE',
        snapshot: doc.questions[0]!.snapshot,
        answer: { choice: 'a' },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const reopened = await setDiscussionStatus(p.root, 'D0001', 'OPEN', closed, true)
    expect(reopened.questions[0]!.metadata?.id).toBe('STORAGE')
  })
})

it('reports metadata-only partial progress and safely completes acknowledgements on retry', async () => {
  const p = await fixture(),
    doc = await loadDiscussion(p.root, 'D0001')
  await respondToDiscussion(p.root, 'D0001', {
    question: 'STORAGE',
    snapshot: doc.questions[0]!.snapshot,
    answer: { choice: 'a' },
  })
  vi.spyOn(projectFs, 'appendFile').mockRejectedValueOnce(new Error('source append unavailable'))
  await expect(
    resolveDiscussionQuestion(p.root, 'D0001/STORAGE', { status: 'DECIDED', decision: 'a' }),
  ).rejects.toMatchObject({ code: 'PARTIAL' })
  const partial = await loadDiscussion(p.root, 'D0001')
  expect(partial.questions[0]!.metadata?.status).toBe('DECIDED')
  expect(pendingDiscussionResponses(partial.events)).toHaveLength(1)
  const recovered = await resolveDiscussionQuestion(p.root, 'D0001/STORAGE', {
    status: 'DECIDED',
    decision: 'a',
  })
  expect(pendingDiscussionResponses(recovered.events)).toEqual([])
  expect(recovered.questions[0]!.displayStatus).toBe('DECIDED')
})

it('preserves native document permissions during lifecycle edits', async () => {
  const p = await fixture()
  await chmod(p.path(resource), 0o640)
  const doc = await loadDiscussion(p.root, 'D0001')
  await setDiscussionStatus(p.root, 'D0001', 'CLOSED', doc, true)
  expect((await stat(p.path(resource))).mode & 0o777).toBe(0o640)
})
