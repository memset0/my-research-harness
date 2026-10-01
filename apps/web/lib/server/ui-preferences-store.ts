import 'server-only'

import { dirname, join } from 'node:path'
import sqlite3 from 'sqlite3'

export const UI_PREFERENCES_DB_FILENAME = 'memon-ui-preferences.sqlite3'

export interface StoredPreference<T = unknown> {
  found: true
  value: T
  updatedAt: number
}

export interface MissingPreference {
  found: false
}

interface PreferenceRow {
  value_json: string
  updated_at: number
}

export class UiPreferencesStore {
  private readonly database: sqlite3.Database
  private readonly ready: Promise<void>
  private closed = false

  constructor(public readonly path: string) {
    this.database = new sqlite3.Database(path)
    this.database.configure('busyTimeout', 5000)
    this.ready = this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS user_preferences (
        username       TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        value_json     TEXT NOT NULL,
        updated_at     INTEGER NOT NULL,
        PRIMARY KEY (username, preference_key)
      ) WITHOUT ROWID;
    `)
  }

  async get<T>(username: string, key: string): Promise<StoredPreference<T> | MissingPreference> {
    await this.ready
    const row = await new Promise<PreferenceRow | undefined>((resolve, reject) => {
      this.database.get(
        `SELECT value_json, updated_at
           FROM user_preferences
          WHERE username = ? AND preference_key = ?`,
        [username, key],
        (error, result: PreferenceRow | undefined) => {
          if (error) reject(error)
          else resolve(result)
        },
      )
    })

    if (!row) return { found: false }
    return {
      found: true,
      value: JSON.parse(row.value_json) as T,
      updatedAt: row.updated_at,
    }
  }

  async set(username: string, key: string, value: unknown): Promise<StoredPreference> {
    const valueJson = JSON.stringify(value)
    if (valueJson === undefined) throw new TypeError('preference value must be JSON-serializable')

    await this.ready
    const updatedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      this.database.run(
        `INSERT INTO user_preferences (username, preference_key, value_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(username, preference_key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
        [username, key, valueJson, updatedAt],
        (error) => {
          if (error) reject(error)
          else resolve()
        },
      )
    })

    return { found: true, value, updatedAt }
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

  private exec(sql: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.database.exec(sql, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

const stores = new Map<string, UiPreferencesStore>()

export function uiPreferencesDatabasePath(configPath: string): string {
  return join(dirname(configPath), UI_PREFERENCES_DB_FILENAME)
}

export function getUiPreferencesStore(configPath: string): UiPreferencesStore {
  const path = uiPreferencesDatabasePath(configPath)
  const cached = stores.get(path)
  if (cached) return cached

  const store = new UiPreferencesStore(path)
  stores.set(path, store)
  return store
}

/** Test/process-shutdown helper; normal requests share one connection per config directory. */
export async function closeUiPreferencesStores(): Promise<void> {
  await Promise.all(Array.from(stores.values(), (store) => store.close()))
  stores.clear()
}
