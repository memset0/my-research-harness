// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { signSessionCookie, signSharesCookie } from './cookies'
import {
  type AccountLookup,
  type LookedUpAccount,
  resolveIdentity,
  type ShareValidator,
} from './identity'

const SECRET = 'test-secret'
const NOW = 1_700_000_000

function lookup(accounts: LookedUpAccount[]): AccountLookup {
  return { byId: async (id) => accounts.find((account) => account.id === id) ?? null }
}

const accounts = lookup([
  {
    id: 2,
    username: 'ada',
    level: 'admin',
    disabled: false,
    grants: [],
    adminProjects: [{ host: 'host-a', project: 'project-a' }],
  },
  {
    id: 3,
    username: 'bob',
    level: 'user',
    disabled: false,
    grants: [
      { host: 'host-a', project: 'project-a' },
      { host: 'host-a', project: 'project-b', document: { kind: 'wiki', id: 'W0002' } },
    ],
  },
  { id: 4, username: 'gil', level: 'guest', disabled: false, grants: [] },
  { id: 5, username: 'old', level: 'admin', disabled: true, grants: [] },
])

const auth = { username: 'owner', password: 'pw', sessionSecret: SECRET, accounts }
const noShares: ShareValidator = { validate: async () => false }

function session(payload: Parameters<typeof signSessionCookie>[0]) {
  return signSessionCookie(payload, SECRET)
}

async function resolve(
  cookie: string | null,
  extra: Partial<Parameters<typeof resolveIdentity>[0]> = {},
) {
  return resolveIdentity(
    {
      authorizationHeader: null,
      sessionCookieValue: cookie,
      sharesCookieValue: null,
      allowViewer: true,
      ...extra,
    },
    auth,
    extra.sharesCookieValue ? { validate: async () => true } : noShares,
    NOW,
  )
}

describe('account sessions', () => {
  it('treats a legacy owner cookie as account #1 and keeps refreshing it as v1', async () => {
    const identity = await resolve(session({ v: 1, role: 'owner', iat: NOW, exp: NOW + 60 }))
    expect(identity.role).toBe('owner')
    expect(identity.account).toEqual({ id: 1, username: 'owner', level: 'super_admin' })
    expect(identity.refreshedSessionCookie).not.toBeNull()
    const again = await resolve(identity.refreshedSessionCookie)
    expect(again.account?.id).toBe(1)
  })

  it('gives config Basic credentials account #1', async () => {
    const identity = await resolveIdentity(
      {
        authorizationHeader: `Basic ${Buffer.from('owner:pw').toString('base64')}`,
        sessionCookieValue: null,
        sharesCookieValue: null,
        allowViewer: false,
      },
      auth,
      noShares,
      NOW,
    )
    expect(identity.account).toEqual({ id: 1, username: 'owner', level: 'super_admin' })
  })

  it('maps an admin to a read-only viewer of its granted Projects', async () => {
    const identity = await resolve(session({ v: 2, uid: 2, iat: NOW, exp: NOW + 60 }))
    expect(identity.role).toBe('viewer')
    expect(identity.account).toEqual({ id: 2, username: 'ada', level: 'admin' })
    expect(identity.scopeProjectRefs).toEqual([{ host: 'host-a', project: 'project-a' }])
    expect(identity.ownerProjectRefs).toEqual([{ host: 'host-a', project: 'project-a' }])
  })

  it('maps a user to a viewer scoped to its grants', async () => {
    const identity = await resolve(session({ v: 2, uid: 3, iat: NOW, exp: NOW + 60 }))
    expect(identity.role).toBe('viewer')
    expect(identity.account?.level).toBe('user')
    expect(identity.scopeProjectRefs).toEqual([{ host: 'host-a', project: 'project-a' }])
    expect(identity.scopeDocuments).toEqual([
      { host: 'host-a', project: 'project-b', kind: 'wiki', id: 'W0002' },
    ])
    expect(identity.ownerProjectRefs).toEqual([])
  })

  it('gives a guest nothing but its share links', async () => {
    const bare = await resolve(session({ v: 2, uid: 4, iat: NOW, exp: NOW + 60 }))
    expect(bare.role).toBe('viewer')
    expect(bare.scopeProjectRefs).toEqual([])
    const shared = await resolve(session({ v: 2, uid: 4, iat: NOW, exp: NOW + 60 }), {
      sharesCookieValue: signSharesCookie(
        [{ host: 'host-a', project: 'project-c', token: 't1' }],
        SECRET,
      ),
    })
    expect(shared.scopeProjectRefs).toEqual([{ host: 'host-a', project: 'project-c' }])
    expect(shared.account?.username).toBe('gil')
  })

  it('refuses disabled, unknown and lookup-less accounts', async () => {
    for (const uid of [5, 99]) {
      const identity = await resolve(session({ v: 2, uid, iat: NOW, exp: NOW + 60 }))
      expect(identity.role).toBe('anon')
      expect(identity.account).toBeNull()
    }
    const withoutStore = await resolveIdentity(
      {
        authorizationHeader: null,
        sessionCookieValue: session({ v: 2, uid: 2, iat: NOW, exp: NOW + 60 }),
        sharesCookieValue: null,
        allowViewer: true,
      },
      { username: 'owner', password: 'pw', sessionSecret: SECRET },
      noShares,
      NOW,
    )
    expect(withoutStore.role).toBe('anon')
  })
})
