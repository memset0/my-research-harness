// @vitest-environment node

import type { AuthConfig } from '@memon/core'
import { describe, expect, it } from 'vitest'
import { parseBasicAuth, verifyBasic } from './basic-auth'

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
}

describe('parseBasicAuth', () => {
  it('parses well-formed header', () => {
    expect(parseBasicAuth(basic('admin', 'sekret'))).toEqual({
      username: 'admin',
      password: 'sekret',
    })
  })

  it('handles empty password', () => {
    expect(parseBasicAuth(basic('admin', ''))).toEqual({ username: 'admin', password: '' })
  })

  it('handles password containing colons', () => {
    expect(parseBasicAuth(basic('admin', 'a:b:c'))).toEqual({
      username: 'admin',
      password: 'a:b:c',
    })
  })

  it('returns null for missing/blank/non-Basic', () => {
    expect(parseBasicAuth(null)).toBeNull()
    expect(parseBasicAuth(undefined)).toBeNull()
    expect(parseBasicAuth('')).toBeNull()
    expect(parseBasicAuth('Bearer abc')).toBeNull()
    expect(parseBasicAuth('Basic ')).toBeNull()
  })

  it('returns null when decoded payload has no colon', () => {
    const b64 = Buffer.from('nocolon', 'utf8').toString('base64')
    expect(parseBasicAuth(`Basic ${b64}`)).toBeNull()
  })

  it('is case-insensitive on the scheme name', () => {
    expect(parseBasicAuth(basic('a', 'b'))).not.toBeNull()
    expect(parseBasicAuth(basic('a', 'b').replace('Basic', 'BASIC'))).not.toBeNull()
    expect(parseBasicAuth(basic('a', 'b').replace('Basic', 'basic'))).not.toBeNull()
  })
})

describe('verifyBasic', () => {
  const auth: AuthConfig = { username: 'admin', password: 'right-password' }

  it('returns true for matching user + password', async () => {
    expect(await verifyBasic({ username: 'admin', password: 'right-password' }, auth)).toBe(true)
  })

  it('returns false for wrong password (same length)', async () => {
    expect(await verifyBasic({ username: 'admin', password: 'wrong-password' }, auth)).toBe(false)
  })

  it('returns false for wrong password (different length)', async () => {
    expect(await verifyBasic({ username: 'admin', password: 'short' }, auth)).toBe(false)
  })

  it('returns false for wrong username', async () => {
    expect(await verifyBasic({ username: 'eve', password: 'right-password' }, auth)).toBe(false)
  })

  it('returns false for null parsed creds', async () => {
    expect(await verifyBasic(null, auth)).toBe(false)
  })
})
