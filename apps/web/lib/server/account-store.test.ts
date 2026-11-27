// @vitest-environment node
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  accountsDatabasePath,
  closeAccountStores,
  createAccountLookup,
  getAccountStore,
  hashPassword,
  verifyPasswordHash,
} from './account-store'

let dir: string
let configPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memon-accounts-'))
  configPath = join(dir, 'config.yml')
})

afterEach(async () => {
  await closeAccountStores()
  await rm(dir, { recursive: true, force: true })
})

describe('password hashes', () => {
  it('verifies only the right password', async () => {
    const hash = await hashPassword('correct horse')
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/)
    expect(await verifyPasswordHash('correct horse', hash)).toBe(true)
    expect(await verifyPasswordHash('wrong horse', hash)).toBe(false)
    expect(await verifyPasswordHash('x', 'plain')).toBe(false)
  })
})

describe('account store', () => {
  it('lives next to config.yml and seeds account #1 from the configured owner', async () => {
    const store = await getAccountStore(configPath, 'owner')
    expect(store.path).toBe(accountsDatabasePath(configPath))
    expect(store.path).toBe(join(dir, 'memon-accounts.sqlite3'))
    expect((await stat(store.path)).mode & 0o777).toBe(0o600)
    expect((await store.list()).map((a) => [a.id, a.username, a.level])).toEqual([
      [1, 'owner', 'super_admin'],
    ])
    const renamed = await getAccountStore(configPath, 'owner2')
    expect((await renamed.byId(1))?.username).toBe('owner2')
  })

  it('creates, verifies and rejects duplicates', async () => {
    const store = await getAccountStore(configPath, 'owner')
    const bob = await store.create({ username: 'bob', password: 'password1', level: 'user' })
    expect(bob).toMatchObject({ username: 'bob', level: 'user', disabled: false, grants: [] })
    expect(bob.id).toBeGreaterThan(1)
    expect((await store.verify('bob', 'password1'))?.id).toBe(bob.id)
    expect(await store.verify('bob', 'nope-nope')).toBeNull()
    await expect(
      store.create({ username: 'bob', password: 'password2', level: 'guest' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(
      store.create({ username: 'owner', password: 'password2', level: 'guest' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(
      store.create({ username: 'bad name', password: 'password2', level: 'user' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(
      store.create({ username: 'eve', password: 'short', level: 'user' }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(
      store.create({ username: 'eve', password: 'password1', level: 'super_admin' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('never verifies or edits account #1', async () => {
    const store = await getAccountStore(configPath, 'owner')
    expect(await store.verify('owner', 'anything')).toBeNull()
    await expect(store.update(1, { level: 'guest' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(store.update(1, { disabled: true })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('disables, resets passwords and drops grants when the level changes', async () => {
    const store = await getAccountStore(configPath, 'owner')
    const bob = await store.create({ username: 'bob', password: 'password1', level: 'user' })
    const granted = await store.replaceGrants(bob.id, [
      { host: 'host-a', project: 'project-a' },
      { host: 'host-a', project: 'project-b', document: { kind: 'report', id: 'R0003' } },
    ])
    expect(granted.grants).toEqual([
      { host: 'host-a', project: 'project-a' },
      { host: 'host-a', project: 'project-b', document: { kind: 'report', id: 'R0003' } },
    ])
    await expect(
      store.replaceGrants(bob.id, [
        { host: 'h', project: 'p', document: { kind: 'wiki', id: 'R1' } },
      ]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    expect((await store.update(bob.id, { disabled: true })).disabled).toBe(true)
    expect(await store.verify('bob', 'password1')).toBeNull()
    await store.update(bob.id, { disabled: false, password: 'password9' })
    expect(await store.verify('bob', 'password1')).toBeNull()
    expect((await store.verify('bob', 'password9'))?.id).toBe(bob.id)

    const guest = await store.update(bob.id, { level: 'guest' })
    expect(guest.grants).toEqual([])
    await expect(store.replaceGrants(bob.id, [{ host: 'h', project: 'p' }])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    await expect(store.update(999, { disabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('renames a stored account that collides with a renamed owner', async () => {
    const store = await getAccountStore(configPath, 'owner')
    const alice = await store.create({ username: 'alice', password: 'password1', level: 'admin' })
    await getAccountStore(configPath, 'alice')
    const moved = await store.byId(alice.id)
    expect(moved?.username).toBe(`alice.conflict-${alice.id}`)
    expect(moved?.disabled).toBe(true)
    expect((await store.byId(1))?.username).toBe('alice')
  })

  it('grants user access by exact username', async () => {
    const store = await getAccountStore(configPath, 'owner')
    await store.create({ username: 'ada', password: 'password1', level: 'admin' })
    await store.create({ username: 'bob', password: 'password1', level: 'user' })
    await store.create({ username: 'gil', password: 'password1', level: 'guest' })

    const ref = { host: 'host-a', project: 'project-a' }
    await store.changeGrantByUsername('add', 'bob', ref)
    await store.changeGrantByUsername('add', 'bob', {
      ...ref,
      document: { kind: 'report', id: 'R0002' },
    })
    expect(await store.grantsOn('host-a', 'project-a')).toEqual([
      { username: 'bob' },
      { username: 'bob', document: { kind: 'report', id: 'R0002' } },
    ])
    await store.changeGrantByUsername('remove', 'bob', ref)
    expect(await store.grantsOn('host-a', 'project-a')).toEqual([
      { username: 'bob', document: { kind: 'report', id: 'R0002' } },
    ])

    // Unknown, guest, admin and super-admin names fail identically.
    const failures = await Promise.all(
      ['nobody', 'gil', 'ada', 'owner'].map((name) =>
        store.changeGrantByUsername('add', name, ref).then(
          () => null,
          (error: Error) => error.message,
        ),
      ),
    )
    expect(new Set(failures)).toEqual(new Set(['cannot grant access to that name']))
  })

  it('drops retired Project-admin grants and gives admins every configured Project', async () => {
    const sqlite3 = (await import('sqlite3')).default
    const path = accountsDatabasePath(configPath)
    const legacy = new sqlite3.Database(path)
    await new Promise<void>((resolve, reject) =>
      legacy.exec(
        `CREATE TABLE project_admins (host TEXT, project TEXT, account_id INTEGER);
         INSERT INTO project_admins VALUES ('host-a', 'project-a', 2);`,
        (error) => (error ? reject(error) : resolve()),
      ),
    )
    await new Promise<void>((resolve) => legacy.close(() => resolve()))

    const store = await getAccountStore(configPath, 'owner')
    const ada = await store.create({ username: 'ada', password: 'password1', level: 'admin' })
    const bob = await store.create({ username: 'bob', password: 'password1', level: 'user' })
    const tables = await new Promise<string[]>((resolve, reject) => {
      const db = new sqlite3.Database(path)
      db.all(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
        (error, rows: Array<{ name: string }>) => {
          db.close()
          if (error) reject(error)
          else resolve(rows.map((row) => row.name))
        },
      )
    })
    expect(tables).not.toContain('project_admins')

    const projects = [
      { host: 'host-a', project: 'project-a' },
      { host: 'host-b', project: 'project-b' },
    ]
    const lookup = createAccountLookup(configPath, 'owner', () => projects)
    expect((await lookup.byId(ada.id))?.adminProjects).toEqual(projects)
    expect((await lookup.byId(bob.id))?.adminProjects).toBeUndefined()
  })
})
