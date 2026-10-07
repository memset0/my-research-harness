import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { dirname, join } from '@memon/file-protocol/paths'
import sqlite3 from 'sqlite3'
import type {
  ExperimentResultsView,
  ExperimentResultsViewDefinition,
  ExperimentResultsViewScope,
} from '../experiment-results-views'
import { UI_PREFERENCES_DB_FILENAME } from './ui-preferences-store'

const LEGACY_MIGRATION_ID = 'experiment-results-views-from-user-preferences-v1'
const LEGACY_PREFIX = 'memon:results-table:'
const LEGACY_SUFFIX = ':preferences'
const HOST_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/
const PROJECT_PATTERN = /^[A-Za-z0-9-]{1,128}$/
const EXPERIMENT_PATTERN = /^E\d{4,}-[A-Za-z0-9][A-Za-z0-9._-]*$/

interface ViewRow {
  id: string
  host: string
  project: string
  experiment_id: string
  name: string
  definition_json: string
  revision: number
  created_at: number
  updated_at: number
}

interface LegacyRow {
  username: string
  preference_key: string
  value_json: string
  updated_at: number
}

export class ResultsViewConflictError extends Error {}
export class ResultsViewNotFoundError extends Error {}

export class ExperimentResultsViewsStore {
  private readonly database: sqlite3.Database
  private readonly ready: Promise<void>
  private closed = false

  constructor(public readonly path: string) {
    this.database = new sqlite3.Database(path)
    this.database.configure('busyTimeout', 5000)
    this.ready = this.initialize()
  }

  async list(scope: ExperimentResultsViewScope): Promise<ExperimentResultsView[]> {
    await this.ready
    const rows = await this.all<ViewRow>(
      `SELECT id, host, project, experiment_id, name, definition_json,
              revision, created_at, updated_at
         FROM experiment_result_views
        WHERE host = ? AND project = ? AND experiment_id = ?
        ORDER BY created_at ASC, id ASC`,
      scopeParams(scope),
    )
    return rows.map(rowToView)
  }

