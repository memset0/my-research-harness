// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { canAccessClusters } from '../cluster/access'
import type { RequestAccount, RequestIdentity } from './request-context'

function identity(role: RequestIdentity['role'], level?: RequestAccount['level']): RequestIdentity {
  return {
    role,
    scopeProjects: new Set(),
    scopeProjectRefs: [],
    ...(level ? { account: { id: 2, username: 'x', level } } : {}),
  }
}

describe('canAccessClusters', () => {
  it('admits admins and the super admin only', () => {
    expect(canAccessClusters(identity('owner', 'super_admin'))).toBe(true)
    expect(canAccessClusters(identity('viewer', 'admin'))).toBe(true)
    expect(canAccessClusters(identity('viewer', 'user'))).toBe(false)
    expect(canAccessClusters(identity('viewer', 'guest'))).toBe(false)
    expect(canAccessClusters(identity('viewer'))).toBe(false)
    expect(canAccessClusters(identity('anon'))).toBe(false)
  })
})
