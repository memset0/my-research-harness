import { chmodSync, closeSync, existsSync, openSync } from 'node:fs'
import { formatIsoLocal, newTicketId, TICKET_ID_PATTERN } from '@memon/core'
import { dirname, join } from '@memon/file-protocol/paths'
import sqlite3 from 'sqlite3'
import type {
  DirtyGpu,
  PushState,
  SyncState,
  Ticket,
  TicketOwner,
  TicketRequest,
  TicketStatus,
} from './types'

export const GPU_POOL_DB_FILENAME = 'memon-gpu-pool.sqlite3'

interface TicketRow {
  seq: number
  /** The ticket id. `seq` only orders rows and is never exposed. */
  token: string
  project: string
  gpus: number | null
  whole_node: number
  gpu_type: string | null
  duration_s: number
  label: string | null
  run: string | null
  status: TicketStatus
  node: string | null
  granted_gpus: string
  requested_at: string
  requested_at_ms: number
  granted_at: string | null
  expires_at: string | null
  expires_at_ms: number | null
  ended_at: string | null
  reason: string | null
  owner_account_id: number | null
  owner_username: string | null
  forced: string | null
  sync_state: SyncState | null
  sync_commit: string | null
  sync_output: string | null
  run_started_at: string | null
  push_state: PushState | null
  push_commit: string | null
  push_output: string | null
  unrecorded_runs: string | null
}

/** Columns added after the first release, created on open when missing. */
const ADDED_COLUMNS: ReadonlyArray<[string, string]> = [
  ['token', 'TEXT'],
  ['owner_account_id', 'INTEGER'],
  ['owner_username', 'TEXT'],
  ['forced', 'TEXT'],
  ['sync_state', 'TEXT'],
  ['sync_commit', 'TEXT'],
  ['sync_output', 'TEXT'],
  ['run_started_at', 'TEXT'],
  ['push_state', 'TEXT'],
  ['push_commit', 'TEXT'],
  ['push_output', 'TEXT'],
  ['unrecorded_runs', 'TEXT'],
]

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.token,
    project: row.project,
    gpus: row.gpus,
    wholeNode: row.whole_node === 1,
    gpuType: row.gpu_type,
    durationS: row.duration_s,
    label: row.label,
    run: row.run,
    status: row.status,
    node: row.node,
    grantedGpus: JSON.parse(row.granted_gpus) as number[],
    requestedAt: row.requested_at,
    requestedAtMs: row.requested_at_ms,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    expiresAtMs: row.expires_at_ms,
    endedAt: row.ended_at,
    reason: row.reason,
    owner:
      row.owner_account_id !== null && row.owner_username !== null
        ? { accountId: row.owner_account_id, username: row.owner_username }
        : null,
    forced: row.forced,
    syncState: row.sync_state,
    syncCommit: row.sync_commit,
    syncOutput: row.sync_output,
    runStartedAt: row.run_started_at,
    pushState: row.push_state,
    pushCommit: row.push_commit,
    pushOutput: row.push_output,
    unrecordedRuns: row.unrecorded_runs ? (JSON.parse(row.unrecorded_runs) as string[]) : [],
  }
}

export class TicketStore {
  private readonly database: sqlite3.Database
  private readonly ready: Promise<void>

