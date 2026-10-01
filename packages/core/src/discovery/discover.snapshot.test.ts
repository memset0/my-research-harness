// Behaviour-compatibility guard for the Run walk: under the default Project
// configuration (no `run_dirs`), the discovered Run set of the bundled mock
// projects must stay exactly what the unbounded walk produced before
// `bounded-run-discovery` touched it. The fixture was captured from the walk
// as it was before that change.

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverRuns } from './discover.js'

const MOCK_ROOT = resolve(__dirname, '../../../../mock')
const SNAPSHOT = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/mock-discovery-snapshot.json'), 'utf8'),
) as Record<string, string[]>

describe('discoverRuns default-config compatibility', () => {
  for (const [project, expected] of Object.entries(SNAPSHOT)) {
    it(`keeps the ${project} Run set and paths unchanged`, async () => {
      const root = resolve(MOCK_ROOT, project)
      const found = await discoverRuns({ name: project, root, include: [], exclude: [] })
      expect(found.map((path) => relative(root, path))).toEqual(expected)
    })
  }

  it('expands run_dirs patterns over the mocks', async () => {
    const at = async (project: string, runDirs: string[]) => {
      const root = resolve(MOCK_ROOT, project)
      const found = await discoverRuns({ name: project, root, include: [], exclude: [], runDirs })
      return found.map((path) => relative(root, path))
    }
    const depth = (path: string) => path.split('/').length - 1
    for (const project of Object.keys(SNAPSHOT)) {
      expect(await at(project, ['logs/*'])).toEqual(
        SNAPSHOT[project]!.filter((path) => depth(path) === 1),
      )
      expect(await at(project, ['logs/*', 'logs/*/*', 'logs/*/*/*'])).toEqual(SNAPSHOT[project])
    }
    expect(await at('project-a', ['logs/sub/*'])).toEqual(['logs/sub/bar-260502-150000'])
  })
})
