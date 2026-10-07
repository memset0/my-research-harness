// @vitest-environment node
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { makeProjectResolver, resolveRequestProject } from './project-resolver'

afterEach(removeTempDirs)
it('classifies before authentication without consulting legacy caches', () => {
  const lookup = vi.fn(() => {
    throw new Error('legacy cache must not be accessed')
  })
  const resolver = makeProjectResolver({
    config: { projects: [{ name: 'project-a' }] },
    wikiCache: { getWikiSummary: lookup },
  } as never)
  expect(resolver.resolveByWikiId('W0007')).toBeNull()
  expect(lookup).not.toHaveBeenCalled()
  expect(resolver.isKnownProject('project-a')).toBe(true)
})
it('resolves authenticated legacy Wiki identities on demand and rejects ambiguity', async () => {
  const files = {
    'docs/wiki/finding/W0007-example.md': '---\nid: W0007\nkind: finding\ntitle: Example\n---\n',
  }
  const first = await createTempProject({ files })
  const second = await createTempProject({ files })
  const config = {
    projects: [{ name: 'project-a', root: first.root, storage: 'local', include: [], exclude: [] }],
    slurm: { totalNodes: -1 },
  }
  const runtime = { config } as never
  expect(
    await resolveRequestProject(runtime, 'GET', '/api/wiki/W0007', new URLSearchParams()),
  ).toBe('project-a')
  config.projects.push({
    name: 'project-b',
    root: second.root,
    storage: 'local',
    include: [],
    exclude: [],
  })
  expect(
    await resolveRequestProject(runtime, 'GET', '/api/wiki/W0007', new URLSearchParams()),
  ).toBeNull()
})