  constructor(public readonly path: string) {
    // SQLite gives -wal/-shm the main file's mode, so create it owner-only first.
    closeSync(openSync(path, 'a', 0o600))
    this.database = new sqlite3.Database(path)
    this.database.configure('busyTimeout', 5000)
    this.ready = this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS tickets (
        seq             INTEGER PRIMARY KEY AUTOINCREMENT,
        project         TEXT NOT NULL,
        gpus            INTEGER,
        whole_node      INTEGER NOT NULL,
        gpu_type        TEXT,
        duration_s      INTEGER NOT NULL,
        label           TEXT,
        run             TEXT,
        status          TEXT NOT NULL,
        node            TEXT,
        granted_gpus    TEXT NOT NULL DEFAULT '[]',
        requested_at    TEXT NOT NULL,
        requested_at_ms INTEGER NOT NULL,
        granted_at      TEXT,
        expires_at      TEXT,
        expires_at_ms   INTEGER,
        ended_at        TEXT,
        reason          TEXT
      );
      CREATE TABLE IF NOT EXISTS dirty_gpus (
        node   TEXT NOT NULL,
        gpu    INTEGER NOT NULL,
        since  TEXT NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (node, gpu)
      ) WITHOUT ROWID;
    `)
      .then(async () => {
        const columns = new Set(
          (await this.all<{ name: string }>('PRAGMA table_info(tickets)')).map((c) => c.name),
        )
        for (const [name, type] of ADDED_COLUMNS)
          if (!columns.has(name)) await this.exec(`ALTER TABLE tickets ADD COLUMN ${name} ${type}`)
        await this.exec('CREATE UNIQUE INDEX IF NOT EXISTS tickets_token ON tickets (token)')
        // Rows from stores that predate random ids get one, so every ticket has a random id.
        const unnamed = await this.all<{ seq: number }>(
          'SELECT seq FROM tickets WHERE token IS NULL',
        )
        for (const { seq } of unnamed)
          await this.run('UPDATE tickets SET token = ? WHERE seq = ?', [newTicketId(), seq])
      })
      .then(() => {
        for (const file of [path, `${path}-wal`, `${path}-shm`])
          if (existsSync(file)) chmodSync(file, 0o600)
      })
  }

  async create(
    request: TicketRequest,
    now: Date,
    owner: TicketOwner | null = null,
  ): Promise<Ticket> {
    await this.ready
    for (let attempt = 0; ; attempt += 1) {
      const id = newTicketId()
      try {
        await this.insert(id, request, now, owner)
        return (await this.get(id)) as Ticket
      } catch (error) {
        // 60 random bits make a collision practically impossible; retry anyway.
        if (attempt < 3 && (error as { code?: string }).code === 'SQLITE_CONSTRAINT') continue
        throw error
      }
    }
  }

  private insert(
    id: string,
    request: TicketRequest,
    now: Date,
    owner: TicketOwner | null,
  ): Promise<number> {
    return this.run(
      `INSERT INTO tickets (token, project, gpus, whole_node, gpu_type, duration_s, label, run,
                            status, requested_at, requested_at_ms, owner_account_id, owner_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`,
      [
        id,
        request.project,
        request.gpus ?? null,
        request.wholeNode ? 1 : 0,
        request.gpuType ?? null,
        request.durationS,
        request.label ?? null,
        request.run ?? null,
        formatIsoLocal(now),
        now.getTime(),
        owner?.accountId ?? null,
        owner?.username ?? null,
      ],
    )
  }

  /** Update the sync, push and forced-action columns of one ticket. */
  async patch(
    id: string,
    fields: Partial<{
      forced: string | null
      syncState: SyncState | null
      syncCommit: string | null
      syncOutput: string | null
      runStartedAt: string | null
      pushState: PushState | null
      pushCommit: string | null
      pushOutput: string | null
      unrecordedRuns: string[]
    }>,
  ): Promise<Ticket> {
    const columns: Record<string, string> = {
      forced: 'forced',
      syncState: 'sync_state',
      syncCommit: 'sync_commit',
      syncOutput: 'sync_output',
      runStartedAt: 'run_started_at',
      pushState: 'push_state',
      pushCommit: 'push_commit',
      pushOutput: 'push_output',
      unrecordedRuns: 'unrecorded_runs',
    }
    const sets: string[] = []
    const values: unknown[] = []
    for (const [key, value] of Object.entries(fields)) {
      const column = columns[key]
      if (!column) continue
      sets.push(`${column} = ?`)
      values.push(key === 'unrecordedRuns' ? JSON.stringify(value) : value)
    }
    if (sets.length > 0)
      await this.run(`UPDATE tickets SET ${sets.join(', ')} WHERE seq = ?`, [
        ...values,
        await this.seq(id),
      ])
    return this.require(id)
  }

  /** Mark the start command launched unless it already was; true when this call won. */
  async claimRunStart(id: string, now: Date): Promise<boolean> {
    const seq = await this.seq(id)
    await this.run(
      'UPDATE tickets SET run_started_at = ? WHERE seq = ? AND run_started_at IS NULL',
      [formatIsoLocal(now), seq],
    )
    return (await this.require(id)).runStartedAt === formatIsoLocal(now)
  }

  async get(id: string): Promise<Ticket | null> {
    const row = await this.row(id)
    return row ? toTicket(row) : null
  }

  private async row(id: string): Promise<TicketRow | undefined> {
    await this.ready
    if (!TICKET_ID_PATTERN.test(id)) return undefined
    return this.one<TicketRow>('SELECT * FROM tickets WHERE token = ?', [id])
  }

  private async seq(id: string): Promise<number> {
    const row = await this.row(id)
    if (!row) throw new Error(`ticket ${id} does not exist`)
    return row.seq
  }

  async list(statuses?: TicketStatus[]): Promise<Ticket[]> {
    await this.ready
    const rows = statuses
      ? await this.all<TicketRow>(
          `SELECT * FROM tickets WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY seq`,
          statuses,
        )
      : await this.all<TicketRow>('SELECT * FROM tickets ORDER BY seq')
    return rows.map(toTicket)
  }

  async grant(id: string, node: string, gpus: number[], now: Date): Promise<Ticket> {
    const ticket = await this.require(id)
    const seq = await this.seq(id)
    const expires = new Date(now.getTime() + ticket.durationS * 1000)
    await this.run(
      `UPDATE tickets SET status = 'GRANTED', node = ?, granted_gpus = ?, granted_at = ?,
              expires_at = ?, expires_at_ms = ?, reason = NULL
        WHERE seq = ? AND status = 'QUEUED'`,
      [
        node,
        JSON.stringify(gpus),
        formatIsoLocal(now),
        formatIsoLocal(expires),
        expires.getTime(),
        seq,
      ],
    )
    return this.require(id)
  }

  async finish(id: string, status: 'RELEASED' | 'EXPIRED' | 'FAILED', now: Date, reason?: string) {
    const seq = await this.seq(id)
    await this.run(`UPDATE tickets SET status = ?, ended_at = ?, reason = ? WHERE seq = ?`, [
      status,
      formatIsoLocal(now),
      reason ?? null,
      seq,
    ])
    return this.require(id)
  }

  async note(id: string, reason: string | null): Promise<void> {
    await this.run('UPDATE tickets SET reason = ? WHERE seq = ?', [reason, await this.seq(id)])
  }

  async markDirty(node: string, gpu: number, reason: string, now: Date): Promise<void> {
    await this.ready
    await this.run(
      `INSERT INTO dirty_gpus (node, gpu, since, reason) VALUES (?, ?, ?, ?)
       ON CONFLICT(node, gpu) DO UPDATE SET reason = excluded.reason`,
      [node, gpu, formatIsoLocal(now), reason],
    )
  }

  async clearDirty(node: string, gpu: number): Promise<void> {
    await this.ready
    await this.run('DELETE FROM dirty_gpus WHERE node = ? AND gpu = ?', [node, gpu])
  }

  async dirty(): Promise<DirtyGpu[]> {
    await this.ready
    return this.all<DirtyGpu>('SELECT node, gpu, since, reason FROM dirty_gpus ORDER BY node, gpu')
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.database.close((error) => (error ? reject(error) : resolve()))
    })
  }

  private async require(id: string): Promise<Ticket> {
    const ticket = await this.get(id)
    if (!ticket) throw new Error(`ticket ${id} does not exist`)
    return ticket
  }

  private exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.database.exec(sql, (error) => (error ? reject(error) : resolve()))
    })
  }

  private run(sql: string, params: unknown[]): Promise<number> {
    return new Promise((resolve, reject) => {
      this.database.run(sql, params, function (this: sqlite3.RunResult, error) {
        if (error) reject(error)
        else resolve(this.lastID)
      })
    })
  }

  private one<T>(sql: string, params: unknown[]): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.database.get(sql, params, (error, row: T | undefined) =>
        error ? reject(error) : resolve(row),
      )
    })
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.database.all(sql, params, (error, rows: T[]) => (error ? reject(error) : resolve(rows)))
    })
  }
}

export function gpuPoolDatabasePath(configPath: string): string {
  return join(dirname(configPath), GPU_POOL_DB_FILENAME)
}
