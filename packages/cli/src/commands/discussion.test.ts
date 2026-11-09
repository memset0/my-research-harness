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
