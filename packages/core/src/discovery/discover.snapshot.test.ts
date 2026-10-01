// Behaviour-compatibility guard for the Run walk: under the default Project
// configuration (no `run_depth`), the discovered Run set of the bundled mock
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

  it('bounds the mock walks with run_depth', async () => {
    const at = async (project: string, runDepth: 1 | 2) => {
      const root = resolve(MOCK_ROOT, project)
      const found = await discoverRuns({ name: project, root, include: [], exclude: [], runDepth })
      return found.map((path) => relative(root, path))
    }
    const shallow = (paths: string[], depth: number) =>
      paths.filter((path) => path.split('/').length - 1 <= depth)
    for (const project of Object.keys(SNAPSHOT)) {
      expect(await at(project, 1)).toEqual(shallow(SNAPSHOT[project]!, 1))
      expect(await at(project, 2)).toEqual(shallow(SNAPSHOT[project]!, 2))
    }
    // The bundled mocks exercise both bounds.
    expect(shallow(SNAPSHOT['project-a']!, 1)).not.toEqual(SNAPSHOT['project-a'])
    expect(shallow(SNAPSHOT['project-b']!, 2)).not.toEqual(SNAPSHOT['project-b'])
  })
})