  async create(
    scope: ExperimentResultsViewScope,
    name: string,
    definition: ExperimentResultsViewDefinition,
    options: { id?: string; now?: number } = {},
  ): Promise<ExperimentResultsView> {
    await this.ready
    const id = options.id ?? randomUUID()
    const now = options.now ?? Date.now()
    const normalizedName = normalizeName(name)
    try {
      await this.run(
        `INSERT INTO experiment_result_views (
           id, host, project, experiment_id, name, name_key, definition_json,
           revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          id,
          scope.host ?? '',
          scope.project,
          scope.experimentId,
          normalizedName,
          nameKey(normalizedName),
          canonicalJson(definition),
          now,
          now,
        ],
      )
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ResultsViewConflictError('View name already exists')
      throw error
    }
    return this.getRequired(scope, id)
  }

  async update(
    scope: ExperimentResultsViewScope,
    id: string,
    update: { name?: string; definition?: ExperimentResultsViewDefinition },
  ): Promise<ExperimentResultsView> {
    await this.ready
    const current = await this.getRequired(scope, id)
    const name = update.name === undefined ? current.name : normalizeName(update.name)
    const definition = update.definition ?? current.definition
    const updatedAt = Math.max(Date.now(), current.updatedAt + 1)
    try {
      const changes = await this.run(
        `UPDATE experiment_result_views
            SET name = ?, name_key = ?, definition_json = ?,
                revision = revision + 1, updated_at = ?
          WHERE id = ? AND host = ? AND project = ? AND experiment_id = ?`,
        [name, nameKey(name), canonicalJson(definition), updatedAt, id, ...scopeParams(scope)],
      )
      if (changes === 0) throw new ResultsViewNotFoundError('View not found')
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ResultsViewConflictError('View name already exists')
      throw error
    }
    return this.getRequired(scope, id)
  }

  async delete(scope: ExperimentResultsViewScope, id: string): Promise<void> {
    await this.ready
    const changes = await this.run(
      `DELETE FROM experiment_result_views
        WHERE id = ? AND host = ? AND project = ? AND experiment_id = ?`,
      [id, ...scopeParams(scope)],
    )
    if (changes === 0) throw new ResultsViewNotFoundError('View not found')
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

  private async initialize(): Promise<void> {
    await this.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS experiment_result_views (
        id              TEXT NOT NULL PRIMARY KEY,
        host            TEXT NOT NULL,
        project         TEXT NOT NULL,
        experiment_id   TEXT NOT NULL,
        name            TEXT NOT NULL,
        name_key        TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        revision        INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL,
        UNIQUE (host, project, experiment_id, name_key)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS experiment_result_views_scope
        ON experiment_result_views (host, project, experiment_id, created_at, id);
      CREATE TABLE IF NOT EXISTS ui_preference_migrations (
        migration_id TEXT NOT NULL PRIMARY KEY,
        applied_at   INTEGER NOT NULL
      ) WITHOUT ROWID;
    `)
    await chmod(this.path, 0o600)
    await this.importLegacyPreferences()
  }

  private async importLegacyPreferences(): Promise<void> {
    const alreadyApplied = await this.get<{ migration_id: string }>(
      'SELECT migration_id FROM ui_preference_migrations WHERE migration_id = ?',
      [LEGACY_MIGRATION_ID],
    )
    if (alreadyApplied) return

    const legacyTable = await this.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_preferences'`,
    )
    const rows = legacyTable
      ? await this.all<LegacyRow>(
          `SELECT username, preference_key, value_json, updated_at
             FROM user_preferences
            WHERE preference_key LIKE ?
            ORDER BY updated_at ASC, username ASC, preference_key ASC`,
          [`${LEGACY_PREFIX}%${LEGACY_SUFFIX}`],
        )
      : []

    await this.exec('BEGIN IMMEDIATE')
    try {
      const importedByScope = new Map<string, Set<string>>()
      const nextNameByScope = new Map<string, number>()
      for (const row of rows) {
        const scope = parseLegacyScope(row.preference_key)
        if (!scope) continue
        let definition: unknown
        try {
          definition = JSON.parse(row.value_json)
        } catch {
          continue
        }
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue

        const canonical = canonicalJson(definition)
        const scopeKey = canonicalScopeKey(scope)
        let definitions = importedByScope.get(scopeKey)
        if (!definitions) {
          const existing = await this.all<{ definition_json: string }>(
            `SELECT definition_json FROM experiment_result_views
              WHERE host = ? AND project = ? AND experiment_id = ?`,
            scopeParams(scope),
          )
          definitions = new Set(
            existing.flatMap((entry) => {
              try {
                return [canonicalJson(JSON.parse(entry.definition_json))]
              } catch {
                return []
              }
            }),
          )
          importedByScope.set(scopeKey, definitions)
          nextNameByScope.set(scopeKey, existing.length + 1)
        }
        if (definitions.has(canonical)) continue

        let sequence = nextNameByScope.get(scopeKey) ?? 1
        let name = sequence === 1 ? 'Default' : `Imported view ${sequence}`
        while (
          await this.get<{ id: string }>(
            `SELECT id FROM experiment_result_views
              WHERE host = ? AND project = ? AND experiment_id = ? AND name_key = ?`,
            [...scopeParams(scope), nameKey(name)],
          )
        ) {
          sequence += 1
          name = `Imported view ${sequence}`
        }
        const id = legacyViewId(row.username, row.preference_key, canonical)
        // Preserve deterministic import order even when several legacy writes
        // share the same millisecond timestamp.
        const importedAt = row.updated_at + sequence - 1
        await this.run(
          `INSERT OR IGNORE INTO experiment_result_views (
             id, host, project, experiment_id, name, name_key, definition_json,
             revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            id,
            scope.host ?? '',
            scope.project,
            scope.experimentId,
            name,
            nameKey(name),
            canonical,
            importedAt,
            importedAt,
          ],
        )
        definitions.add(canonical)
        nextNameByScope.set(scopeKey, sequence + 1)
      }
      await this.run(
        'INSERT INTO ui_preference_migrations (migration_id, applied_at) VALUES (?, ?)',
        [LEGACY_MIGRATION_ID, Date.now()],
      )
      await this.exec('COMMIT')
    } catch (error) {
      await this.exec('ROLLBACK').catch(() => undefined)
      throw error
    }
  }

  private async getRequired(
    scope: ExperimentResultsViewScope,
    id: string,
  ): Promise<ExperimentResultsView> {
    const row = await this.get<ViewRow>(
      `SELECT id, host, project, experiment_id, name, definition_json,
              revision, created_at, updated_at
         FROM experiment_result_views
        WHERE id = ? AND host = ? AND project = ? AND experiment_id = ?`,
      [id, ...scopeParams(scope)],
    )
    if (!row) throw new ResultsViewNotFoundError('View not found')
    return rowToView(row)
  }

  private exec(sql: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.database.exec(sql, (error) => (error ? reject(error) : resolve()))
    })
  }

  private run(sql: string, params: unknown[] = []): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.database.run(sql, params, function callback(error) {
        if (error) reject(error)
        else resolve(this.changes)
      })
    })
  }

  private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      this.database.get(sql, params, (error, row: T | undefined) => {
        if (error) reject(error)
        else resolve(row)
      })
    })
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.database.all(sql, params, (error, rows: T[]) => {
        if (error) reject(error)
        else resolve(rows)
      })
    })
  }
}

function rowToView(row: ViewRow): ExperimentResultsView {
  return {
    id: row.id,
    scope: {
      host: row.host || null,
      project: row.project,
      experimentId: row.experiment_id,
    },
    name: row.name,
    definition: JSON.parse(row.definition_json) as ExperimentResultsViewDefinition,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function scopeParams(scope: ExperimentResultsViewScope): [string, string, string] {
  return [scope.host ?? '', scope.project, scope.experimentId]
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase('en-US')
}

function canonicalScopeKey(scope: ExperimentResultsViewScope): string {
  return `${scope.host ?? ''}\u0000${scope.project}\u0000${scope.experimentId}`
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value))
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeysDeep(entry)]),
  )
}

function parseLegacyScope(key: string): ExperimentResultsViewScope | null {
  if (!key.startsWith(LEGACY_PREFIX) || !key.endsWith(LEGACY_SUFFIX)) return null
  const middle = key.slice(LEGACY_PREFIX.length, -LEGACY_SUFFIX.length)
  const segments = middle.split(':')
  if (segments.length !== 2 && segments.length !== 3) return null
  const host = segments.length === 3 ? segments[0]! : null
  const project = segments.at(-2)!
  const experimentId = segments.at(-1)!
  if (host !== null && !HOST_PATTERN.test(host)) return null
  if (!PROJECT_PATTERN.test(project) || !EXPERIMENT_PATTERN.test(experimentId)) return null
  return { host, project, experimentId }
}

function legacyViewId(username: string, key: string, canonical: string): string {
  return `legacy-${createHash('sha256')
    .update(username)
    .update('\0')
    .update(key)
    .update('\0')
    .update(canonical)
    .digest('hex')
    .slice(0, 32)}`
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: string }).code === 'SQLITE_CONSTRAINT'
  )
}

const stores = new Map<string, ExperimentResultsViewsStore>()

export function experimentResultsViewsDatabasePath(configPath: string): string {
  return join(dirname(configPath), UI_PREFERENCES_DB_FILENAME)
}

export function getExperimentResultsViewsStore(configPath: string): ExperimentResultsViewsStore {
  const path = experimentResultsViewsDatabasePath(configPath)
  const cached = stores.get(path)
  if (cached) return cached
  const store = new ExperimentResultsViewsStore(path)
  stores.set(path, store)
  return store
}

export async function closeExperimentResultsViewsStores(): Promise<void> {
  await Promise.all(Array.from(stores.values(), (store) => store.close()))
  stores.clear()
}
