import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { loadConfig } from '../config/load.js'
import { ConfigRawSchema } from '../schemas.js'

afterEach(removeTempDirs)
it('loads independent title and discussion edit allowances without enabling general writes', async () => {
  const project = await createTempProject({
    files: {
      'config.yml':
        'projects:\n  - name: project-a\n    root: ./project-a\n    read_only: true\n    allowed_edits: [discussion, title, discussion]\n',
    },
  })
  const config = await loadConfig({ cwd: project.root })
  expect(config!.projects[0]).toMatchObject({
    readOnly: true,
    allowedEdits: ['discussion', 'title'],
  })
  expect(
    ConfigRawSchema.safeParse({
      projects: [{ name: 'project-a', root: './project-a', allowed_edits: ['arbitrary'] }],
    }).success,
  ).toBe(false)
})
