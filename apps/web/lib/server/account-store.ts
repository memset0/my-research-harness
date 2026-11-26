import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { dirname, join } from '@memon/file-protocol/paths'
import sqlite3 from 'sqlite3'

export const ACCOUNTS_DB_FILENAME = 'memon-accounts.sqlite3'
export const SUPER_ADMIN_ID = 1

export const ACCOUNT_LEVELS = ['super_admin', 'admin', 'user', 'guest'] as const
export type AccountLevel = (typeof ACCOUNT_LEVELS)[number]
export type AssignableLevel = Exclude<AccountLevel, 'super_admin'>
export const ASSIGNABLE_LEVELS: readonly AssignableLevel[] = ['admin', 'user', 'guest']

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
export const MIN_PASSWORD_LENGTH = 8

export interface AccountGrant {
  host: string
  project: string
  /** Present for a document grant. */
  document?: { kind: 'report' | 'wiki'; id: string }
}

export interface ProjectGrant {
  username: string
  document?: { kind: 'report' | 'wiki'; id: string }
}

export interface Account {
  id: number
  username: string
  level: AccountLevel
  disabled: boolean
  createdAt: number
  updatedAt: number
  grants: AccountGrant[]
  /** Projects the super admin granted this admin to manage. */
  adminProjects: Array<{ host: string; project: string }>
}

export class AccountStoreError extends Error {
  constructor(
    readonly code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message)
  }
}

interface AccountRow {
  id: number
  username: string
  level: AccountLevel
  password_hash: string | null
  disabled: number
  created_at: number
  updated_at: number
}

interface AdminRow {
  host: string
  project: string
  account_id: number
}

interface GrantRow {
  account_id: number
  host: string
  project: string
  kind: string | null
  doc_id: string | null
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 } as const

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  N: number,
  r: number,
  p: number,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCb(password, salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.keyLength, SCRYPT.N, SCRYPT.r, SCRYPT.p)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPasswordHash(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [N, r, p] = parts.slice(1, 4).map(Number)
  if (![N, r, p].every((n) => Number.isInteger(n) && (n as number) > 0)) return false
  const salt = Buffer.from(parts[4] as string, 'base64url')
  const expected = Buffer.from(parts[5] as string, 'base64url')
  const key = await scrypt(password, salt, expected.length, N as number, r as number, p as number)
  return key.length === expected.length && timingSafeEqual(key, expected)
}

function validateGrant(grant: AccountGrant): AccountGrant {
  if (
    typeof grant.host !== 'string' ||
    !grant.host ||
    typeof grant.project !== 'string' ||
    !grant.project
  )
    throw new AccountStoreError('BAD_REQUEST', 'a grant needs host and project')
  if (grant.document) {
    const { kind, id } = grant.document
    if (
      (kind !== 'report' && kind !== 'wiki') ||
      typeof id !== 'string' ||
      !/^[RW]\d{1,6}$/.test(id)
    )
      throw new AccountStoreError(
        'BAD_REQUEST',
        'a document grant needs kind report|wiki and an id like R0003',
      )
    if ((kind === 'report') !== id.startsWith('R'))
      throw new AccountStoreError('BAD_REQUEST', 'document id prefix does not match its kind')
  }
  return grant
}

export class AccountStore {
  private readonly database: sqlite3.Database
  private readonly ready: Promise<void>
  private closed = false

