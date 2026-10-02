// Validation and verification of index entries against the files.
//
// `validateIndexEntries` is the windowed check readers and the central
// validator use: an entry verified within its window is reused without I/O;
// an older one has its fingerprints re-taken and is reported stale when they
// differ (or the file is gone). Windows are the caller's (central lists use
// 60 s, 300 s for terminal Runs; strict callers pass 0).
//
// `verifyIndex` is the full check behind `memon index status --verify`: it
// re-takes every fingerprint, re-walks with the effective `run_dirs`, reloads
// changed entries and reports each difference as an `INDEX_DRIFT` record,
// plus the layout notices `RUN_OUTSIDE_RUN_DIRS` and `RUN_NESTED` for
// declared Experiment Run paths. Drift is a diagnostic of the cache, never a
// research finding and never a membership anomaly.

import { join } from 'node:path'
import { discoverRuns } from '../discovery/discover.js'
import { matchesRunDirPatterns, nestedRunAncestor } from '../discovery/run-dirs.js'
import { listExperimentPaths } from '../experiments/discover.js'
import { type EffectiveRunDirs, resolveEffectiveRunDirs } from '../project-declaration/load.js'
import { discoverWikiPages } from '../wiki/discover.js'
import { deriveExperimentEntry, deriveRunEntry, deriveWikiEntry, indexKey } from './entries.js'
import { type PersistedFingerprint, sameFingerprint, takeFingerprint } from './fingerprint.js'
import { defaultIndexFs, type IndexFs } from './fs.js'
import { resolveIndexPaths } from './paths.js'
import type {
  ExperimentIndexEntry,
  IndexEntryKind,
  IndexSnapshot,
  RunIndexEntry,
  WikiIndexEntry,
} from './schema.js'
import {
  type DerivedIndexRead,
  mergedIndexView,
  readDerivedIndex,
  type SkippedIndexEvent,
  type SnapshotState,
} from './snapshot.js'

export const INDEX_DRIFT = 'INDEX_DRIFT'
export const RUN_OUTSIDE_RUN_DIRS = 'RUN_OUTSIDE_RUN_DIRS'
export const RUN_NESTED = 'RUN_NESTED'

type AnyEntry = RunIndexEntry | ExperimentIndexEntry | WikiIndexEntry

export type IndexWindow = number | ((kind: IndexEntryKind, key: string, entry: AnyEntry) => number)

export interface StaleIndexEntry {
  kind: IndexEntryKind
  key: string
  reason: 'changed' | 'missing'
}

export interface ValidateIndexEntriesResult {
  /** Entries whose fingerprints no longer match their files. */
  stale: StaleIndexEntry[]
  /** Entries re-checked and still matching (their `verified_at` may advance). */
  verified: Array<{ kind: IndexEntryKind; key: string }>
  /** Entries still inside their window (no I/O). */
  reused: number
}

export interface ValidateIndexEntriesOptions {
  /** Reuse window in ms, constant or per entry. */
  maxAgeMs: IndexWindow
  fs?: IndexFs
  now?: () => Date
  /** Restrict the check to these kinds (default: all three). */
  kinds?: readonly IndexEntryKind[]
}

async function currentFingerprints(
  root: string,
  kind: IndexEntryKind,
  key: string,
  entry: AnyEntry,
  fs: IndexFs,
): Promise<Array<[PersistedFingerprint | null, PersistedFingerprint | null]>> {
  const absolute = join(root, ...key.split('/'))
  if (kind === 'runs') {
    const run = entry as RunIndexEntry
    return [
      [run.readme_fp, await takeFingerprint(join(absolute, 'README.md'), fs)],
      [run.dir_fp, await takeFingerprint(absolute, fs)],
    ]
  }
  if (kind === 'experiments') {
    const experiment = entry as ExperimentIndexEntry
    if (key.endsWith('.md')) return [[experiment.readme_fp, await takeFingerprint(absolute, fs)]]
    return Promise.all(
      (
        [
          [experiment.readme_fp, 'README.md'],
          [experiment.bundle_fp.implementation, 'implementation.yaml'],
          [experiment.bundle_fp.investigation, 'investigation.yaml'],
          [experiment.bundle_fp.results, 'results.yaml'],
        ] as const
      ).map(
        async ([fingerprint, name]) =>
          [fingerprint, await takeFingerprint(join(absolute, name), fs)] as [
            PersistedFingerprint | null,
            PersistedFingerprint | null,
          ],
      ),
    )
  }
  return [[(entry as WikiIndexEntry).fp, await takeFingerprint(absolute, fs)]]
}

