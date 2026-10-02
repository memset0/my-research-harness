// Reading the index: snapshot plus unmerged events, as one merged view.
//
// A missing, unreadable, truncated, invalid or unsupported snapshot reads as
// "no index" (the caller falls back to file reads); it is never an error.
// Event files are the published names only (dot files are in-flight). An
// unparsable event older than 60 s is skipped and reported; a younger one is
// left for a later read. Events of an unsupported `index_version` are
// ignored, never deleted.

import { defaultIndexFs, errnoCode, type IndexFs } from './fs.js'
import { emptySnapshot, mergeIndexEvents, type NamedIndexEvent } from './merge.js'
import { eventFileTime, isEventFileName, resolveIndexPaths } from './paths.js'
import { type IndexSnapshot, parseEvent, parseSnapshot, type RunDirsSource } from './schema.js'

/** Age after which an unparsable event is reported and skipped. */
export const UNPARSABLE_EVENT_GRACE_MS = 60_000

export type SnapshotState = 'ok' | 'missing' | 'invalid' | 'unsupported' | 'outdated'

export interface SkippedIndexEvent {
  name: string
  reason: 'invalid' | 'unsupported' | 'outdated'
  message: string
}

export interface DerivedIndexRead {
  snapshot: IndexSnapshot | null
  snapshotState: SnapshotState
  snapshotMessage?: string
  /** Parsed events in name order. */
  events: NamedIndexEvent[]
  /** Events that are not merged: unparsable (older than 60 s) or of another version. */
  skipped: SkippedIndexEvent[]
  /** Unparsable events younger than 60 s (neither merged nor reported). */
  pending: string[]
}

export interface ReadIndexOptions {
  fs?: IndexFs
  now?: () => Date
}

/** List the published event names of `root` (empty when absent). */
export async function listIndexEvents(root: string, fs: IndexFs = defaultIndexFs) {
  try {
    return ((await fs.readdir(resolveIndexPaths(root).events)) as string[])
      .filter(isEventFileName)
      .sort()
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw error
  }
}

/** Read the snapshot and every published event of `root`. Never throws on bad content. */
export async function readDerivedIndex(
  root: string,
  options: ReadIndexOptions = {},
): Promise<DerivedIndexRead> {
  const fs = options.fs ?? defaultIndexFs
  const now = (options.now ?? (() => new Date()))().getTime()
  const paths = resolveIndexPaths(root)
  const result: DerivedIndexRead = {
    snapshot: null,
    snapshotState: 'missing',
    events: [],
    skipped: [],
    pending: [],
  }
  try {
    const raw = await fs.readFile(paths.snapshot, 'utf8')
    const verdict = parseSnapshot(JSON.parse(raw))
    if (verdict.ok) {
      result.snapshot = verdict.value
      result.snapshotState = 'ok'
    } else if (verdict.reason === 'invalid') {
      result.snapshotState = 'invalid'
      result.snapshotMessage = verdict.message
    } else {
      result.snapshotState = verdict.reason
      result.snapshotMessage = `index_version ${verdict.version}`
    }
  } catch (error) {
    const code = errnoCode(error)
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      result.snapshotState = 'invalid'
      result.snapshotMessage = (error as Error).message
    }
  }
  let names: string[] = []
  try {
    names = await listIndexEvents(root, fs)
  } catch {
    names = []
  }
  const reads = await Promise.all(
    names.map(async (name) => {
      try {
        return {
          name,
          verdict: parseEvent(JSON.parse(await fs.readFile(`${paths.events}/${name}`, 'utf8'))),
        }
      } catch (error) {
        if (errnoCode(error) === 'ENOENT') return null // compacted meanwhile
        return {
          name,
          verdict: {
            ok: false as const,
            reason: 'invalid' as const,
            message: (error as Error).message,
          },
        }
      }
    }),
  )
  for (const read of reads) {
    if (!read) continue
    const { name, verdict } = read
    if (verdict.ok) {
      result.events.push({ name, event: verdict.value })
      continue
    }
    if (verdict.reason === 'invalid') {
      const written = eventFileTime(name) ?? 0
      if (now - written < UNPARSABLE_EVENT_GRACE_MS) result.pending.push(name)
      else result.skipped.push({ name, reason: 'invalid', message: verdict.message })
      continue
    }
    result.skipped.push({
      name,
      reason: verdict.reason,
      message: `index_version ${verdict.version}`,
    })
  }
  return result
}

/**
 * The merged view of a read: the snapshot (or an empty one when the snapshot
 * is unusable) with every parsed event applied. `null` when there is neither
 * a usable snapshot nor any event, or when the snapshot has a newer
 * `index_version` — i.e. no index to serve from.
 */
export function mergedIndexView(
  read: DerivedIndexRead,
  fallback: { runDirs: readonly string[]; runDirsSource: RunDirsSource },
): IndexSnapshot | null {
  if (read.snapshotState === 'unsupported') return null
  if (!read.snapshot && read.events.length === 0) return null
  const base =
    read.snapshot ??
    emptySnapshot({ runDirs: fallback.runDirs, runDirsSource: fallback.runDirsSource, role: 'cli' })
  return mergeIndexEvents(base, read.events)
}
