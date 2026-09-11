import { createHash } from 'node:crypto'
import { chmod, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sqlite3 from 'sqlite3'
import { TranslationError } from './codex'
import type { SegmentResult } from './service'

export interface TranslationCache {
  get(key: string): Promise<SegmentResult | null>
  getMany?(keys: string[]): Promise<Array<SegmentResult | null>>
  set(key: string, result: SegmentResult): Promise<void>
}

export class SqliteTranslationCache implements TranslationCache {
  private database!: sqlite3.Database
  private readonly ready: Promise<void>
  private pending: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(
    readonly path: string,
    private readonly now = Date.now,
    private readonly limits = { entries: 10_000, bytes: 64 * 1024 * 1024, ttl: 30 * 86400_000 },
  ) {
    this.ready = this.initialize()
    void this.ready.catch(() => undefined)
  }

  private async initialize() {
    const file = await open(this.path, 'a', 0o600)
    await file.close()
    await chmod(this.path, 0o600)
    this.database = await new Promise<sqlite3.Database>((resolve, reject) => {
      const database = new sqlite3.Database(this.path, (error) =>
        error ? reject(error) : resolve(database),
      )
    })
    this.database.configure('busyTimeout', 5000)
    await this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA journal_size_limit = 1048576;
      CREATE TABLE IF NOT EXISTS body_translations (
        cache_key TEXT PRIMARY KEY,
        result_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS body_translations_expiry ON body_translations(expires_at);
    `)
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.pending
      .then(async () => {
        await this.ready
        if (this.closed) throw new Error('closed')
        return operation()
      })
      .catch(() => {
        throw new TranslationError('CACHE_UNAVAILABLE')
      })
    this.pending = task.catch(() => undefined)
    return task
  }

  async get(key: string): Promise<SegmentResult | null> {
    return (await this.getMany([key]))[0] ?? null
  }

  async getMany(keys: string[]): Promise<Array<SegmentResult | null>> {
    return this.serialize(async () => {
      if (!keys.length) return []
      const hashes = keys.map((key) => createHash('sha256').update(key).digest('hex'))
      const unique = [...new Set(hashes)]
      const results = new Map<string, SegmentResult>()
      const now = this.now()
      await this.exec('BEGIN IMMEDIATE')
      try {
        await this.run('DELETE FROM body_translations WHERE expires_at <= ?', [now])
        for (let offset = 0; offset < unique.length; offset += 256) {
          const chunk = unique.slice(offset, offset + 256)
          const placeholders = chunk.map(() => '?').join(',')
          const rows = await this.rows<{ cache_key: string; result_json: string }>(
            `SELECT cache_key, result_json FROM body_translations WHERE cache_key IN (${placeholders})`,
            chunk,
          )
          const invalid: string[] = []
          for (const row of rows) {
            let result: SegmentResult | undefined
            try {
              result = JSON.parse(row.result_json)
            } catch {}
            if (
              !result ||
              typeof result.id !== 'string' ||
              typeof result.sourceHash !== 'string' ||
              typeof result.text !== 'string' ||
              Object.keys(result).some((key) => !['id', 'sourceHash', 'text'].includes(key))
            )
              invalid.push(row.cache_key)
            else results.set(row.cache_key, result)
          }
          if (invalid.length)
            await this.run(
              `DELETE FROM body_translations WHERE cache_key IN (${invalid.map(() => '?').join(',')})`,
              invalid,
            )
          await this.run(
            `UPDATE body_translations SET accessed_at = ? WHERE cache_key IN (${placeholders})`,
            [now, ...chunk],
          )
        }
        await this.exec('COMMIT')
      } catch (error) {
        await this.exec('ROLLBACK').catch(() => undefined)
        throw error
      }
      return hashes.map((hash) => results.get(hash) ?? null)
    })
  }

  async set(key: string, result: SegmentResult): Promise<void> {
    return this.serialize(async () => {
      if (result.text === undefined || result.code !== undefined) throw new Error('invalid result')
      const hash = createHash('sha256').update(key).digest('hex')
      const value = JSON.stringify({
        id: result.id,
        sourceHash: result.sourceHash,
        text: result.text,
      })
      const bytes = Buffer.byteLength(hash) + Buffer.byteLength(value)
      if (bytes > this.limits.bytes) throw new Error('oversized result')
      await this.exec('BEGIN IMMEDIATE')
      try {
        await this.run('DELETE FROM body_translations WHERE expires_at <= ?', [this.now()])
        await this.run(
          `INSERT INTO body_translations VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json,
          expires_at=excluded.expires_at, accessed_at=excluded.accessed_at, bytes=excluded.bytes`,
          [hash, value, this.now() + this.limits.ttl, this.now(), bytes],
        )
        await this.run(
          `DELETE FROM body_translations WHERE cache_key IN (
          SELECT cache_key FROM (
            SELECT cache_key,
              ROW_NUMBER() OVER (ORDER BY accessed_at DESC, cache_key) AS position,
              SUM(bytes) OVER (ORDER BY accessed_at DESC, cache_key ROWS UNBOUNDED PRECEDING) AS total_bytes
            FROM body_translations
          ) WHERE position > ? OR total_bytes > ?
        )`,
          [this.limits.entries, this.limits.bytes],
        )
        await this.exec('COMMIT')
      } catch (error) {
        await this.exec('ROLLBACK').catch(() => undefined)
        throw error
      }
    })
  }

  async close(): Promise<void> {
    await this.pending
    await this.ready.catch(() => undefined)
    if (this.closed || !this.database) return
    this.closed = true
    await new Promise<void>((resolve, reject) =>
      this.database.close((error) => (error ? reject(error) : resolve())),
    )
  }

  private exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) =>
      this.database.exec(sql, (error) => (error ? reject(error) : resolve())),
    )
  }

  private run(sql: string, params: (string | number)[]): Promise<void> {
    return new Promise((resolve, reject) =>
      this.database.run(sql, params, (error) => (error ? reject(error) : resolve())),
    )
  }

  private rows<T>(sql: string, params: (string | number)[]): Promise<T[]> {
    return new Promise((resolve, reject) =>
      this.database.all(sql, params, (error, rows: T[]) => (error ? reject(error) : resolve(rows))),
    )
  }
}

const stores = new Map<string, SqliteTranslationCache>()

export function getTranslationCache(configPath: string): SqliteTranslationCache {
  const path = join(dirname(configPath), 'memon-translations.sqlite3')
  let store = stores.get(path)
  if (!store) {
    store = new SqliteTranslationCache(path)
    stores.set(path, store)
  }
  return store
}
