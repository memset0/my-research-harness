import { describe, expect, it } from 'vitest'
import { resolveRoute } from './route-resolver'

// Runs against the real apps/web/app/api tree.
describe('resolveRoute', () => {
  it('resolves a static route', () => {
    const r = resolveRoute('/api/runs')
    expect(r?.filePath).toMatch(/app\/api\/runs\/route\.ts$/)
    expect(r?.params).toEqual({})
  })

  it('resolves a single dynamic segment', () => {
    const r = resolveRoute('/api/runs/foo-260501-100000')
    expect(r?.filePath).toMatch(/app\/api\/runs\/\[id\]\/route\.ts$/)
    expect(r?.params).toEqual({ id: 'foo-260501-100000' })
  })

  it('resolves a nested dynamic + static path', () => {
    const r = resolveRoute('/api/projects/project-a/git-diff')
    expect(r?.filePath).toMatch(/projects\/\[project\]\/git-diff\/route\.ts$/)
    expect(r?.params).toEqual({ project: 'project-a' })
  })

  it('resolves the Experiment Results snapshot route', () => {
    const r = resolveRoute('/api/experiments/E0001-demo/results')
    expect(r?.filePath).toMatch(/experiments\/\[id\]\/results\/route\.ts$/)
    expect(r?.params).toEqual({ id: 'E0001-demo' })
  })

  it('returns null for an unknown path', () => {
    expect(resolveRoute('/api/definitely-not-a-route-xyz')).toBeNull()
  })

  it('returns null for a non-/api path', () => {
    expect(resolveRoute('/p/project-a')).toBeNull()
  })
})