  constructor(public readonly path: string) {
    this.database = new sqlite3.Database(path)
    this.database.configure('busyTimeout', 5000)
    const created = this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id            INTEGER PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        level         TEXT NOT NULL CHECK (level IN ('super_admin','admin','user','guest')),
        password_hash TEXT,
        disabled      INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_admins (
        host       TEXT NOT NULL,
        project    TEXT NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        PRIMARY KEY (host, project, account_id)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS account_grants (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        host       TEXT NOT NULL,
        project    TEXT NOT NULL,
        kind       TEXT,
        doc_id     TEXT,
        UNIQUE (account_id, host, project, kind, doc_id)
      );
    `)
    // Password hashes live here: keep the database and its WAL files owner-only.
    this.ready = created.then(() =>
      Promise.all(
        [path, `${path}-wal`, `${path}-shm`].map((file) =>
          chmod(file, 0o600).catch(() => undefined),
        ),
      ).then(() => undefined),
    )
  }

  /** Create or rename account #1 so it always mirrors `config.yml` `auth.username`. */
  async syncSuperAdmin(username: string): Promise<void> {
    await this.ready
    const now = Date.now()
    const clash = await this.row(`SELECT * FROM accounts WHERE username = ? AND id <> ?`, [
      username,
      SUPER_ADMIN_ID,
    ])
    if (clash) {
      // The configured owner name always wins over a stored account of the same name.
      await this.run(`UPDATE accounts SET disabled = 1, updated_at = ? WHERE id = ?`, [
        now,
        clash.id,
      ])
      await this.run(`UPDATE accounts SET username = ? WHERE id = ?`, [
        `${clash.username}.conflict-${clash.id}`.slice(0, 64),
        clash.id,
      ])
    }
    await this.run(
      `INSERT INTO accounts (id, username, level, password_hash, disabled, created_at, updated_at)
       VALUES (?, ?, 'super_admin', NULL, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         username = excluded.username, level = 'super_admin', password_hash = NULL, disabled = 0,
         updated_at = CASE WHEN accounts.username = excluded.username THEN accounts.updated_at ELSE excluded.updated_at END`,
      [SUPER_ADMIN_ID, username, now, now],
    )
  }

  async list(): Promise<Account[]> {
    await this.ready
    const rows = await this.all<AccountRow>(`SELECT * FROM accounts ORDER BY id`, [])
    const grants = await this.all<GrantRow>(`SELECT * FROM account_grants ORDER BY rowid`, [])
    const admins = await this.all<AdminRow>(
      `SELECT * FROM project_admins ORDER BY host, project`,
      [],
    )
    return rows.map((row) => this.toAccount(row, grants, admins))
  }

  async byId(id: number): Promise<Account | null> {
    await this.ready
    const row = await this.row(`SELECT * FROM accounts WHERE id = ?`, [id])
    if (!row) return null
    const grants = await this.all<GrantRow>(`SELECT * FROM account_grants WHERE account_id = ?`, [
      id,
    ])
    const admins = await this.all<AdminRow>(
      `SELECT * FROM project_admins WHERE account_id = ? ORDER BY host, project`,
      [id],
    )
    return this.toAccount(row, grants, admins)
  }

  /** Verify a stored account's password; account #1 never verifies here. */
  async verify(username: string, password: string): Promise<Account | null> {
    await this.ready
    const row = await this.row(`SELECT * FROM accounts WHERE username = ?`, [username])
    if (!row || row.id === SUPER_ADMIN_ID || !row.password_hash || row.disabled) return null
    if (!(await verifyPasswordHash(password, row.password_hash))) return null
    return this.byId(row.id)
  }

  async create(input: {
    username: string
    password: string
    level: AssignableLevel
  }): Promise<Account> {
    await this.ready
    if (!USERNAME_PATTERN.test(input.username))
      throw new AccountStoreError('BAD_REQUEST', 'username must match [A-Za-z0-9._-]{1,64}')
    if (!ASSIGNABLE_LEVELS.includes(input.level))
      throw new AccountStoreError('BAD_REQUEST', 'level must be admin, user or guest')
    this.checkPassword(input.password)
    if (await this.row(`SELECT * FROM accounts WHERE username = ?`, [input.username]))
      throw new AccountStoreError('CONFLICT', `account ${input.username} already exists`)
    const hash = await hashPassword(input.password)
    const now = Date.now()
    const id = await new Promise<number>((resolve, reject) => {
      this.database.run(
        `INSERT INTO accounts (username, level, password_hash, disabled, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [input.username, input.level, hash, now, now],
        function (this: sqlite3.RunResult, error) {
          if (error) reject(error)
          else resolve(this.lastID)
        },
      )
    }).catch((error: Error) => {
      if (/UNIQUE/.test(error.message))
        throw new AccountStoreError('CONFLICT', `account ${input.username} already exists`)
      throw error
    })
    // Rows below id 2 are reserved for the configured super admin.
    if (id === SUPER_ADMIN_ID) {
      await this.run(`DELETE FROM accounts WHERE id = ?`, [id])
      throw new AccountStoreError('CONFLICT', 'the super admin has not been initialised yet')
    }
    return (await this.byId(id)) as Account
  }

