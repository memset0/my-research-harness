import { describe, expect, it } from 'vitest'
import { resolveLegacyProject } from './legacy-project'

describe('resolveLegacyProject', () => {
  const projects = [
    { host: 'host-a', project: 'shared-project' },
    { host: 'host-b', project: 'shared-project' },
    { host: 'host-b', project: 'unique-project' },
  ] as never

  it('redirects only an exact unique live match', () => {
    expect(resolveLegacyProject('unique-project', projects)).toEqual({
      kind: 'unique',
      project: { host: 'host-b', project: 'unique-project' },
    })
  })

  it('returns an explicit ambiguous set instead of first-hit routing', () => {
    expect(resolveLegacyProject('shared-project', projects)).toEqual({
      kind: 'ambiguous',
      projects: [
        { host: 'host-a', project: 'shared-project' },
        { host: 'host-b', project: 'shared-project' },
      ],
    })
  })

  it('reports no live match without guessing from stale Host data', () => {
    expect(resolveLegacyProject('missing', projects)).toEqual({ kind: 'missing' })
  })
})
