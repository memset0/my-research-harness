// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { Config } from '@memon/core'
import { PathSafetyError, assertWithinProjectRoots } from './path-safety'

const config: Config = {
  projects: [
    { name: 'a', root: '/repos/project-a', exclude: [] },
    { name: 'b', root: '/repos/project-b', exclude: [] },
  ],
  // biome-ignore lint/suspicious/noExplicitAny: minimal Config for tests
} as any

describe('assertWithinProjectRoots', () => {
  it('returns resolved path when inside a project root', () => {
    const r = assertWithinProjectRoots('/repos/project-a/logs/foo/README.md', config)
    expect(r).toBe('/repos/project-a/logs/foo/README.md')
  })

  it('returns resolved path when path is exactly the root', () => {
    expect(assertWithinProjectRoots('/repos/project-a', config)).toBe('/repos/project-a')
  })

  it('throws PathSafetyError for /etc/passwd', () => {
    expect(() => assertWithinProjectRoots('/etc/passwd', config)).toThrowError(
      PathSafetyError,
    )
  })

  it('throws for sibling directories that share a prefix but not the root', () => {
    expect(() =>
      assertWithinProjectRoots('/repos/project-a-evil/secret', config),
    ).toThrowError(PathSafetyError)
  })

  it('normalizes ../ traversal attempts', () => {
    expect(() =>
      assertWithinProjectRoots('/repos/project-a/../etc/passwd', config),
    ).toThrowError(PathSafetyError)
  })
})