/** Re-take the fingerprints of every entry older than its window. */
export async function validateIndexEntries(
  root: string,
  view: IndexSnapshot,
  options: ValidateIndexEntriesOptions,
): Promise<ValidateIndexEntriesResult> {
  const fs = options.fs ?? defaultIndexFs
  const now = (options.now ?? (() => new Date()))().getTime()
  const rootAbs = resolveIndexPaths(root).rootAbs
  const result: ValidateIndexEntriesResult = { stale: [], verified: [], reused: 0 }
  const checks: Array<Promise<void>> = []
  for (const kind of options.kinds ?? (['runs', 'experiments', 'wiki'] as const)) {
    for (const [key, entry] of Object.entries(view[kind] as Record<string, AnyEntry>)) {
      const window =
        typeof options.maxAgeMs === 'number' ? options.maxAgeMs : options.maxAgeMs(kind, key, entry)
      const verifiedAt = Date.parse(entry.verified_at)
      if (!Number.isNaN(verifiedAt) && now - verifiedAt < window) {
        result.reused += 1
        continue
      }
      checks.push(
        (async () => {
          const pairs = await currentFingerprints(rootAbs, kind, key, entry, fs)
          // A Run is gone with its directory; an Experiment or page with all its files.
          const missing =
            kind === 'runs' ? pairs[1]![1] === null : pairs.every(([, disk]) => disk === null)
          if (missing) {
            result.stale.push({ kind, key, reason: 'missing' })
          } else if (pairs.some(([indexed, disk]) => !sameFingerprint(indexed, disk))) {
            result.stale.push({ kind, key, reason: 'changed' })
          } else {
            result.verified.push({ kind, key })
          }
        })(),
      )
    }
  }
  await Promise.all(checks)
  const order = (item: { kind: string; key: string }) => `${item.kind}\0${item.key}`
  result.stale.sort((left, right) => (order(left) < order(right) ? -1 : 1))
  result.verified.sort((left, right) => (order(left) < order(right) ? -1 : 1))
  return result
}

export interface IndexDriftRecord {
  code: typeof INDEX_DRIFT
  kind: 'runs' | 'experiments' | 'wiki' | 'walk'
  key: string
  field: string
  indexed: unknown
  disk: unknown
}

export interface IndexLayoutNotice {
  code: typeof RUN_OUTSIDE_RUN_DIRS | typeof RUN_NESTED
  severity: 'error' | 'warning'
  /** Declaring Experiment id. */
  experiment: string
  /** Declared project-relative Run path. */
  path: string
  message: string
}

export interface VerifyIndexOptions {
  cliRunDirs?: readonly string[]
  centralRunDirs?: readonly string[]
  include?: string[]
  exclude?: string[]
  fs?: IndexFs
  now?: () => Date
}

export interface VerifyIndexResult {
  snapshotState: SnapshotState
  /** Recorded Run locations of the merged view (null without an index). */
  recorded: EffectiveRunDirs | null
  effective: EffectiveRunDirs
  eventCount: number
  skippedEvents: SkippedIndexEvent[]
  pendingEvents: string[]
  drift: IndexDriftRecord[]
  notices: IndexLayoutNotice[]
}

const RUN_FIELDS = [
  'has_readme',
  'status',
  'updated_at',
  'archived',
  'deprecated',
  'eligibility_error',
] as const
const EXPERIMENT_FIELDS = ['id', 'slug', 'status', 'archived', 'runs'] as const
const WIKI_FIELDS = ['id', 'kind', 'status', 'title', 'sources', 'deprecated'] as const

function differs(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)
}

/** Layout notices for the declared Run paths of Experiment entries. */
export function layoutNotices(
  experiments: Iterable<ExperimentIndexEntry>,
  patterns: readonly string[],
): IndexLayoutNotice[] {
  const notices: IndexLayoutNotice[] = []
  for (const experiment of experiments) {
    for (const path of experiment.runs) {
      if (!path.includes('/')) continue
      const ancestor = nestedRunAncestor(path)
      if (ancestor !== null) {
        notices.push({
          code: RUN_NESTED,
          severity: 'error',
          experiment: experiment.id,
          path,
          message: `declared Run ${path} is nested inside the Run-shaped directory ${ancestor}; Run directories do not nest`,
        })
      }
      if (!matchesRunDirPatterns(path, patterns)) {
        notices.push({
          code: RUN_OUTSIDE_RUN_DIRS,
          severity: 'warning',
          experiment: experiment.id,
          path,
          message: `declared Run ${path} is outside the effective run_dirs (${patterns.join(', ')}); it stays a member by path but walks do not list it`,
        })
      }
    }
  }
  return notices
}

