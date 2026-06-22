import type { HubConfig } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { authenticateNodeToken } from './node-auth'

const hub: HubConfig = {
  bindAddr: '127.0.0.1',
  bindPort: 3737,
  nodes: [
    { name: 'm2', authToken: 'token-m2' },
    { name: 'nvl72', authToken: 'token-nvl72' },
  ],
}

describe('authenticateNodeToken', () => {
  it('returns the node name for a valid Bearer token', () => {
    expect(authenticateNodeToken('Bearer token-nvl72', hub)).toBe('nvl72')
  })

  it('is case-insensitive on the Bearer scheme', () => {
    expect(authenticateNodeToken('bearer token-m2', hub)).toBe('m2')
  })

  it('returns null for an unknown token', () => {
    expect(authenticateNodeToken('Bearer nope', hub)).toBeNull()
  })

  it('returns null for a missing or non-Bearer header', () => {
    expect(authenticateNodeToken(undefined, hub)).toBeNull()
    expect(authenticateNodeToken('Basic abc', hub)).toBeNull()
  })
})
