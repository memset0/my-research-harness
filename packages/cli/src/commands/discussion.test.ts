import { publishDiscussionCatalog } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { createResearchProgram } from '../research-program.js'
import { captureCli } from '../test-support/results-project.js'
import { runDiscussion } from './discussion.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempDirs()
})
it('exposes the discussion command family and creates/reads an unpublished draft', async () => {
  const p = await createTempProject({ files: { '.memon/project.yml': 'schema_version: 1\n' } })
  const globals = { projectRoot: p.root, cwd: p.root, format: 'json' as const }
  const created = await captureCli(() =>
    runDiscussion(globals, 'create', 'design', { title: 'Design' }),
  )
  expect(created.exitCode).toBe(0)
  expect(created.json.status).toBe('DRAFT')
  const list = await captureCli(() => runDiscussion(globals, 'list'))
  expect(list.json.discussions[0].id).toBe('D0001')
  const command = createResearchProgram().commands.find((c) => c.name() === 'discussion')!
  expect(command.commands.map((c) => c.name())).toEqual(
    expect.arrayContaining([
      'create',
      'show',
      'list',
      'pending',
      'resolve',
      'reply',
      'status',
      'decisions',
      'work',
      'todo',
    ]),
  )
})
it('preserves exit 9 on a stale document guard', async () => {
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/discussions/D0001-design/README.md':
        '---\ntitle: Design\nstatus: OPEN\n---\n## Question\n```question\nid: Q\ntype: text\ncategory: design\nstatus: OPEN\n```\n\nEvidence\n',
    },
  })
  await publishDiscussionCatalog(p.root)
  const result = await captureCli(() =>
    runDiscussion({ projectRoot: p.root, cwd: p.root, format: 'json' }, 'resolve', 'D0001/Q', {
      status: 'DECIDED',
      decision: 'Agreed',
      expectedHash: 'wrong',
    }),
  )
  expect(result.exitCode).toBe(9)
})

it.each([
  ['choice', '1', '1'],
  ['choice', 'false', 'false'],
  ['text', 'false', 'false'],
  ['confirm', 'false', false],
  ['multi', '["1","2"]', ['1', '2']],
] as const)('keeps the decision type for %s %s', async (type, value, expected) => {
  const options =
    type === 'choice' || type === 'multi'
      ? 'options:\n  - id: "1"\n    label: One\n  - id: "2"\n    label: Two\n  - id: "false"\n    label: False label\n'
      : ''
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/discussions/D0001-design/README.md': `---\ntitle: Design\nstatus: OPEN\n---\n## Question\n\`\`\`question\nid: Q\ntype: ${type}\ncategory: design\nstatus: OPEN\n${options}\`\`\`\n\nEvidence\n`,
    },
  })
  await publishDiscussionCatalog(p.root)
  const result = await captureCli(() =>
    runDiscussion({ projectRoot: p.root, cwd: p.root, format: 'json' }, 'resolve', 'D0001/Q', {
      status: 'DECIDED',
      decision: value,
    }),
  )
  expect(result.exitCode, result.stderr).toBe(0)
  expect(result.json.questions[0].metadata.decision).toEqual(expected)
})

it('marks work, lists the agent work queue and shows progress', async () => {
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/discussions/D0001-design/README.md':
        '---\ntitle: Design\nstatus: OPEN\ngoal: Ship it\n---\n## Question\n```question\nid: Q\ntype: text\ncategory: design\nstatus: OPEN\n```\n\nEvidence\n\n## Migrate\n```question\nid: MIGRATE\ntype: subgoal\ncategory: impl\nstatus: OPEN\n```\n\nPlan\n',
    },
  })
  await publishDiscussionCatalog(p.root)
  const globals = { projectRoot: p.root, cwd: p.root, format: 'json' as const }
  const early = await captureCli(() => runDiscussion(globals, 'work', 'D0001/Q', { work: 'DONE' }))
  expect(early.exitCode).not.toBe(0)
  const resolved = await captureCli(() =>
    runDiscussion(globals, 'resolve', 'D0001/Q', {
      status: 'DECIDED',
      decision: 'Agreed',
      work: 'DOING',
      by: 'agent',
    }),
  )
  expect(resolved.exitCode, resolved.stderr).toBe(0)
  expect(resolved.json.questions[0].metadata).toMatchObject({ work: 'DOING', decided_by: 'agent' })
  const todo = await captureCli(() => runDiscussion(globals, 'todo'))
  expect(todo.json.todo.map((t: { target: string; work: string }) => [t.target, t.work])).toEqual([
    ['D0001/Q', 'DOING'],
    ['D0001/MIGRATE', 'TODO'],
  ])
  const done = await captureCli(() =>
    runDiscussion(globals, 'work', 'D0001/MIGRATE', { work: 'DONE' }),
  )
  expect(done.exitCode, done.stderr).toBe(0)
  const shown = await captureCli(() => runDiscussion(globals, 'show', 'D0001'))
  expect(shown.json.goal).toBe('Ship it')
  expect(shown.json.progress).toMatchObject({ counted: 2, completed: 1, awaitingWork: 1 })
  const stale = await captureCli(() =>
    runDiscussion(globals, 'work', 'D0001/Q', {
      work: 'DONE',
      expectedMtime: 1,
      expectedHash: 'wrong',
    }),
  )
  expect(stale.exitCode).toBe(9)
})
