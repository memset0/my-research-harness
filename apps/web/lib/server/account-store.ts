import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
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
}

/** An API token as listed: never its value. Times are epoch milliseconds. */
export interface ApiToken {
  id: number
  accountId: number
  username: string
  name: string
  /** The first characters of the value, enough to recognise it. */
  prefix: string
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
}

interface ApiTokenRow {
  id: number
  account_id: number
  username: string
  name: string
  prefix: string
  created_at: number
  expires_at: number | null
  last_used_at: number | null
}

export const API_TOKEN_PATTERN = /^mtk_[A-Za-z0-9_-]{43}$/
const TOKEN_PREFIX_LENGTH = 12
/** Last-use writes happen at most this often per token. */
const TOKEN_TOUCH_INTERVAL_MS = 60_000

function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
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
      -- Admins reach every Project, so per-Project admin grants are retired.
      DROP TABLE IF EXISTS project_admins;
      CREATE TABLE IF NOT EXISTS api_tokens (
        id           INTEGER PRIMARY KEY,
        account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        hash         TEXT NOT NULL UNIQUE,
        prefix       TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        expires_at   INTEGER,
        last_used_at INTEGER
      );
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
    return rows.map((row) => this.toAccount(row, grants))
  }

  async byId(id: number): Promise<Account | null> {
    await this.ready
    const row = await this.row(`SELECT * FROM accounts WHERE id = ?`, [id])
    if (!row) return null
    const grants = await this.all<GrantRow>(`SELECT * FROM account_grants WHERE account_id = ?`, [
      id,
    ])
    return this.toAccount(row, grants)
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
    // A token carries its account's reach, so any change of reach or status revokes it.
    if ((patch.level !== undefined && patch.level !== existing.level) || patch.disabled === true)
      await this.run(`DELETE FROM api_tokens WHERE account_id = ?`, [id])
    if (patch.level !== undefined) {
      await this.run(`UPDATE accounts SET level = ?, updated_at = ? WHERE id = ?`, [
        patch.level,
        now,
        id,
      ])
      if (patch.level !== 'user')
        await this.run(`DELETE FROM account_grants WHERE account_id = ?`, [id])
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

  /** Create a token for an account; the value is returned here and never again. */
  async createToken(
    accountId: number,
    name: string,
    expiresAt: number | null,
    now = Date.now(),
  ): Promise<{ token: ApiToken; value: string }> {
    await this.ready
    if (typeof name !== 'string' || name.trim().length < 1 || name.length > 64)
      throw new AccountStoreError('BAD_REQUEST', 'token name must be 1–64 characters')
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now))
      throw new AccountStoreError('BAD_REQUEST', 'expires_at must be in the future')
    const account = await this.row(`SELECT * FROM accounts WHERE id = ?`, [accountId])
    if (!account || account.disabled)
      throw new AccountStoreError('NOT_FOUND', `account ${accountId} does not exist`)
    if (account.level === 'guest')
      throw new AccountStoreError('BAD_REQUEST', 'guest accounts cannot hold API tokens')
    const value = `mtk_${randomBytes(32).toString('base64url')}`
    const id = await new Promise<number>((resolve, reject) => {
      this.database.run(
        `INSERT INTO api_tokens (account_id, name, hash, prefix, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          name.trim(),
          tokenHash(value),
          value.slice(0, TOKEN_PREFIX_LENGTH),
          now,
          expiresAt,
        ],
        function (this: sqlite3.RunResult, error) {
          if (error) reject(error)
          else resolve(this.lastID)
        },
      )
    })
    const [token] = await this.tokens({ id })
    return { token: token as ApiToken, value }
  }

  /** Tokens of one account, or of every account when `accountId` is omitted. */
  async listTokens(accountId?: number): Promise<ApiToken[]> {
    await this.ready
    return this.tokens(accountId === undefined ? {} : { accountId })
  }

  /** Revoke a token; with `accountId`, only if that account holds it. False when nothing matched. */
  async revokeToken(id: number, accountId?: number): Promise<boolean> {
    await this.ready
    const [token] = await this.tokens({ id })
    if (!token || (accountId !== undefined && token.accountId !== accountId)) return false
    await this.run(`DELETE FROM api_tokens WHERE id = ?`, [id])
    return true
  }

  /**
   * The enabled account a token value authenticates, or null for an unknown,
   * expired or malformed value. Records the use at most once a minute.
   */
  async accountForToken(value: string, now = Date.now()): Promise<Account | null> {
    await this.ready
    if (!API_TOKEN_PATTERN.test(value)) return null
    const rows = await this.all<{
      id: number
      account_id: number
      expires_at: number | null
      last_used_at: number | null
    }>(`SELECT id, account_id, expires_at, last_used_at FROM api_tokens WHERE hash = ?`, [
      tokenHash(value),
    ])
    const row = rows[0]
    if (!row || (row.expires_at !== null && row.expires_at <= now)) return null
    const account = await this.byId(row.account_id)
    if (!account || account.disabled) return null
    if (row.last_used_at === null || now - row.last_used_at >= TOKEN_TOUCH_INTERVAL_MS)
      await this.run(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`, [now, row.id])
    return account
  }

  private async tokens(filter: { id?: number; accountId?: number }): Promise<ApiToken[]> {
    const where =
      filter.id !== undefined
        ? 'WHERE t.id = ?'
        : filter.accountId !== undefined
          ? 'WHERE t.account_id = ?'
          : ''
    const params =
      filter.id !== undefined
        ? [filter.id]
        : filter.accountId !== undefined
          ? [filter.accountId]
          : []
    const rows = await this.all<ApiTokenRow>(
      `SELECT t.id, t.account_id, a.username, t.name, t.prefix, t.created_at, t.expires_at, t.last_used_at
         FROM api_tokens t JOIN accounts a ON a.id = t.account_id ${where} ORDER BY t.id`,
      params,
    )
    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      username: row.username,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastUsedAt: row.last_used_at,
    }))
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

  private toAccount(row: AccountRow, grants: GrantRow[]): Account {
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

/**
 * Identity-resolution view of the store, opened lazily on first lookup. Admins
 * reach every configured Project, which `projects` lists at lookup time.
 */
export function createAccountLookup(
  configPath: string,
  ownerUsername: string,
  projects: () => Array<{ host: string; project: string }>,
): {
  byId(id: number): Promise<LookedUp | null>
  byToken(value: string): Promise<LookedUp | null>
} {
  const withReach = (account: Account | null): LookedUp | null =>
    account && account.level === 'admin' ? { ...account, adminProjects: projects() } : account
  return {
    byId: async (id) =>
      withReach(await (await getAccountStore(configPath, ownerUsername)).byId(id)),
    byToken: async (value) =>
      withReach(await (await getAccountStore(configPath, ownerUsername)).accountForToken(value)),
  }
}

type LookedUp = Account & { adminProjects?: Array<{ host: string; project: string }> }

export async function closeAccountStores(): Promise<void> {
  await Promise.all(Array.from(stores.values(), (entry) => entry.store.close()))
  stores.clear()
}
