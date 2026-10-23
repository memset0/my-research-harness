// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assertHostQualifiedWebConfig } from './web-config'

describe('Web entry configuration', () => {
  it('refuses a Project without a Host', () => {
    expect(() =>
      assertHostQualifiedWebConfig({
        projects: [{ name: 'project-a', root: '/tmp/project-a' }] as never,
      }),
    ).toThrow(/standalone Web serving was removed; give Project "project-a" a `host:`/)
  })

  it('accepts Host-qualified Projects and an empty list', () => {
    expect(() =>
      assertHostQualifiedWebConfig({
        projects: [{ name: 'project-a', root: '/tmp/project-a', host: 'host-a' }] as never,
      }),
    ).not.toThrow()
    expect(() => assertHostQualifiedWebConfig({ projects: [] })).not.toThrow()
  })
})
