import { chmodSync, closeSync, existsSync, openSync } from 'node:fs'
import {
  formatIsoLocal,
  LEGACY_TICKET_ID_PATTERN,
  newTicketId,
  TICKET_ID_PATTERN,
} from '@memon/core'
import { dirname, join } from '@memon/file-protocol/paths'
import sqlite3 from 'sqlite3'
import type { DirtyGpu, Ticket, TicketRequest, TicketStatus } from './types'

export const GPU_POOL_DB_FILENAME = 'memon-gpu-pool.sqlite3'

interface TicketRow {
  seq: number
  /** Random ticket id; null only on rows written before random ids. */
  token: string | null
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
}

/** The sequential id a row had before tickets carried random ids. */
const legacyTicketId = (seq: number) => `T${String(seq).padStart(4, '0')}`

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.token ?? legacyTicketId(row.seq),
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
        token           TEXT,
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
        const columns = await this.all<{ name: string }>('PRAGMA table_info(tickets)')
        if (!columns.some((column) => column.name === 'token'))
          await this.exec('ALTER TABLE tickets ADD COLUMN token TEXT')
        await this.exec('CREATE UNIQUE INDEX IF NOT EXISTS tickets_token ON tickets (token)')
      })
      .then(() => {
        for (const file of [path, `${path}-wal`, `${path}-shm`])
          if (existsSync(file)) chmodSync(file, 0o600)
      })
  }

  async create(request: TicketRequest, now: Date): Promise<Ticket> {
    await this.ready
    for (let attempt = 0; ; attempt += 1) {
      const id = newTicketId()
      try {
        await this.insert(id, request, now)
        return (await this.get(id)) as Ticket
      } catch (error) {
        // 60 random bits make a collision practically impossible; retry anyway.
        if (attempt < 3 && (error as { code?: string }).code === 'SQLITE_CONSTRAINT') continue
        throw error
      }
    }
  }

  private insert(id: string, request: TicketRequest, now: Date): Promise<number> {
    return this.run(
      `INSERT INTO tickets (token, project, gpus, whole_node, gpu_type, duration_s, label, run,
                            status, requested_at, requested_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`,
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
      ],
    )
  }

  async get(id: string): Promise<Ticket | null> {
    const row = await this.row(id)
    return row ? toTicket(row) : null
  }

  /** Row of a random id, or of a legacy sequential id on a row that has no random id. */
  private async row(id: string): Promise<TicketRow | undefined> {
    await this.ready
    if (TICKET_ID_PATTERN.test(id))
      return this.one<TicketRow>('SELECT * FROM tickets WHERE token = ?', [id])
    if (LEGACY_TICKET_ID_PATTERN.test(id))
      return this.one<TicketRow>('SELECT * FROM tickets WHERE seq = ? AND token IS NULL', [
        Number(id.slice(1)),
      ])
    return undefined
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
