import { writeFile } from 'node:fs/promises'
import { loadDiscussion, publishDiscussionCatalog, respondToDiscussion } from '@memon/core'
import { commitAll, createTempProject, initGitRepo, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { FilesystemDocumentService } from './document-service.js'

afterEach(removeTempDirs)
it.each([
  '',
  'nested',
])('recovers a full original from Git for a %s Project root', async (prefix) => {
  const resource = 'docs/discussions/D0001-design/README.md'
  const source =
    '---\ntitle: Design\nstatus: OPEN\n---\n## Question\n```question\nid: Q\ntype: text\ncategory: design\nstatus: OPEN\n```\n\n' +
    'Evidence sentence. '.repeat(350) +
    '\n'
  const p = await createTempProject({
    files: {
      [`${prefix ? `${prefix}/` : ''}.memon/project.yml`]: 'schema_version: 1\n',
      [`${prefix ? `${prefix}/` : ''}${resource}`]: source,
    },
  })
  const projectRoot = prefix ? p.path(prefix) : p.root
  await initGitRepo(p.root)
  await commitAll(p.root, 'docs: capture original question')
  await publishDiscussionCatalog(projectRoot)
  const original = await loadDiscussion(projectRoot, 'D0001')
  await respondToDiscussion(projectRoot, 'D0001', {
    question: 'Q',
    snapshot: original.questions[0]!.snapshot,
    answer: { text: 'Agreed' },
  })
  await writeFile(
    p.path(prefix, resource),
    source.replace('Evidence sentence.', 'Updated evidence.'),
  )
  const service = new FilesystemDocumentService([
    {
      name: 'project-a',
      root: projectRoot,
      include: [],
      exclude: [],
      execution: { kind: 'local' },
    },
  ])
  const current = await service.getDiscussion('project-a', 'D0001')
  expect(current.comparisons.Q).toMatchObject({
    source: 'git',
    truncated: false,
    before: original.questions[0]!.section,
  })
})
