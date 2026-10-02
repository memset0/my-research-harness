// Full rebuild: a fresh snapshot from the project files alone.
//
// Under the compaction lease: resolve the effective `run_dirs` (recording
// patterns and source), run the bounded walk, read every Run README and
// result file once, every Experiment README with stats of its bundle files
// and every wiki page, write the snapshot, delete the events present at the
// start and the Results summaries of Experiments that no longer exist. The
// optional audit performs one unbounded walk under `logs/`, `outputs/` and
// `experiments/` and lists Run directories the effective patterns miss
// (read-only; it never feeds the snapshot).

import { join } from 'node:path'
import { discoverRuns } from '../discovery/discover.js'
import { nestedRunAncestor } from '../discovery/run-dirs.js'
import { listExperimentPaths } from '../experiments/discover.js'
import { type EffectiveRunDirs, resolveEffectiveRunDirs } from '../project-declaration/load.js'
import { formatIsoLocal } from '../time.js'
import { MEMON_RELEASE } from '../version.js'
import { discoverWikiPages } from '../wiki/discover.js'
import { acquireIndexLease, writeSnapshot } from './compact.js'
import { deriveExperimentEntry, deriveRunEntry, deriveWikiEntry, indexKey } from './entries.js'
import { defaultIndexFs, type IndexFs } from './fs.js'
import { emptySnapshot, recomputeOwners } from './merge.js'
import { resolveIndexPaths } from './paths.js'
import type { IndexRole, IndexSnapshot } from './schema.js'
import { listIndexEvents, readDerivedIndex } from './snapshot.js'

const READ_CONCURRENCY = 16

export interface RebuildIndexOptions {
  role?: IndexRole
  /** CLI `--run-dir` patterns (highest precedence). */
  cliRunDirs?: readonly string[]
  /** Central Project `run_dirs`. */
  centralRunDirs?: readonly string[]
  include?: string[]
  exclude?: string[]
  /** Compute the snapshot (and audit) but write nothing. */
  dryRun?: boolean
  /** Also report Run directories outside the effective patterns. */
  auditRunDirs?: boolean
  fs?: IndexFs
  now?: () => Date
  release?: string
}

export interface RunDirsAudit {
  /** Project-relative Run directories the effective patterns do not discover. */
  outside: string[]
}

export type RebuildIndexStatus = 'rebuilt' | 'dry-run' | 'conflict' | 'unsupported'

export interface RebuildIndexResult {
  status: RebuildIndexStatus
  runDirs: EffectiveRunDirs
  snapshot: IndexSnapshot | null
  counts: { runs: number; experiments: number; wiki: number }
  /** Events present at the start and deleted after the snapshot was written. */
  deletedEvents: string[]
  audit?: RunDirsAudit
  /** Discovered Run directories nested below a Run-shaped ancestor (`RUN_NESTED`). */
  nested: string[]
  /** Results summaries (`results/<id>.json`) deleted because their Experiment is gone. */
  deletedSummaries: string[]
}

/**
 * Delete `results/<id>.json` for every Experiment id not in `snapshot`.
 * Returns the deleted file names. Dot files (in-flight writes) are left alone.
 */
export async function pruneOrphanSummaries(
  root: string,
  snapshot: IndexSnapshot,
  fs: IndexFs = defaultIndexFs,
): Promise<string[]> {
  const directory = resolveIndexPaths(root).results
  let names: string[]
  try {
    names = (await fs.readdir(directory)) as string[]
  } catch {
    return []
  }
  const known = new Set(Object.values(snapshot.experiments).map((entry) => entry.id))
  const deleted: string[] = []
  for (const name of names.sort()) {
    if (name.startsWith('.') || !name.endsWith('.json')) continue
    if (known.has(name.slice(0, -'.json'.length))) continue
    await fs.rm(`${directory}/${name}`, { force: true })
    deleted.push(name)
  }
  return deleted
}

async function mapLimited<T, R>(items: readonly T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        out[index] = await map(items[index]!)
      }
    }),
  )
  return out
}

