// @vitest-environment node

import type { ProjectRef } from '@memon/core'
import { describe, expect, it, vi } from 'vitest'
import { signSharesCookie, verifySharesCookie } from './cookies'
import { resolveIdentity } from './identity'
import {
  encodeHostScopeHeader,
  HOST_SCOPE_HEADER,
  readIdentityFromRequest,
} from './request-context'

const SECRET = 'session-secret-for-tests'

describe('Host-qualified viewer identity', () => {
  it('validates v2 entries and returns exact ProjectRef scopes without legacy name scope', async () => {
    const cookie = signSharesCookie(
      [
        { host: 'host-a', project: 'project-x', token: 'token-a' },
        { host: 'host-b', project: 'project-x', token: 'token-b' },
      ],
      SECRET,
    )
    const validate = vi.fn(async (_project: string, token: string, host?: string) => {
      return host === 'host-a' && token === 'token-a'
    })
    const identity = await resolveIdentity(
      {
        authorizationHeader: null,
        sessionCookieValue: null,
        sharesCookieValue: cookie,
        allowViewer: true,
      },
      { username: 'admin', password: 'owner-password', sessionSecret: SECRET },
      { validate },
    )

    expect(identity.role).toBe('viewer')
    expect(identity.scopeProjects).toEqual(new Set())
    expect(identity.scopeProjectRefs).toEqual([{ host: 'host-a', project: 'project-x' }])
    expect(validate).toHaveBeenCalledWith('project-x', 'token-a', 'host-a')
    expect(validate).toHaveBeenCalledWith('project-x', 'token-b', 'host-b')
    expect(verifySharesCookie(identity.refreshedSharesCookie, SECRET)).toEqual({
      v: 2,
      entries: [{ host: 'host-a', project: 'project-x', token: 'token-a' }],
    })
  })

  it('preserves legacy standalone project-name scope independently', async () => {
    const cookie = signSharesCookie([{ project: 'project-x', token: 'legacy-token' }], SECRET)
    const identity = await resolveIdentity(
      {
        authorizationHeader: null,
        sessionCookieValue: null,
        sharesCookieValue: cookie,
        allowViewer: true,
      },
      { username: 'admin', password: 'owner-password', sessionSecret: SECRET },
      { validate: async (_project, _token, host) => host === undefined },
    )
    expect(identity.scopeProjects).toEqual(new Set(['project-x']))
    expect(identity.scopeProjectRefs).toEqual([])
  })
})

describe('trusted Host scope request header', () => {
  it('round-trips strict Host-qualified scopes beside legacy scope', () => {
    const scopes = [
      { host: 'host-a', project: 'project-x' },
      { host: 'host-b', project: 'project-x' },
    ] as ProjectRef[]
    const request = new Request('https://central.example.test/api/projects', {
      headers: {
        'x-memon-role': 'viewer',
        'x-memon-scope': 'legacy-project',
        [HOST_SCOPE_HEADER]: encodeHostScopeHeader(scopes),
      },
    })
    expect(readIdentityFromRequest(request)).toEqual({
      role: 'viewer',
      scopeProjects: new Set(['legacy-project']),
      scopeProjectRefs: scopes,
    })
  })

  it('fails closed on malformed, oversized, duplicate, or extra-field Host scopes', () => {
    const values = [
      'not+base64',
      'a'.repeat(8193),
      Buffer.from(
        JSON.stringify([
          { host: 'host-a', project: 'project-x' },
          { host: 'host-a', project: 'project-x' },
        ]),
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify([{ host: 'host-a', project: 'project-x', root: '/private' }]),
      ).toString('base64url'),
    ]
    for (const value of values) {
      const request = new Request('https://central.example.test/', {
        headers: { 'x-memon-role': 'viewer', [HOST_SCOPE_HEADER]: value },
      })
      expect(readIdentityFromRequest(request).scopeProjectRefs).toEqual([])
    }
  })
})