/** Compare the merged index of `root` with the files; read-only. */
export async function verifyIndex(
  root: string,
  options: VerifyIndexOptions = {},
): Promise<VerifyIndexResult> {
  const fs = options.fs ?? defaultIndexFs
  const clock = options.now ?? (() => new Date())
  const rootAbs = resolveIndexPaths(root).rootAbs
  const effective = await resolveEffectiveRunDirs({
    root: rootAbs,
    cliRunDirs: options.cliRunDirs,
    centralRunDirs: options.centralRunDirs,
  })
  const read: DerivedIndexRead = await readDerivedIndex(rootAbs, { fs, now: clock })
  const view = mergedIndexView(read, {
    runDirs: effective.patterns,
    runDirsSource: effective.source,
  })
  const drift: IndexDriftRecord[] = []
  const record = (
    kind: IndexDriftRecord['kind'],
    key: string,
    field: string,
    indexed: unknown,
    disk: unknown,
  ) => drift.push({ code: INDEX_DRIFT, kind, key, field, indexed, disk })

  // Disk state, independent of the index.
  const walked = (
    await discoverRuns({
      name: '(project-root)',
      root: rootAbs,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      runDirs: effective.patterns,
    })
  ).map((dir) => indexKey(rootAbs, dir))
  const documents = [...(await listExperimentPaths(rootAbs)).values()]
  const diskExperiments = new Map<string, ExperimentIndexEntry>()
  for (const document of documents) {
    const derived = await deriveExperimentEntry({
      projectRoot: rootAbs,
      readmePath: join(rootAbs, document),
      fs,
      now: clock,
    })
    if (derived) diskExperiments.set(derived.key, derived.entry)
  }
  const notices = layoutNotices(diskExperiments.values(), effective.patterns)
  const result: VerifyIndexResult = {
    snapshotState: read.snapshotState,
    recorded: view ? { patterns: [...view.run_dirs], source: view.run_dirs_source } : null,
    effective,
    eventCount: read.events.length,
    skippedEvents: read.skipped,
    pendingEvents: read.pending,
    drift,
    notices,
  }
  if (!view) return result

  if (differs(view.run_dirs, effective.patterns) || view.run_dirs_source !== effective.source) {
    record(
      'walk',
      'run_dirs',
      'run_dirs',
      { patterns: view.run_dirs, source: view.run_dirs_source },
      { patterns: effective.patterns, source: effective.source },
    )
  } else {
    const indexedWalk = new Set(view.walk.paths)
    const diskWalk = new Set(walked)
    for (const path of walked)
      if (!indexedWalk.has(path)) record('walk', path, 'paths', false, true)
    for (const path of view.walk.paths)
      if (!diskWalk.has(path)) record('walk', path, 'paths', true, false)
  }

  // Runs: re-take fingerprints; reload only changed entries.
  const runCheck = await validateIndexEntries(rootAbs, view, {
    maxAgeMs: 0,
    fs,
    now: clock,
    kinds: ['runs'],
  })
  for (const stale of runCheck.stale) {
    const indexed = view.runs[stale.key]!
    if (stale.reason === 'missing') {
      record('runs', stale.key, 'exists', true, false)
      continue
    }
    const disk = await deriveRunEntry({
      projectRoot: rootAbs,
      runDir: join(rootAbs, ...stale.key.split('/')),
      fs,
      now: clock,
    })
    if (!disk) {
      record('runs', stale.key, 'exists', true, false)
      continue
    }
    record('runs', stale.key, 'fingerprint', indexed.readme_fp, disk.readme_fp)
    for (const field of RUN_FIELDS)
      if (differs(indexed[field], disk[field]))
        record('runs', stale.key, field, indexed[field], disk[field])
  }

  for (const [key, disk] of diskExperiments) {
    const indexed = view.experiments[key]
    if (!indexed) {
      record('experiments', key, 'exists', false, true)
      continue
    }
    const fingerprintChanged =
      !sameFingerprint(indexed.readme_fp, disk.readme_fp) ||
      !sameFingerprint(indexed.bundle_fp.implementation, disk.bundle_fp.implementation) ||
      !sameFingerprint(indexed.bundle_fp.investigation, disk.bundle_fp.investigation) ||
      !sameFingerprint(indexed.bundle_fp.results, disk.bundle_fp.results)
    if (!fingerprintChanged) continue
    record('experiments', key, 'fingerprint', indexed.readme_fp, disk.readme_fp)
    for (const field of EXPERIMENT_FIELDS)
      if (differs(indexed[field], disk[field]))
        record('experiments', key, field, indexed[field], disk[field])
  }
  for (const key of Object.keys(view.experiments)) {
    if (!diskExperiments.has(key)) record('experiments', key, 'exists', true, false)
  }

  const pages = await discoverWikiPages(rootAbs, { inventoryOnly: true })
  const diskWiki = new Set<string>()
  for (const page of pages) {
    diskWiki.add(page.path)
    const indexed = view.wiki[page.path]
    if (!indexed) {
      record('wiki', page.path, 'exists', false, true)
      continue
    }
    const derived = await deriveWikiEntry({ page, fs, now: clock })
    if (!derived || sameFingerprint(indexed.fp, derived.entry.fp)) continue
    record('wiki', page.path, 'fingerprint', indexed.fp, derived.entry.fp)
    for (const field of WIKI_FIELDS)
      if (differs(indexed[field], derived.entry[field]))
        record('wiki', page.path, field, indexed[field], derived.entry[field])
  }
  for (const key of Object.keys(view.wiki)) {
    if (!diskWiki.has(key)) record('wiki', key, 'exists', true, false)
  }
  return result
}