  async update(
    id: number,
    patch: { level?: AssignableLevel; disabled?: boolean; password?: string },
  ): Promise<Account> {
    await this.ready
    if (id === SUPER_ADMIN_ID)
      throw new AccountStoreError('BAD_REQUEST', 'the super admin is managed through config.yml')
    const existing = await this.row(`SELECT * FROM accounts WHERE id = ?`, [id])
    if (!existing) throw new AccountStoreError('NOT_FOUND', `account ${id} does not exist`)
    if (patch.level !== undefined && !ASSIGNABLE_LEVELS.includes(patch.level))
      throw new AccountStoreError('BAD_REQUEST', 'level must be admin, user or guest')
    if (patch.password !== undefined) this.checkPassword(patch.password)
    const now = Date.now()
    if (patch.level !== undefined) {
      await this.run(`UPDATE accounts SET level = ?, updated_at = ? WHERE id = ?`, [
        patch.level,
        now,
        id,
      ])
      if (patch.level !== 'user')
        await this.run(`DELETE FROM account_grants WHERE account_id = ?`, [id])
      if (patch.level !== 'admin')
        await this.run(`DELETE FROM project_admins WHERE account_id = ?`, [id])
    }
    if (patch.disabled !== undefined)
      await this.run(`UPDATE accounts SET disabled = ?, updated_at = ? WHERE id = ?`, [
        patch.disabled ? 1 : 0,
        now,
        id,
      ])
    if (patch.password !== undefined)
      await this.run(`UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?`, [
        await hashPassword(patch.password),
        now,
        id,
      ])
    return (await this.byId(id)) as Account
  }

  async replaceGrants(id: number, grants: AccountGrant[]): Promise<Account> {
    await this.ready
    const existing = await this.row(`SELECT * FROM accounts WHERE id = ?`, [id])
    if (!existing) throw new AccountStoreError('NOT_FOUND', `account ${id} does not exist`)
    if (existing.level !== 'user')
      throw new AccountStoreError('BAD_REQUEST', 'only user accounts hold grants')
    if (grants.length > 256) throw new AccountStoreError('BAD_REQUEST', 'at most 256 grants')
    const valid = grants.map(validateGrant)
    await this.exec('BEGIN IMMEDIATE')
    try {
      await this.run(`DELETE FROM account_grants WHERE account_id = ?`, [id])
      for (const grant of valid)
        await this.run(
          `INSERT OR IGNORE INTO account_grants (account_id, host, project, kind, doc_id) VALUES (?, ?, ?, ?, ?)`,
          [id, grant.host, grant.project, grant.document?.kind ?? null, grant.document?.id ?? null],
        )
      await this.run(`UPDATE accounts SET updated_at = ? WHERE id = ?`, [Date.now(), id])
      await this.exec('COMMIT')
    } catch (error) {
      await this.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
    return (await this.byId(id)) as Account
  }

  /** Grant or revoke an admin's management of one Project (super admin only). */
  async changeProjectAdmin(
    action: 'add' | 'remove',
    host: string,
    project: string,
    username: string,
  ): Promise<void> {
    await this.ready
    if (!host || !project)
      throw new AccountStoreError('BAD_REQUEST', 'host and project are required')
    const row = await this.row(`SELECT * FROM accounts WHERE username = ?`, [username])
    if (!row || row.level !== 'admin')
      throw new AccountStoreError('BAD_REQUEST', `${username} is not an admin account`)
    if (action === 'add')
      await this.run(
        `INSERT OR IGNORE INTO project_admins (host, project, account_id) VALUES (?, ?, ?)`,
        [host, project, row.id],
      )
    else
      await this.run(
        `DELETE FROM project_admins WHERE host = ? AND project = ? AND account_id = ?`,
        [host, project, row.id],
      )
  }

  /** Every Project-admin grant, for the super admin. */
  async projectAdmins(): Promise<Array<{ host: string; project: string; username: string }>> {
    await this.ready
    return this.all(
      `SELECT p.host, p.project, a.username FROM project_admins p JOIN accounts a ON a.id = p.account_id
        ORDER BY p.host, p.project, a.username`,
      [],
    )
  }

  /** The user grants on one Project, as `{username, document?}` (for its admins' view). */
  async grantsOn(host: string, project: string): Promise<ProjectGrant[]> {
    await this.ready
    const rows = await this.all<{ username: string; kind: string | null; doc_id: string | null }>(
      `SELECT a.username, g.kind, g.doc_id FROM account_grants g JOIN accounts a ON a.id = g.account_id
        WHERE g.host = ? AND g.project = ? ORDER BY a.username, g.kind, g.doc_id`,
      [host, project],
    )
    return rows.map((row) => ({
      username: row.username,
      ...(row.kind && row.doc_id
        ? { document: { kind: row.kind as 'report' | 'wiki', id: row.doc_id } }
        : {}),
    }))
  }

  /**
   * Add or remove one grant naming a user account by its exact username. Unknown,
   * disabled and non-user names fail identically, so a caller learns nothing about them.
   */
  async changeGrantByUsername(
    action: 'add' | 'remove',
    username: string,
    grant: AccountGrant,
  ): Promise<void> {
    await this.ready
    validateGrant(grant)
    const row = await this.row(`SELECT * FROM accounts WHERE username = ?`, [username])
    if (!row || row.level !== 'user' || row.disabled)
      throw new AccountStoreError('BAD_REQUEST', 'cannot grant access to that name')
    const params = [
      row.id,
      grant.host,
      grant.project,
      grant.document?.kind ?? null,
      grant.document?.id ?? null,
    ]
    if (action === 'add')
      await this.run(
        `INSERT OR IGNORE INTO account_grants (account_id, host, project, kind, doc_id) VALUES (?, ?, ?, ?, ?)`,
        params,
      )
    else
      await this.run(
        `DELETE FROM account_grants WHERE account_id = ? AND host = ? AND project = ?
           AND kind IS ? AND doc_id IS ?`,
        params,
      )
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined)
    if (this.closed) return
    await new Promise<void>((resolve, reject) => {
      this.database.close((error) => {
        if (error) reject(error)
        else {
          this.closed = true
          resolve()
        }
      })
    })
  }

