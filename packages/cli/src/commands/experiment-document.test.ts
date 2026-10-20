import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it } from 'vitest'
import { captureCli, experimentReadme } from '../test-support/results-project.js'
import { runExperimentCreate } from './experiment-doc.js'
import { runShow } from './show.js'

afterEach(removeTempDirs)

it('keeps the strict allocation slug rule', async () => {
  const project = await createTempProject()
  const out = await captureCli(() =>
    runExperimentCreate({ projectRoot: project.root, cwd: project.root, slug: 'a' }),
  )
  expect(out.exitCode).toBe(2)
})

it('reads a legacy optional section without requiring a dedicated phase command', async () => {
  const project = await createTempProject({
    experiments: {
      'E0001-study': { 'README.md': experimentReadme('E0001-study', []) },
    },
  })
  const out = await captureCli(() =>
    runShow({
      projectRoot: project.root,
      cwd: project.root,
      format: 'json',
      id: 'E0001',
      section: 'investigation',
    }),
  )
  expect(out.exitCode).toBe(0)
  expect(out.json.section).toBe('investigation')
  expect(out.json.diagnostics).toBeDefined()
})
