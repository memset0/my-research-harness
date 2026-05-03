// On-disk persistence for LineIndex.
//
// Storage:
//   ~/.cache/memon/lineindex/<sha1(abs path)>.json
//
// Format:
//   {
//     "v": 1,
//     "path": "<absolute path>",
//     "size": <bytes>, "mtime": <epoch ms>, "ino": <inode>,
//     "anchorEvery": <int>,
//     "totalLines": <int>,
//     "anchors": [[lineNumber, byteOffset], ...]
//   }
//
// Validity check on load: file's current `size + mtime + ino` must match the
// cached record (else the cache is stale and discarded).

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { LineIndex } from './line-index.js'

export const CACHE_VERSION = 1

export interface CacheRecord {
  v: number
  path: string
  size: number
  mtime: number
  ino: number
  anchorEvery: number
  totalLines: number
  anchors: [number, number][]
}

export function defaultCacheDir(): string {
  return join(homedir() || tmpdir(), '.cache', 'memon', 'lineindex')
}

function cacheKey(absolutePath: string): string {
  return createHash('sha1').update(absolutePath).digest('hex')
}

export interface CacheOptions {
  dir?: string
}

export async function saveCache(index: LineIndex, opts: CacheOptions = {}): Promise<string> {
  const dir = opts.dir ?? defaultCacheDir()
  await fs.mkdir(dir, { recursive: true })
  const filePath = join(dir, `${cacheKey(index.path)}.json`)
  const record: CacheRecord = {
    v: CACHE_VERSION,
    path: index.path,
    size: index.size,
    mtime: index.mtime,
    ino: index.ino,
    anchorEvery: index.anchorEvery,
    totalLines: index.totalLines,
    anchors: index.exportAnchors(),
  }
  const tmp = `${filePath}.tmp.${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(record))
  await fs.rename(tmp, filePath)
  return filePath
}

/**
 * Load a cached LineIndex if it exists AND the underlying file's metadata still
 * matches. Returns null on cache miss / stale / unreadable.
 */
export async function loadCache(
  absolutePath: string,
  opts: CacheOptions = {},
): Promise<LineIndex | null> {
  const dir = opts.dir ?? defaultCacheDir()
  const filePath = join(dir, `${cacheKey(absolutePath)}.json`)
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
  let record: CacheRecord
  try {
    record = JSON.parse(raw) as CacheRecord
  } catch {
    return null
  }
  if (record.v !== CACHE_VERSION || record.path !== absolutePath) return null

  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(absolutePath)
  } catch {
    return null
  }
  if (stat.size !== record.size || stat.mtimeMs !== record.mtime || stat.ino !== record.ino) {
    return null
  }
  return LineIndex.fromCache(record)
}
