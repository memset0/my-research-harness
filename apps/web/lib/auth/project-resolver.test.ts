// @vitest-environment node

import { expect, it, vi } from 'vitest'
import { makeProjectResolver } from './project-resolver'

it('resolves a wiki id from the warmed per-Project wiki cache', () => {
  const getWikiSummary = vi.fn((project: string, id: string) =>
    project === 'project-b' && id === 'W0007' ? { id } : null,
  )
  const resolver = makeProjectResolver({
    config: {
      projects: [
        { name: 'project-a', root: '/projects/a' },
        { name: 'project-b', root: '/projects/b' },
      ],
    },
    wikiCache: { getWikiSummary },
  } as never)

  expect(resolver.resolveByWikiId('W0007')).toBe('project-b')
  expect(resolver.resolveByWikiId('W9999')).toBeNull()
  expect(getWikiSummary).toHaveBeenCalledWith('project-a', 'W0007')
  expect(getWikiSummary).toHaveBeenCalledWith('project-b', 'W0007')
})
