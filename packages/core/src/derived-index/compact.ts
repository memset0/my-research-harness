// Compaction: merge events into one snapshot under a lease.
//
// 1. Take the lease: create `compact.lock` exclusively, content
//    `{ pid, role, expires_at, token }` (120 s). An unexpired lease means
//    another compactor runs (`conflict`). An expired one is renamed away to
//    `.stale-<rand>` — only one contender's rename succeeds — and creation is
//    retried once.
// 2. List `events/`, read and merge them, write `.tmp-snapshot-<rand>`
//    exclusively and rename it over `snapshot.json`; `merged_events` lists
//    exactly the merged names.
// 3. Delete exactly those event files, remove `.tmp-*` / `.stale-*` older
//    than one hour, release the lease.
//
// Events created after step 2 listed `events/` are never deleted. If two
// compactors still overlap, the worst case is a snapshot missing a deleted
// event's hint, which fingerprint validation corrects within its window.

import { randomBytes } from 'node:crypto'
import { resolveEffectiveRunDirs } from '../project-declaration/load.js'
import { formatIsoLocal } from '../time.js'
import { MEMON_RELEASE } from '../version.js'
import { defaultIndexFs, errnoCode, type IndexFs } from './fs.js'
import { ensureIndexDirectory } from './gitignore.js'
import { emptySnapshot, mergeIndexEvents } from './merge.js'
import { type IndexPaths, randomHex8, resolveIndexPaths } from './paths.js'
import type { IndexRole, IndexSnapshot, RunDirsSource } from './schema.js'
import { readDerivedIndex, type SkippedIndexEvent } from './snapshot.js'

export const COMPACTION_LEASE_MS = 120_000
export const ABANDONED_TEMPORARY_MS = 60 * 60 * 1000

export interface IndexLeaseOptions {
  role: IndexRole
  fs?: IndexFs
  now?: () => Date
  /** Lease lifetime (default and maximum 120 s). */
  ttlMs?: number
}

export interface IndexLease {
  token: string
  /** True while `compact.lock` still carries this lease. */
  held(): Promise<boolean>
  release(): Promise<void>
}

interface LeaseContent {
  pid: number
  role: string
  expires_at: string
  token: string
}

async function readLease(
  fs: IndexFs,
  path: string,
  ttlMs: number,
): Promise<{ raw: string; expiresAt: number } | null> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LeaseContent>
    const expiresAt = Date.parse(String(parsed.expires_at))
    if (!Number.isNaN(expiresAt)) return { raw, expiresAt }
  } catch {}
  // Unreadable content: the lease expires `ttl` after it was last written.
  try {
    const stat = await fs.stat(path)
    return { raw, expiresAt: stat.mtimeMs + ttlMs }
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null
    throw error
  }
}

/** Age after which an abandoned takeover mutex is cleared. */
const TAKEOVER_MUTEX_STALE_MS = 30_000

/**
 * Take the compaction lease of `root`, or return null when another
 * compactor holds an unexpired one (or is taking over an expired one).
 *
 * Taking over an expired lease is serialised by a short-lived exclusive
 * mutex (`.takeover-<lock>`): only its holder re-reads the lease, renames the
 * expired one away and creates a new one, so exactly one contender wins.
 */
