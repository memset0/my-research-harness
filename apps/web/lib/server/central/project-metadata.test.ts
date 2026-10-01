// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { applyCentralProjectTitle, centralProjectTitle } from './project-metadata'

describe('central Project metadata', () => {
  it('distinguishes equal Project names on different Hosts', () => {
    const a = centralProjectTitle({ host: 'host-a', project: 'shared' })!
    const b = centralProjectTitle({ host: 'host-b', project: 'shared' })!
    expect(a.default).toBe('host-a/shared')
    expect(b.default).toBe('host-b/shared')
    expect(applyCentralProjectTitle(a.template, 'R0001 · Reports')).toBe(
      'R0001 · Reports · host-a/shared · memon',
    )
    expect(applyCentralProjectTitle(b.template, 'R0001 · Reports')).toBe(
      'R0001 · Reports · host-b/shared · memon',
    )
  })

  it('rejects malformed Host-qualified identity', () => {
    expect(centralProjectTitle({ project: 'shared' })).toBeNull()
    expect(centralProjectTitle({ host: 'Host A', project: 'shared' })).toBeNull()
  })
})
