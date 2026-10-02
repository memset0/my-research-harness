// Merging: the snapshot with unmerged events applied in file-name order.
//
// An event entry replaces the current entry unless the current entry's
// fingerprint has a newer change time (a later validation already saw a
// newer file). A removal applies unless the current entry was verified after
// the event was written. Owners are recomputed after merging, from the
// Experiment entries alone; they are never written into a Run README.

import { basename } from 'node:path'
import { matchesRunDirPatterns } from '../discovery/run-dirs.js'
import { formatIsoLocal } from '../time.js'
import { FS_CONVENTION_VERSION, MEMON_RELEASE } from '../version.js'
import { newestCtime } from './fingerprint.js'
import type {
  ExperimentIndexEntry,
  IndexEvent,
  IndexRole,
  IndexSnapshot,
  RunDirsSource,
  RunIndexEntry,
  WikiIndexEntry,
} from './schema.js'

export interface NamedIndexEvent {
  name: string
  event: IndexEvent
}

type AnyEntry = RunIndexEntry | ExperimentIndexEntry | WikiIndexEntry

/** The newest change time among the fingerprints an entry was built from. */
export function entryCtime(entry: AnyEntry): number {
  if ('row' in entry && 'readme_fp' in entry && 'dir_fp' in entry) {
    return newestCtime(entry.readme_fp, entry.dir_fp)
  }
  if ('bundle_fp' in entry) {
    return newestCtime(
      entry.readme_fp,
      entry.bundle_fp.implementation,
      entry.bundle_fp.investigation,
      entry.bundle_fp.results,
    )
  }
  return newestCtime(entry.fp)
}

function time(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/** An empty snapshot (walk never verified) for the given Run locations. */
export function emptySnapshot(options: {
  runDirs: readonly string[]
  runDirsSource: RunDirsSource
  role: IndexRole
  now?: Date
  release?: string
}): IndexSnapshot {
  const now = options.now ?? new Date()
  return {
    index_version: 1,
    fs_convention_version: FS_CONVENTION_VERSION,
    generated_at: formatIsoLocal(now),
    generator: { release: options.release ?? MEMON_RELEASE, role: options.role },
    run_dirs: [...options.runDirs],
    run_dirs_source: options.runDirsSource,
    walk: { verified_at: formatIsoLocal(new Date(0)), paths: [] },
    merged_events: [],
    runs: {},
    experiments: {},
    wiki: {},
  }
}

/**
 * Recompute every Run entry's `owner`: the unique Experiment declaring it
 * (by project-relative path, or by a legacy bare Run ID that names exactly
 * one indexed Run), else null.
 */
export function recomputeOwners(snapshot: IndexSnapshot): void {
  const byBaseName = new Map<string, string[]>()
  for (const key of Object.keys(snapshot.runs)) {
    const name = basename(key)
    const list = byBaseName.get(name)
    if (list) list.push(key)
    else byBaseName.set(name, [key])
  }
  const declarers = new Map<string, Set<string>>()
  for (const experiment of Object.values(snapshot.experiments)) {
    for (const reference of experiment.runs) {
      let key: string | undefined
      if (reference.includes('/')) key = reference
      else {
        const matches = byBaseName.get(reference)
        if (matches?.length === 1) key = matches[0]
      }
      if (key === undefined) continue
      const set = declarers.get(key) ?? new Set<string>()
      set.add(experiment.id)
      declarers.set(key, set)
    }
  }
  for (const [key, entry] of Object.entries(snapshot.runs)) {
    const owners = declarers.get(key)
    entry.owner = owners?.size === 1 ? [...owners][0]! : null
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * Apply `events` (sorted by name here) to a copy of `base`. The returned
 * snapshot's `merged_events` lists exactly the applied names.
 */
export function mergeIndexEvents(
  base: IndexSnapshot,
  events: readonly NamedIndexEvent[],
): IndexSnapshot {
  const merged = clone(base)
  const walk = new Set(merged.walk.paths)
  const ordered = [...events].sort((left, right) => (left.name < right.name ? -1 : 1))
  for (const { event } of ordered) {
    const written = time(event.written_at)
    for (const kind of ['runs', 'experiments', 'wiki'] as const) {
      const target = merged[kind] as Record<string, AnyEntry>
      for (const [key, incoming] of Object.entries(event.upserts[kind] ?? {})) {
        const current = target[key]
        if (current && entryCtime(current) > entryCtime(incoming)) continue
        target[key] = clone(incoming)
        if (kind === 'runs' && matchesRunDirPatterns(key, merged.run_dirs)) walk.add(key)
      }
      for (const key of event.removals[kind] ?? []) {
        const current = target[key]
        if (current && time(current.verified_at) > written) continue
        delete target[key]
        if (kind === 'runs') walk.delete(key)
      }
    }
  }
  merged.walk.paths = [...walk].sort()
  merged.merged_events = ordered.map((item) => item.name)
  recomputeOwners(merged)
  return merged
}
