// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  type AccountLevel,
  adminSectionsFor,
  hasAdminArea,
  isOwnerLevel,
  levelCan,
  levelMayReach,
  requiredCapabilities,
} from './capabilities'

const LEVELS: AccountLevel[] = ['super_admin', 'admin', 'user', 'guest']

describe('capability matrix', () => {
  it('matches the spec table', () => {
    const table = LEVELS.map((level) => [
      level,
      levelCan(level, 'manage_accounts'),
      levelCan(level, 'configure_instance'),
      levelCan(level, 'access_clusters'),
      levelCan(level, 'manage_project_grants'),
      isOwnerLevel(level),
    ])
    expect(table).toEqual([
      ['super_admin', true, true, true, true, true],
      ['admin', false, false, true, true, false],
      ['user', false, false, false, false, false],
      ['guest', false, false, false, false, false],
    ])
    expect(levelCan(null, 'access_clusters')).toBe(false)
  })
})

describe('path gating', () => {
  it.each([
    ['/manage/users', ['manage_accounts']],
    ['/api/admin/accounts/3/grants', ['manage_accounts']],
    ['/manage/file-access', ['configure_instance']],
    ['/api/file-access/restart', ['configure_instance']],
    ['/manage/clusters', ['access_clusters']],
    ['/api/clusters', ['access_clusters']],
    ['/api/gpu-pool/tickets', ['access_clusters']],
    ['/manage/projects', ['manage_project_grants']],
    ['/api/project-access', ['manage_project_grants']],
    ['/api/shares/shr_abc', ['manage_project_grants']],
    ['/manage/shares', ['manage_project_grants']],
    ['/manage', ['access_clusters', 'configure_instance', 'manage_project_grants']],
  ])('%s needs %j', (path, caps) => {
    expect(requiredCapabilities(path)).toEqual(caps)
  })

  it('leaves other paths and look-alike prefixes alone', () => {
    expect(requiredCapabilities('/api/projects')).toBeNull()
    expect(requiredCapabilities('/managed')).toBeNull()
    expect(requiredCapabilities('/api/clustersx')).toBeNull()
  })

  it('admits by level', () => {
    expect(levelMayReach('admin', '/api/clusters')).toBe(true)
    expect(levelMayReach('admin', '/manage/users')).toBe(false)
    expect(levelMayReach('admin', '/api/file-access')).toBe(false)
    expect(levelMayReach('user', '/api/clusters')).toBe(false)
    expect(levelMayReach('guest', '/manage')).toBe(false)
    expect(levelMayReach('super_admin', '/manage/users')).toBe(true)
  })

  it('builds the navbar per level', () => {
    expect(adminSectionsFor('super_admin').map((s) => s.key)).toEqual([
      'clusters',
      'users',
      'projects',
      'shares',
      'file-access',
    ])
    expect(adminSectionsFor('admin').map((s) => s.key)).toEqual(['clusters', 'projects', 'shares'])
    expect(hasAdminArea('admin')).toBe(true)
    expect(hasAdminArea('user')).toBe(false)
  })
})