/** Derive a complete snapshot of `root` from its files (no index file is read). */
export async function buildIndexSnapshot(
  root: string,
  runDirs: EffectiveRunDirs,
  options: Pick<
    RebuildIndexOptions,
    'role' | 'include' | 'exclude' | 'fs' | 'now' | 'release'
  > = {},
): Promise<IndexSnapshot> {
  const fs = options.fs ?? defaultIndexFs
  const clock = options.now ?? (() => new Date())
  const paths = resolveIndexPaths(root)
  const rootAbs = paths.rootAbs
  const walkedAt = clock()
  const dirs = await discoverRuns({
    name: '(project-root)',
    root: rootAbs,
    include: options.include ?? [],
    exclude: options.exclude ?? [],
    runDirs: runDirs.patterns,
  })
  const snapshot = emptySnapshot({
    runDirs: runDirs.patterns,
    runDirsSource: runDirs.source,
    role: options.role ?? 'rebuild',
    now: walkedAt,
    ...(options.release ? { release: options.release } : {}),
  })
  snapshot.walk = {
    verified_at: formatIsoLocal(walkedAt),
    paths: dirs.map((dir) => indexKey(rootAbs, dir)).sort(),
  }
  const runEntries = await mapLimited(dirs, (dir) =>
    deriveRunEntry({ projectRoot: rootAbs, runDir: dir, contained: true, fs, now: clock }),
  )
  dirs.forEach((dir, index) => {
    const entry = runEntries[index]
    if (entry) snapshot.runs[indexKey(rootAbs, dir)] = entry
  })
  const documents = [...(await listExperimentPaths(rootAbs)).values()]
  const experiments = await mapLimited(documents, (document) =>
    deriveExperimentEntry({
      projectRoot: rootAbs,
      readmePath: join(rootAbs, document),
      fs,
      now: clock,
    }),
  )
  for (const derived of experiments) if (derived) snapshot.experiments[derived.key] = derived.entry
  const pages = await discoverWikiPages(rootAbs, { inventoryOnly: true })
  const wiki = await mapLimited(pages, (page) => deriveWikiEntry({ page, fs, now: clock }))
  for (const derived of wiki) if (derived) snapshot.wiki[derived.key] = derived.entry
  recomputeOwners(snapshot)
  snapshot.generated_at = formatIsoLocal(clock())
  snapshot.generator = {
    release: options.release ?? MEMON_RELEASE,
    role: options.role ?? 'rebuild',
  }
  return snapshot
}

/** Run directories the unbounded audit walk finds outside `walked`. */
export async function auditRunDirs(
  root: string,
  walked: ReadonlySet<string>,
  options: Pick<RebuildIndexOptions, 'include' | 'exclude'> = {},
): Promise<RunDirsAudit> {
  const rootAbs = resolveIndexPaths(root).rootAbs
  const all = await discoverRuns(
    {
      name: '(project-root)',
      root: rootAbs,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
    },
    { unbounded: true },
  )
  return {
    outside: all
      .map((dir) => indexKey(rootAbs, dir))
      .filter((path) => !walked.has(path))
      .sort(),
  }
}

/**
 * Rebuild the index of `root`. Throws `ProjectDeclarationError` when the
 * declaration is invalid (fail closed); returns `conflict` while another
 * compactor holds the lease and `unsupported` when the snapshot on disk has a
 * newer `index_version` (it is never overwritten).
 */
export async function rebuildIndex(
  root: string,
  options: RebuildIndexOptions = {},
): Promise<RebuildIndexResult> {
  const fs = options.fs ?? defaultIndexFs
  const runDirs = await resolveEffectiveRunDirs({
    root,
    cliRunDirs: options.cliRunDirs,
    centralRunDirs: options.centralRunDirs,
  })
  const empty = { runs: 0, experiments: 0, wiki: 0 }
  const base: RebuildIndexResult = {
    status: 'rebuilt',
    runDirs,
    snapshot: null,
    counts: empty,
    deletedEvents: [],
    nested: [],
    deletedSummaries: [],
  }
  const existing = await readDerivedIndex(root, {
    fs,
    ...(options.now ? { now: options.now } : {}),
  })
  if (existing.snapshotState === 'unsupported') return { ...base, status: 'unsupported' }
  const finish = async (snapshot: IndexSnapshot, status: RebuildIndexStatus) => {
    const result: RebuildIndexResult = {
      ...base,
      status,
      snapshot,
      counts: {
        runs: Object.keys(snapshot.runs).length,
        experiments: Object.keys(snapshot.experiments).length,
        wiki: Object.keys(snapshot.wiki).length,
      },
      nested: snapshot.walk.paths.filter((path) => nestedRunAncestor(path) !== null),
    }
    if (options.auditRunDirs)
      result.audit = await auditRunDirs(root, new Set(snapshot.walk.paths), options)
    return result
  }
  if (options.dryRun) return finish(await buildIndexSnapshot(root, runDirs, options), 'dry-run')
  const lease = await acquireIndexLease(root, {
    role: options.role ?? 'rebuild',
    fs,
    ...(options.now ? { now: options.now } : {}),
  })
  if (!lease) return { ...base, status: 'conflict' }
  try {
    const startEvents = await listIndexEvents(root, fs)
    const snapshot = await buildIndexSnapshot(root, runDirs, options)
    const again = await readDerivedIndex(root, { fs })
    if (again.snapshotState === 'unsupported') return { ...base, status: 'unsupported' }
    await writeSnapshot(root, snapshot, fs)
    const events = resolveIndexPaths(root).events
    for (const name of startEvents) await fs.rm(`${events}/${name}`, { force: true })
    const result = await finish(snapshot, 'rebuilt')
    result.deletedEvents = startEvents
    result.deletedSummaries = await pruneOrphanSummaries(root, snapshot, fs)
    return result
  } finally {
    await lease.release()
  }
}
