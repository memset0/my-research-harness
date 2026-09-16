// Executable component results are cached beside their document.
//
//   docs/wiki/note/W0004-x.md         -> docs/wiki/note/W0004-x__assets/<id>.json
//   docs/wiki/note/W0004-x/README.md  -> docs/wiki/note/W0004-x/README__assets/<id>.json
//
// One file per block id: the function's returned object spread at the top
// level plus the `__*` execution keys. The data half is compared as canonical
// JSON so a rerun that produces the same object reports `unchanged` and only
// its timestamps move; a failure keeps the previous data and records
// `__last_error`.

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

import { formatIsoLocal } from '../time.js'
import { RESERVED_PREFIX, stripHiddenKeys } from './payload.js'

/** Recorded failure of the most recent run; the data beside it is older. */
export interface ComponentCacheError {
  at: string
  message: string
}

/** A cache file as read from disk, split into data and execution keys. */
export interface ComponentCacheEntry {
  /** Every non-`__` key: the object the component renders. */
  data: Record<string, unknown>
  mdFilePath: string | null
  componentType: string | null
  componentId: string | null
  updatedAt: string | null
  sourceHash: string | null
  durationMs: number | null
  lastError: ComponentCacheError | null
}

export interface WriteComponentCacheInput {
  /** Absolute project root. */
  root: string
  /** Project-relative document path. */
  documentPath: string
  id: string
  /** `<type>@<N>`. */
  componentType: string
  /** sha256 of the executed source plus its kwargs. */
  sourceHash: string
  durationMs: number
  /** The returned object; omit on failure. */
  data?: Record<string, unknown>
  /** Failure text; the previous data is preserved beside it. */
  error?: string
  /** Injectable clock for tests. */
  now?: Date
}

export interface WriteComponentCacheResult {
  status: 'updated' | 'unchanged' | 'failed'
  /** Project-relative cache file path. */
  path: string
}

/**
 * `<dir>/<stem>__assets` for a project-relative document path. The stem drops
 * one trailing extension only, so `README.md` becomes `README__assets`.
 */
export function componentAssetsDir(documentPath: string): string {
  const normalized = documentPath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  const dir = slash === -1 ? '' : normalized.slice(0, slash)
  const base = normalized.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return dir === '' ? `${stem}__assets` : `${dir}/${stem}__assets`
}

/** Project-relative cache file path for one block id. */
export function componentCachePath(documentPath: string, id: string): string {
  return `${componentAssetsDir(documentPath)}/${id}.json`
}

/**
 * Stable JSON: object keys sorted, arrays in order, `undefined` dropped. Used
 * to decide `updated` vs `unchanged` and to hash kwargs.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

/** Read one cache file, or null when it is missing or not a JSON object. */
export async function readComponentCache(
  root: string,
  documentPath: string,
  id: string,
): Promise<ComponentCacheEntry | null> {
  const absolute = join(root, componentCachePath(documentPath, id))
  let text: string
  try {
    text = await fs.readFile(absolute, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const raw = parsed as Record<string, unknown>
  return {
    data: stripHiddenKeys(raw),
    mdFilePath: stringOrNull(raw.__md_file_path),
    componentType: stringOrNull(raw.__component_type),
    componentId: stringOrNull(raw.__component_id),
    updatedAt: stringOrNull(raw.__updated_at),
    sourceHash: stringOrNull(raw.__source_hash),
    durationMs: typeof raw.__duration_ms === 'number' ? raw.__duration_ms : null,
    lastError: readLastError(raw.__last_error),
  }
}

/**
 * Write the cache file for one block. On success the data replaces whatever
 * was there and `__last_error` is cleared; `unchanged` means the canonical
 * JSON of the data was identical and only the timestamps moved. On failure
 * the previous data (and its `__updated_at`) survive untouched beside a fresh
 * `__last_error`.
 */
export async function writeComponentCache(
  input: WriteComponentCacheInput,
): Promise<WriteComponentCacheResult> {
  const relativePath = componentCachePath(input.documentPath, input.id)
  const absolute = join(input.root, relativePath)
  const previous = await readComponentCache(input.root, input.documentPath, input.id)
  const now = input.now ?? new Date()
  const stamp = formatIsoLocal(now)

  const failed = input.data === undefined
  const data = failed ? (previous?.data ?? {}) : stripHiddenKeys(input.data!)
  const status: WriteComponentCacheResult['status'] = failed
    ? 'failed'
    : previous !== null && canonicalJson(previous.data) === canonicalJson(data)
      ? 'unchanged'
      : 'updated'

  const file: Record<string, unknown> = { ...data }
  for (const key of Object.keys(file)) {
    if (key.startsWith(RESERVED_PREFIX)) delete file[key]
  }
  file.__md_file_path = input.documentPath
  file.__component_type = input.componentType
  file.__component_id = input.id
  // `__updated_at` dates the data, so a failed run keeps the successful one.
  file.__updated_at = failed ? (previous?.updatedAt ?? stamp) : stamp
  file.__source_hash = input.sourceHash
  file.__duration_ms = input.durationMs
  if (failed) file.__last_error = { at: stamp, message: input.error ?? 'component run failed' }

  await fs.mkdir(dirname(absolute), { recursive: true })
  const serialized = `${JSON.stringify(file, null, 2)}\n`
  const temporary = `${absolute}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await fs.writeFile(temporary, serialized, { mode: 0o644 })
  try {
    await fs.rename(temporary, absolute)
  } catch (err) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw err
  }
  return { status, path: relativePath }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readLastError(value: unknown): ComponentCacheError | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.message !== 'string') return null
  return { at: typeof raw.at === 'string' ? raw.at : '', message: raw.message }
}