  private checkPassword(password: string): void {
    if (
      typeof password !== 'string' ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > 1024
    )
      throw new AccountStoreError(
        'BAD_REQUEST',
        `password must be ${MIN_PASSWORD_LENGTH}–1024 characters`,
      )
  }

  private toAccount(row: AccountRow, grants: GrantRow[], admins: AdminRow[]): Account {
    return {
      id: row.id,
      username: row.username,
      level: row.level,
      disabled: row.disabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      grants: grants
        .filter((grant) => grant.account_id === row.id)
        .map((grant) => ({
          host: grant.host,
          project: grant.project,
          ...(grant.kind && grant.doc_id
            ? { document: { kind: grant.kind as 'report' | 'wiki', id: grant.doc_id } }
            : {}),
        })),
      adminProjects: admins
        .filter((admin) => admin.account_id === row.id)
        .map((admin) => ({ host: admin.host, project: admin.project })),
    }
  }

  private row(sql: string, params: unknown[]): Promise<AccountRow | undefined> {
    return new Promise((resolve, reject) => {
      this.database.get(sql, params, (error, result: AccountRow | undefined) => {
        if (error) reject(error)
        else resolve(result)
      })
    })
  }

  private all<T>(sql: string, params: unknown[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.database.all(sql, params, (error, rows: T[]) => {
        if (error) reject(error)
        else resolve(rows)
      })
    })
  }

  private run(sql: string, params: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.database.run(sql, params, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private exec(sql: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.database.exec(sql, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

const stores = new Map<string, { store: AccountStore; synced: Promise<void>; owner: string }>()

export function accountsDatabasePath(configPath: string): string {
  return join(dirname(configPath), ACCOUNTS_DB_FILENAME)
}

/** One connection per config directory, with account #1 synced to the configured owner. */
export async function getAccountStore(
  configPath: string,
  ownerUsername: string,
): Promise<AccountStore> {
  const path = accountsDatabasePath(configPath)
  let entry = stores.get(path)
  if (!entry) {
    const store = new AccountStore(path)
    entry = { store, synced: store.syncSuperAdmin(ownerUsername), owner: ownerUsername }
    stores.set(path, entry)
  } else if (entry.owner !== ownerUsername) {
    entry.owner = ownerUsername
    entry.synced = entry.store.syncSuperAdmin(ownerUsername)
  }
  await entry.synced
  return entry.store
}

/** Identity-resolution view of the store, opened lazily on first lookup. */
export function createAccountLookup(
  configPath: string,
  ownerUsername: string,
): { byId(id: number): Promise<Account | null> } {
  return {
    byId: async (id) => (await getAccountStore(configPath, ownerUsername)).byId(id),
  }
}

export async function closeAccountStores(): Promise<void> {
  await Promise.all(Array.from(stores.values(), (entry) => entry.store.close()))
  stores.clear()
}
