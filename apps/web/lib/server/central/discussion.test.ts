import { chmod } from 'node:fs/promises'
// @vitest-environment node

import { loadConfig, publishDiscussionCatalog } from '@memon/core'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { __resetDirectCentralRuntimeForTests, directCentralRuntime } from './direct-runtime'

afterEach(async () => {
  __resetDirectCentralRuntimeForTests()
  await removeTempDirs()
})
it('admits only configured discussion edits through host-qualified read-only routing', async () => {
  const source =
    '---\ntitle: Design\nstatus: OPEN\n---\n## Q\n```question\nid: Q\ntype: text\ncategory: design\nstatus: OPEN\n```\n\nEvidence.\n'
  const p = await createTempProject({
    files: {
      '.memon/project.yml': 'schema_version: 1\n',
      'docs/discussions/D0001-design/README.md': source,
      'config.yml':
        'projects:\n  - name: project-a\n    root: .\n    host: local\n    read_only: true\n    allowed_edits: [discussion]\nslurm:\n  total_nodes: -1\n',
    },
  })
  await chmod(p.path('config.yml'), 0o600)
  await publishDiscussionCatalog(p.root)
  const config = (await loadConfig({ cwd: p.root }))!,
    runtime = directCentralRuntime(config)
  const url = 'http://central.test/api/discussions/D0001?host=local&project=project-a'
  const read = await runtime.dispatch({ request: new Request(url), actor: { role: 'owner' } })
  expect(read.status).toBe(200)
  const doc = (await read.json()) as {
    mtime: number
    hash: string
    questions: { snapshot: string }[]
  }
  const endpoint =
    'http://central.test/api/discussions/D0001/responses?host=local&project=project-a'
  const response = await runtime.dispatch({
    request: new Request(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Q',
        snapshot: doc.questions[0]!.snapshot,
        answer: { text: 'Agreed' },
      }),
    }),
    actor: { role: 'owner' },
  })
  expect(response.status).toBe(200)
  const close = await runtime.dispatch({
    request: new Request(
      'http://central.test/api/discussions/D0001/status?host=local&project=project-a',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'CLOSED',
          expectedMtime: doc.mtime,
          expectedHash: doc.hash,
        }),
      },
    ),
    actor: { role: 'owner' },
  })
  expect(close.status).toBe(200)
  __resetDirectCentralRuntimeForTests()
  config.projects[0]!.allowedEdits = ['title']
  await expect(
    directCentralRuntime(config).dispatch({
      request: new Request(endpoint, { method: 'POST', body: '{}' }),
      actor: { role: 'owner' },
    }),
  ).rejects.toMatchObject({ status: 403 })
})
