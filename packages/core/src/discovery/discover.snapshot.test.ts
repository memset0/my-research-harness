// Behaviour guard for the Run walk over the bundled mock projects. The fixture
// is the Run set of the unbounded FS v7 walk; the explicit audit walk must
// still reproduce it exactly, while the FS v8 default (no `run_dirs` from any
// source) discovers only its depth-one subset.

import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverRuns } from './discover.js'

const MOCK_ROOT = resolve(__dirname, '../../../../mock')
const SNAPSHOT = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/mock-discovery-snapshot.json'), 'utf8'),
) as Record<string, string[]>

const depth = (path: string) => path.split('/').length - 1

describe('discoverRuns over the mock projects', () => {
  for (const [project, expected] of Object.entries(SNAPSHOT)) {
    it(`the audit walk keeps the ${project} Run set and paths unchanged`, async () => {
      const root = resolve(MOCK_ROOT, project)
      const found = await discoverRuns(
        { name: project, root, include: [], exclude: [] },
        { unbounded: true },
      )
      expect(found.map((path) => relative(root, path))).toEqual(expected)
    })

    it(`the FS v8 default discovers the depth-one ${project} Runs`, async () => {
      const root = resolve(MOCK_ROOT, project)
      const found = await discoverRuns({ name: project, root, include: [], exclude: [] })
      expect(found.map((path) => relative(root, path))).toEqual(
        expected.filter((path) => depth(path) === 1),
      )
    })
  }

  it('expands run_dirs patterns over the mocks', async () => {
    const at = async (project: string, runDirs: string[]) => {
      const root = resolve(MOCK_ROOT, project)
      const found = await discoverRuns({ name: project, root, include: [], exclude: [], runDirs })
      return found.map((path) => relative(root, path))
    }
    for (const project of Object.keys(SNAPSHOT)) {
      expect(await at(project, ['logs/*'])).toEqual(
        SNAPSHOT[project]!.filter((path) => depth(path) === 1),
      )
      expect(await at(project, ['logs/*', 'logs/*/*', 'logs/*/*/*'])).toEqual(SNAPSHOT[project])
    }
    expect(await at('project-a', ['logs/sub/*'])).toEqual(['logs/sub/bar-260502-150000'])
  })
})