export async function acquireIndexLease(
  root: string,
  options: IndexLeaseOptions,
): Promise<IndexLease | null> {
  const fs = options.fs ?? defaultIndexFs
  const clock = options.now ?? (() => new Date())
  const ttlMs = Math.min(options.ttlMs ?? COMPACTION_LEASE_MS, COMPACTION_LEASE_MS)
  const paths = resolveIndexPaths(root)
  await ensureIndexDirectory(paths, { fs })
  const token = randomBytes(8).toString('hex')
  const marker = `"token":"${token}"`
  const lease: IndexLease = {
    token,
    held: async () =>
      (await readLease(fs, paths.lock, ttlMs).catch(() => null))?.raw.includes(marker) === true,
    release: async () => {
      if (await lease.held()) await fs.unlink(paths.lock).catch(() => undefined)
    },
  }
  const create = async (): Promise<boolean> => {
    const content: LeaseContent = {
      pid: process.pid,
      role: options.role,
      expires_at: formatIsoLocal(new Date(clock().getTime() + ttlMs)),
      token,
    }
    try {
      await fs.writeFile(paths.lock, `${JSON.stringify(content)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      })
      return true
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') return false
      throw error
    }
  }
  if (await create()) return lease
  const current = await readLease(fs, paths.lock, ttlMs)
  if (current === null) return (await create()) ? lease : null
  if (current.expiresAt > clock().getTime()) return null

  const mutex = `${paths.dir}/.takeover-compact.lock`
  try {
    await fs.writeFile(mutex, token, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error
    try {
      const stat = await fs.stat(mutex)
      if (clock().getTime() - stat.mtimeMs > TAKEOVER_MUTEX_STALE_MS) {
        await fs.rm(mutex, { force: true })
      }
    } catch {}
    return null
  }
  try {
    const again = await readLease(fs, paths.lock, ttlMs)
    if (again !== null) {
      if (again.expiresAt > clock().getTime()) return null
      const stale = `${paths.dir}/.stale-${randomHex8()}`
      try {
        await fs.rename(paths.lock, stale)
      } catch (error) {
        if (errnoCode(error) !== 'ENOENT') throw error
      }
      const moved = await fs.readFile(stale, 'utf8').catch(() => null)
      if (moved !== null && moved !== again.raw) {
        // A lease created after the re-read was moved: put it back.
        await fs.link(stale, paths.lock).catch(() => undefined)
        await fs.rm(stale, { force: true }).catch(() => undefined)
        return null
      }
      await fs.rm(stale, { force: true }).catch(() => undefined)
    }
    return (await create()) ? lease : null
  } finally {
    await fs.rm(mutex, { force: true }).catch(() => undefined)
  }
}

/** Remove `.tmp-*`, `.stale-*` and `.takeover-*` files older than one hour. */
async function removeAbandonedTemporaries(
  fs: IndexFs,
  paths: IndexPaths,
  now: number,
): Promise<string[]> {
  const removed: string[] = []
  for (const directory of [paths.dir, paths.events]) {
    let names: string[]
    try {
      names = (await fs.readdir(directory)) as string[]
    } catch {
      continue
    }
    for (const name of names) {
      if (!['.tmp-', '.stale-', '.takeover-'].some((prefix) => name.startsWith(prefix))) continue
      const path = `${directory}/${name}`
      try {
        const stat = await fs.stat(path)
        if (now - stat.mtimeMs < ABANDONED_TEMPORARY_MS) continue
        await fs.rm(path, { force: true })
        removed.push(path.slice(paths.dir.length + 1))
      } catch {}
    }
  }
  return removed
}

/** Replace `snapshot.json` atomically (exclusive temp file + rename). */
export async function writeSnapshot(
  root: string,
  snapshot: IndexSnapshot,
  fs: IndexFs = defaultIndexFs,
): Promise<void> {
  const paths = resolveIndexPaths(root)
  await ensureIndexDirectory(paths, { fs })
  const temporary = `${paths.dir}/.tmp-snapshot-${randomHex8()}`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, paths.snapshot)
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

export interface CompactIndexOptions {
  role: IndexRole
  fs?: IndexFs
  now?: () => Date
  release?: string
  /** Run locations recorded when there is no usable snapshot to start from. */
  runDirs?: { patterns: readonly string[]; source: RunDirsSource }
}

export type CompactIndexStatus = 'compacted' | 'unchanged' | 'conflict' | 'unsupported'

export interface CompactIndexResult {
  status: CompactIndexStatus
  /** Event names merged into (and deleted after) the new snapshot. */
  merged: string[]
  skipped: SkippedIndexEvent[]
  removedTemporaries: string[]
  snapshot: IndexSnapshot | null
}

/** Merge the events of `root` into its snapshot under the lease. */
export async function compactIndex(
  root: string,
  options: CompactIndexOptions,
): Promise<CompactIndexResult> {
  const fs = options.fs ?? defaultIndexFs
  const clock = options.now ?? (() => new Date())
  const paths = resolveIndexPaths(root)
  const result: CompactIndexResult = {
    status: 'unchanged',
    merged: [],
    skipped: [],
    removedTemporaries: [],
    snapshot: null,
  }
  const before = await readDerivedIndex(root, { fs, now: clock })
  if (before.snapshotState === 'unsupported') return { ...result, status: 'unsupported' }
  if (before.snapshotState === 'missing' && before.events.length === 0) {
    result.skipped = before.skipped
    return result
  }
  const lease = await acquireIndexLease(root, { role: options.role, fs, now: clock })
  if (!lease) return { ...result, status: 'conflict' }
  try {
    // Re-read under the lease: events listed now are exactly the ones merged.
    const read = await readDerivedIndex(root, { fs, now: clock })
    result.skipped = read.skipped
    if (read.snapshotState === 'unsupported') return { ...result, status: 'unsupported' }
    if (read.snapshotState === 'ok' && read.events.length === 0) {
      result.snapshot = read.snapshot
    } else if (read.snapshot || read.events.length > 0) {
      const now = clock()
      let base = read.snapshot
      if (!base) {
        const runDirs =
          options.runDirs ??
          (await resolveEffectiveRunDirs({ root }).catch(() => ({
            patterns: [] as string[],
            source: 'default' as const,
          })))
        base = emptySnapshot({
          runDirs: runDirs.patterns,
          runDirsSource: runDirs.source,
          role: options.role,
          now,
        })
      }
      const merged = mergeIndexEvents(base, read.events)
      merged.generated_at = formatIsoLocal(now)
      merged.generator = { release: options.release ?? MEMON_RELEASE, role: options.role }
      // A lease lost meanwhile (expired and taken over) means another
      // compactor owns the snapshot now.
      if (!(await lease.held())) return { ...result, status: 'conflict' }
      await writeSnapshot(root, merged, fs)
      for (const { name } of read.events) {
        await fs.rm(`${paths.events}/${name}`, { force: true })
      }
      result.status = 'compacted'
      result.merged = merged.merged_events
      result.snapshot = merged
    }
    result.removedTemporaries = await removeAbandonedTemporaries(fs, paths, clock().getTime())
    return result
  } finally {
    await lease.release()
  }
}
