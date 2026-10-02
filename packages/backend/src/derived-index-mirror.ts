// The central mirror of a Project's FS v8 derived index.
//
// On first use per Project the summary index (`read-index.ts`) is seeded from
// the merged derived index (snapshot plus unmerged events): Run summaries,
// their archive sidecar verdicts, Experiment README rows and the Run walk,
// each with its recorded verification time and a device-less fingerprint.
// List pages therefore render after a restart without a walk or a README
// read, and the existing windows decide when an entry is re-validated.
//
// A seeded entry served past its window is not re-validated by the request
// that served it: the request returns the snapshot value and hands the entry
// to the background validator's queue (stale-while-revalidate without any
// request-path I/O). Only the documents a detail page shows are read
// synchronously.
//
// While a Project is active (a request within the last 10 minutes) a
// background validator runs every 60 s, the first cycle right after seeding:
// it re-takes the fingerprints of every non-terminal Run, a rotating fifth of
// the terminal Runs (so each is checked at least every 300 s, i.e. one full
// pass within five minutes of the first request), every Experiment
// README/bundle and wiki page, drains the queue of stale entries served since
// the last cycle (in small batches that yield to requests), re-runs the
// bounded walk, and writes what changed back through one index event and a
// compaction. An idle Project costs nothing. A missing or unusable index
// leaves the summary index empty (7.4.0 behaviour); on a writable FS v8
// Project a rebuild is scheduled in the background.
//
// The derived index is a cache: nothing here is ever a reason for a page to
// fail. Every error falls back to the on-demand path.

import { basename, join, resolve } from 'node:path'
import {
  appendIndexEvent,
  compactIndex,
  type DiscoveredWikiPage,
  deriveExperimentEntry,
  deriveRunEntry,
  deriveWikiEntry,
  discoverRuns,
  type EffectiveRunDirs,
  type ExperimentIndexEntry,
  type IndexEvent,
  type IndexRole,
  type IndexSnapshot,
  indexKey,
  listIndexEvents,
  mergedIndexView,
  mergeIndexEvents,
  type NamedIndexEvent,
  type PersistedFingerprint,
  type ProjectConfig,
  parseEvent,
  parseExperimentReadme,
  parseReadme,
  projectFs,
  type RunIndexEntry,
  readDerivedIndex,
  readFsVersion,
  rebuildIndex,
  resolveEffectiveRunDirs,
  resolveIndexPaths,
  reusableWalk,
  validateIndexEntries,
  withProjectFileContext,
} from '@memon/core'
import { indexedWikiPages, wikiPageKey } from './indexed-documents.js'
import { experimentListing, experimentReadmeKey, type ParsedReadme } from './indexed-experiments.js'
import { indexedRun, type RunSummary, runSummaryKey } from './indexed-runs.js'
import { devlessFingerprint, type ProjectReadIndex, projectReadIndex } from './read-index.js'

/** Background validation cycle while a Project is active. */
export const VALIDATOR_CYCLE_MS = 60_000
/** A Project is active while a request arrived within this window. */
export const VALIDATOR_ACTIVE_MS = 10 * 60_000
/** Terminal Runs are re-checked in this many rotating buckets (5 × 60 s = 300 s). */
export const TERMINAL_RUN_BUCKETS = 5
/** Stale entries re-validated per batch before the validator yields to requests. */
export const STALE_BATCH_SIZE = 64

const TERMINAL: Record<string, true> = { FINISHED: true, FAILED: true, INTERRUPTED: true }

export interface DerivedIndexMirrorOptions {
  /** Run the background validator (default true). */
  validator?: boolean
  /** Start interval timers for the validator (default true; tests drive cycles). */
  timers?: boolean
  /** Writer role of the validator's events and compactions (default `central`). */
  role?: IndexRole
  now?: () => number
  cycleMs?: number
  activeMs?: number
}

/** What one validator cycle did (diagnostics, tests and measurements). */
export interface ValidatorCycleReport {
  status: 'idle' | 'skipped' | 'validated'
  checkedRuns: number
  changedRuns: number
  newRuns: number
  removedRuns: number
  changedExperiments: number
  changedWiki: number
  /** Events published by other writers that this cycle applied. */
  appliedEvents: number
  /** Seeded entries served stale since the last cycle and re-validated by it. */
  staleRevalidated: number
  compaction: 'compacted' | 'unchanged' | 'conflict' | 'unsupported' | 'not-written' | null
}

// ------------------------------------------------------------ fingerprints

function statForm(kind: 'f' | 'd', fingerprint: PersistedFingerprint): string {
  return `${kind}:*:${fingerprint.ino}:${fingerprint.size}:${fingerprint.mtime_ms}:${fingerprint.ctime_ms}`
}

/** The device-less form of the summary-index fingerprint of a Run entry. */
export function runEntryFingerprint(entry: RunIndexEntry): string | null {
  if (entry.has_readme && entry.readme_fp) return `readme:${statForm('f', entry.readme_fp)}`
  if (entry.dir_fp) return `dir:${statForm('d', entry.dir_fp)}`
  return null
}

function fileFingerprint(fingerprint: PersistedFingerprint | null): string | null {
  return fingerprint ? statForm('f', fingerprint) : null
}

function inMemoryDevless(index: ProjectReadIndex, key: string): string | null | undefined {
  const entry = index.peek(key)
  if (!entry) return undefined
  if (entry.fingerprint === null) return null
  return entry.devless ? entry.fingerprint : devlessFingerprint(entry.fingerprint)
}

// ------------------------------------------------------------ entry → value

/** The Run summary a derived-index entry stands for (no README read). */
export function runSummaryFromEntry(
  project: ProjectConfig,
  dir: string,
  entry: RunIndexEntry,
): RunSummary {
  const parsed = parseReadme('')
  const row = entry.row
  const frontMatterArchived = entry.archive_source === 'frontmatter' ? entry.archived : false
  const frontMatter = {
    ...parsed.frontMatter,
    id: row.id,
    name: row.name,
    project: row.project,
    status: entry.status,
    createdAt: entry.created_at ?? '',
    updatedAt: entry.updated_at ?? '',
    finishedAt: row.finished_at,
    host: row.host,
    pid: row.pid,
    gpus: [...row.gpus],
    entry: row.entry,
    command: row.command,
    wandb: row.wandb,
    hypotheses: [...row.hypotheses],
    tags: [...row.tags],
    experiment: null,
    archived: frontMatterArchived,
    deprecated: entry.deprecated,
  }
  const sidecarFallback = entry.archive_source !== 'frontmatter'
  return {
    run: {
      id: row.id || basename(dir),
      project: project.name,
      path: dir,
      mtime: row.mtime,
      readmeMtime: row.readme_mtime,
      hasReadme: entry.has_readme,
      frontMatter,
      sections: parsed.sections,
      warnings: [],
      warningsRaw: parsed.warningsRaw,
      body: '',
      parseErrors: row.parse_errors.map((issue) => ({ ...issue })),
      parseWarnings: row.parse_warnings.map((issue) => ({ ...issue })),
      frontMatterKeys: sidecarFallback ? [] : ['archived'],
      archived: sidecarFallback ? false : frontMatterArchived,
      deprecated: entry.deprecated,
    },
    eligibilityError: entry.eligibility_error,
    sidecarFallback,
    contained: entry.contained,
  }
}

interface ExperimentDocumentLocation {
  readmePath: string
  stem: string
}

function experimentDocument(project: ProjectConfig, key: string): ExperimentDocumentLocation {
  const absolute = join(project.root, ...key.split('/'))
  if (key.endsWith('.md')) return { readmePath: absolute, stem: basename(key).slice(0, -3) }
  return { readmePath: join(absolute, 'README.md'), stem: basename(key) }
}

/** The parsed Experiment README row a derived-index entry stands for. */
export function experimentReadmeFromEntry(entry: ExperimentIndexEntry, stem: string): ParsedReadme {
  const parsed = parseExperimentReadme('', stem)
  const row = entry.row
  parsed.frontMatter = {
    ...parsed.frontMatter,
    id: entry.id,
    slug: entry.slug,
    title: row.title,
    status: entry.status,
    archived: entry.archived,
    runs: [...entry.runs],
    hypotheses: [],
    tags: [...row.tags],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  parsed.parseErrors = row.parse_errors.map((issue) => ({ ...issue }))
  parsed.parseWarnings = row.parse_warnings.map((issue) => ({ ...issue }))
  return {
    parsed,
    mtime: row.readme_mtime,
    counts: { hypotheses: row.hypothesis_count, openWarnings: row.open_warning_count },
  }
}

/** Seed the summary index of `project` from a merged derived-index view. */
export function seedProjectReadIndex(
  project: ProjectConfig,
  view: IndexSnapshot,
  effective: EffectiveRunDirs | null,
): { runs: number; experiments: number; walk: boolean } {
  const index = projectReadIndex(project.root)
  let runs = 0
  for (const [key, entry] of Object.entries(view.runs)) {
    const dir = join(project.root, ...key.split('/'))
    const validatedAt = Date.parse(entry.verified_at)
    const summary = runSummaryFromEntry(project, dir, entry)
    if (
      index.seed(runSummaryKey(dir), {
        fingerprint: runEntryFingerprint(entry),
        value: summary,
        validatedAt,
      })
    )
      runs += 1
    if (summary.sidecarFallback) {
      const present = entry.archive_source === 'sidecar'
      index.seed(`sidecar:${join(dir, '.archived')}`, {
        fingerprint: present ? 'present' : null,
        value: present ? true : null,
        validatedAt,
      })
    }
  }
  let experiments = 0
  for (const [key, entry] of Object.entries(view.experiments)) {
    if (!entry.readme_fp) continue
    const { readmePath, stem } = experimentDocument(project, key)
    if (
      index.seed(experimentReadmeKey(readmePath, stem), {
        fingerprint: fileFingerprint(entry.readme_fp),
        value: experimentReadmeFromEntry(entry, stem),
        validatedAt: Date.parse(entry.verified_at),
      })
    )
      experiments += 1
  }
  const walk = effective ? reusableWalk(view, effective) : null
  const seededWalk =
    walk !== null &&
    index.seedWalk(
      walk.paths.map((path) => join(project.root, ...path.split('/'))),
      Date.parse(walk.verified_at),
    )
  return { runs, experiments, walk: seededWalk }
}

// ------------------------------------------------------------ the mirror

export class ProjectIndexMirror {
  private seeding: Promise<void> | null = null
  private view: IndexSnapshot | null = null
  private effective: EffectiveRunDirs | null = null
  private readonly knownEvents = new Set<string>()
  private lastActivity = Number.NEGATIVE_INFINITY
  private timer: ReturnType<typeof setInterval> | null = null
  private cycle = 0
  private cycling: Promise<ValidatorCycleReport> | null = null
  private rebuilding: Promise<void> | null = null
  /** Seeded entries served past their window, waiting for the next cycle. */
  private readonly staleQueue = new Map<string, () => Promise<boolean>>()

  constructor(
    readonly project: ProjectConfig,
    private readonly options: DerivedIndexMirrorOptions = {},
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private get writable(): boolean {
    return this.project.readOnly !== true
  }

  /** Number of stale entries waiting for the next cycle (diagnostics, tests). */
  get pendingStale(): number {
    return this.staleQueue.size
  }

  /** Route stale seeded entries of this Project to the validator's queue. */
  private adoptStaleEntries(): void {
    projectReadIndex(this.project.root).setStaleHandler((key, revalidate) => {
      if (!this.staleQueue.has(key)) this.staleQueue.set(key, revalidate)
    })
  }

  /** The merged view this process last read or wrote (tests). */
  get currentView(): IndexSnapshot | null {
    return this.view
  }

  /** A request for this Project arrived: keep (or start) the validator. */
  noteActivity(): void {
    this.lastActivity = this.now()
    if (this.options.validator === false || this.options.timers === false || this.timer) return
    const timer = setInterval(() => {
      this.runCycle().catch(() => undefined)
    }, this.options.cycleMs ?? VALIDATOR_CYCLE_MS)
    timer.unref?.()
    this.timer = timer
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Seed once per process; concurrent callers share the one seeding. */
  ensureSeeded(): Promise<void> {
    this.seeding ??= this.seed().catch(() => undefined)
    return this.seeding
  }

  private async resolveRunDirs(): Promise<EffectiveRunDirs | null> {
    try {
      return await resolveEffectiveRunDirs({
        root: this.project.root,
        centralRunDirs: this.project.runDirs,
      })
    } catch {
      // An invalid declaration fails the walk itself (fail closed); the
      // recorded walk is simply not reused.
      return null
    }
  }

  private async seed(): Promise<void> {
    this.effective = await this.resolveRunDirs()
    const read = await readDerivedIndex(this.project.root)
    for (const { name } of read.events) this.knownEvents.add(name)
    const view = mergedIndexView(read, {
      runDirs: this.effective?.patterns ?? [],
      runDirsSource: this.effective?.source ?? 'default',
    })
    if (!view) {
      if (read.snapshotState !== 'unsupported') this.scheduleRebuild()
      return
    }
    this.view = view
    seedProjectReadIndex(this.project, view, this.effective)
    this.adoptStaleEntries()
    // The first background cycle starts at once (stale-while-revalidate).
    if (this.options.validator !== false && this.options.timers !== false) {
      setImmediate(() => {
        this.runCycle().catch(() => undefined)
      })
    }
  }

  /** No usable index: rebuild it in the background on a writable FS v8 Project. */
  private scheduleRebuild(): void {
    if (this.options.validator === false || !this.writable || this.rebuilding) return
    this.rebuilding = this.inContext(async () => {
      const marker = await readFsVersion(this.project.root).catch(() => null)
      if (!marker || marker.fs_convention_version < 8) return
      const result = await rebuildIndex(this.project.root, {
        role: this.options.role ?? 'central',
        ...(this.project.runDirs ? { centralRunDirs: this.project.runDirs } : {}),
        include: this.project.include,
        exclude: this.project.exclude,
      })
      if (result.snapshot) {
        this.view = result.snapshot
        seedProjectReadIndex(this.project, result.snapshot, result.runDirs)
        this.adoptStaleEntries()
      }
    })
      .catch(() => undefined)
      .finally(() => {
        this.rebuilding = null
      })
  }

  private inContext<T>(callback: () => Promise<T>): Promise<T> {
    const project = this.project
    return withProjectFileContext(
      {
        root: project.root,
        storageGroup: project.storageGroup ?? project.name,
        // The configuration default: an unconfigured Project is local.
        storage: project.storage ?? 'local',
        reason: 'automatic',
        readOnly: project.readOnly === true,
        persistentCache: project.persistentCache === true,
      },
      callback,
    )
  }

  /** One validator cycle; overlapping calls share the running one. */
  runCycle(): Promise<ValidatorCycleReport> {
    this.cycling ??= this.validate().finally(() => {
      this.cycling = null
    })
    return this.cycling
  }

  private async validate(): Promise<ValidatorCycleReport> {
    const report: ValidatorCycleReport = {
      status: 'validated',
      checkedRuns: 0,
      changedRuns: 0,
      newRuns: 0,
      removedRuns: 0,
      changedExperiments: 0,
      changedWiki: 0,
      appliedEvents: 0,
      staleRevalidated: 0,
      compaction: null,
    }
    if (this.now() - this.lastActivity > (this.options.activeMs ?? VALIDATOR_ACTIVE_MS)) {
      // Idle: no I/O at all until the next request.
      this.stop()
      return { ...report, status: 'idle' }
    }
    await this.ensureSeeded()
    if (!this.view) return { ...report, status: 'skipped' }
    return this.inContext(() => this.validateActive(report))
  }

  private async validateActive(report: ValidatorCycleReport): Promise<ValidatorCycleReport> {
    const project = this.project
    const root = project.root
    const index = projectReadIndex(root)
    const now = this.now()
    const cycle = this.cycle++
    const abs = (key: string) => join(root, ...key.split('/'))

    // 1. Other writers' events: apply them to the view and make the affected
    //    in-process entries re-validate on their next read.
    // Only the event listing and the new events are read, never the snapshot.
    const fresh: NamedIndexEvent[] = []
    for (const name of await listIndexEvents(root).catch(() => [] as string[])) {
      if (this.knownEvents.has(name)) continue
      try {
        const raw = await projectFs.readFile(join(resolveIndexPaths(root).events, name), 'utf8')
        const verdict = parseEvent(JSON.parse(raw))
        if (verdict.ok) fresh.push({ name, event: verdict.value })
        else if (verdict.reason !== 'invalid') this.knownEvents.add(name)
      } catch {
        // Compacted meanwhile, or still being written: the next cycle sees it.
      }
    }
    for (const { name, event } of fresh) {
      this.knownEvents.add(name)
      for (const key of [...Object.keys(event.upserts.runs ?? {}), ...(event.removals.runs ?? [])])
        index.expire(runSummaryKey(abs(key)))
      for (const key of [
        ...Object.keys(event.upserts.experiments ?? {}),
        ...(event.removals.experiments ?? []),
      ]) {
        const { readmePath, stem } = experimentDocument(project, key)
        index.expire(experimentReadmeKey(readmePath, stem))
      }
    }
    report.appliedEvents = fresh.length
    let view = this.view!
    if (fresh.length > 0) view = mergeIndexEvents(view, fresh)

    // 2. The bounded walk (new and vanished Run directories).
    const walked = await index.walk(project, 0, (target) =>
      discoverRuns(target, { includeArchived: true }),
    )
    const walkedKeys = new Set(walked.map((dir) => indexKey(root, dir)))

    // 3. Runs: non-terminal every cycle, terminal ones in a rotation.
    const bucket = cycle % TERMINAL_RUN_BUCKETS
    const candidates = new Set<string>([...walkedKeys, ...Object.keys(view.runs)])
    const changedRuns: string[] = []
    const removedRuns: string[] = []
    await mapLimited([...candidates], 16, async (key) => {
      const persisted = view.runs[key]
      if (persisted && TERMINAL[persisted.status] === true && hashBucket(key) !== bucket) return
      const dir = abs(key)
      report.checkedRuns += 1
      let summary: RunSummary | null
      try {
        summary = await indexedRun(project, dir, 0)
      } catch {
        return
      }
      if (summary === null) {
        if (persisted) removedRuns.push(dir)
        return
      }
      if (!persisted) {
        changedRuns.push(dir)
        report.newRuns += 1
        return
      }
      if (inMemoryDevless(index, runSummaryKey(dir)) !== runEntryFingerprint(persisted)) {
        changedRuns.push(dir)
        report.changedRuns += 1
      }
    })
    report.removedRuns = removedRuns.length

    // 3b. Seeded entries served stale since the last cycle (Run summaries
    //     outside this cycle's bucket, archive sidecars, Experiment rows):
    //     re-validated in batches that yield to requests. Entries step 3
    //     already re-validated are skipped without I/O.
    //     A drained Run whose fingerprint moved is written back like one
    //     step 3 found.
    report.staleRevalidated = await this.drainStale()
    const handled = new Set([...changedRuns, ...removedRuns])
    for (const key of candidates) {
      const persisted = view.runs[key]
      const dir = abs(key)
      if (!persisted || handled.has(dir)) continue
      const current = inMemoryDevless(index, runSummaryKey(dir))
      if (current === undefined || current === runEntryFingerprint(persisted)) continue
      changedRuns.push(dir)
      report.changedRuns += 1
    }

    // 4. Experiments (README and YAML fingerprints) and new documents.
    const experiments = await validateIndexEntries(root, view, {
      maxAgeMs: 0,
      kinds: ['experiments'],
      now: () => new Date(now),
    })
    const changedExperiments = new Set<string>()
    for (const stale of experiments.stale) changedExperiments.add(stale.key)
    for (const { key } of experiments.verified) {
      const { readmePath, stem } = experimentDocument(project, key)
      index.confirm(
        experimentReadmeKey(readmePath, stem),
        fileFingerprint(view.experiments[key]!.readme_fp),
        now,
      )
    }
    const listing = await experimentListing(project, 0)
    for (const [, entry] of listing.folders) {
      const key = `docs/experiments/${entry.name}`
      if (!view.experiments[key]) changedExperiments.add(key)
    }
    for (const [id, entry] of listing.legacy) {
      const key = `docs/experiments/${entry.name}`
      if (!listing.folders.has(id) && !view.experiments[key]) changedExperiments.add(key)
    }
    for (const key of changedExperiments) {
      const { readmePath, stem } = experimentDocument(project, key)
      index.expire(experimentReadmeKey(readmePath, stem))
    }
    report.changedExperiments = changedExperiments.size

    // 5. Wiki pages (listing plus one stat per page; a changed page is re-read).
    const pages = await indexedWikiPages(
      project,
      { listMaxAgeMs: 0, terminalRunMaxAgeMs: 0, walkRefreshMs: 0 },
      { assets: false },
    )
    const changedPages: DiscoveredWikiPage[] = []
    const seenPages = new Set<string>()
    for (const page of pages) {
      seenPages.add(page.path)
      const persisted = view.wiki[page.path]
      if (
        !persisted ||
        inMemoryDevless(index, wikiPageKey(page.absolutePath)) !== fileFingerprint(persisted.fp)
      )
        changedPages.push(page)
    }
    const removedPages = Object.keys(view.wiki).filter((key) => !seenPages.has(key))
    report.changedWiki = changedPages.length + removedPages.length

    // 6. Write back what changed: one event, then a compaction.
    const body = await this.changeEvent(
      changedRuns,
      walkedKeys,
      removedRuns,
      changedExperiments,
      changedPages,
      removedPages,
    )
    const hasChanges = Object.keys(body.upserts).length > 0 || Object.keys(body.removals).length > 0
    if (!hasChanges && fresh.length === 0) {
      this.view = view
      return report
    }
    if (!this.writable) {
      if (hasChanges) view = mergeIndexEvents(view, [{ name: `~${now}`, event: body }])
      this.view = view
      report.compaction = 'not-written'
      return report
    }
    if (hasChanges) {
      const sink = { projectRoot: root, role: this.options.role ?? 'central' } as const
      const published = await appendIndexEvent(sink, 'central.validate', {
        upserts: body.upserts,
        removals: body.removals,
      })
      if (published.name) this.knownEvents.add(published.name)
    }
    const compacted = await compactIndex(root, {
      role: this.options.role ?? 'central',
      ...(this.effective ? { runDirs: this.effective } : {}),
    })
    report.compaction = compacted.status
    if (compacted.snapshot) {
      for (const name of compacted.merged) this.knownEvents.delete(name)
      this.view = compacted.snapshot
    } else {
      this.view = hasChanges ? mergeIndexEvents(view, [{ name: `~${now}`, event: body }]) : view
    }
    return report
  }

  /** Re-validate every queued stale entry, `STALE_BATCH_SIZE` at a time. */
  private async drainStale(): Promise<number> {
    let done = 0
    while (this.staleQueue.size > 0) {
      const batch = [...this.staleQueue].slice(0, STALE_BATCH_SIZE)
      for (const [key] of batch) this.staleQueue.delete(key)
      await mapLimited(batch, 8, async ([, revalidate]) => {
        if (await revalidate().catch(() => false)) done += 1
      })
      // Let requests run between batches.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    return done
  }

  private async changeEvent(
    changedRuns: readonly string[],
    walkedKeys: ReadonlySet<string>,
    removedRuns: readonly string[],
    changedExperiments: ReadonlySet<string>,
    changedPages: readonly DiscoveredWikiPage[],
    removedPages: readonly string[],
  ): Promise<IndexEvent> {
    const root = this.project.root
    const upserts: IndexEvent['upserts'] = {}
    const removals: IndexEvent['removals'] = {}
    const runs: NonNullable<IndexEvent['upserts']['runs']> = {}
    const goneRuns = new Set(removedRuns.map((dir) => indexKey(root, dir)))
    await mapLimited(changedRuns, 8, async (dir) => {
      const key = indexKey(root, dir)
      const entry = await deriveRunEntry({
        projectRoot: root,
        runDir: dir,
        // A walked directory is never a followed link.
        contained: walkedKeys.has(key) || this.view?.runs[key]?.contained === true,
      }).catch(() => null)
      if (entry) runs[key] = entry
      else goneRuns.add(key)
    })
    if (Object.keys(runs).length > 0) upserts.runs = runs
    if (goneRuns.size > 0) removals.runs = [...goneRuns].sort()
    const experiments: NonNullable<IndexEvent['upserts']['experiments']> = {}
    const goneExperiments: string[] = []
    for (const key of changedExperiments) {
      const derived = await deriveExperimentEntry({
        projectRoot: root,
        readmePath: experimentDocument(this.project, key).readmePath,
      }).catch(() => null)
      if (derived) experiments[derived.key] = derived.entry
      else goneExperiments.push(key)
    }
    if (Object.keys(experiments).length > 0) upserts.experiments = experiments
    if (goneExperiments.length > 0) removals.experiments = goneExperiments.sort()
    const wiki: NonNullable<IndexEvent['upserts']['wiki']> = {}
    for (const page of changedPages) {
      const derived = await deriveWikiEntry({ page }).catch(() => null)
      if (derived) wiki[derived.key] = derived.entry
    }
    if (Object.keys(wiki).length > 0) upserts.wiki = wiki
    if (removedPages.length > 0) removals.wiki = [...removedPages].sort()
    return {
      index_version: 1,
      written_at: new Date(this.now()).toISOString(),
      writer: { release: '', role: this.options.role ?? 'central', op: 'central.validate' },
      upserts,
      removals,
    }
  }
}

function hashBucket(key: string): number {
  let hash = 0
  for (let index = 0; index < key.length; index++) hash = (hash * 31 + key.charCodeAt(index)) | 0
  return Math.abs(hash) % TERMINAL_RUN_BUCKETS
}

async function mapLimited<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!)
    }),
  )
}

// ------------------------------------------------------------ registry

const mirrors = new Map<string, ProjectIndexMirror>()

/**
 * Serve these Projects from their derived indexes (central only). Standalone
 * routes and the CLI never enable it: they validate every read.
 */
export function enableDerivedIndex(
  projects: readonly ProjectConfig[],
  options: DerivedIndexMirrorOptions = {},
): void {
  for (const project of projects) {
    const key = resolve(project.root)
    if (!mirrors.has(key)) mirrors.set(key, new ProjectIndexMirror(project, options))
  }
}

/** The mirror of a Project root, when its derived index is enabled. */
export function derivedIndexMirror(root: string): ProjectIndexMirror | undefined {
  return mirrors.get(resolve(root))
}

/**
 * Before a read of `project`: note the activity and seed its summary index
 * once from the derived index. A no-op when the derived index is not enabled
 * for the Project; never throws.
 */
export async function prepareProjectIndex(project: ProjectConfig): Promise<void> {
  const mirror = mirrors.get(resolve(project.root))
  if (!mirror) return
  mirror.noteActivity()
  await mirror.ensureSeeded()
}

/** Stop every validator and forget every mirror (tests; safe at any time). */
export function dropDerivedIndexMirrors(): void {
  for (const mirror of mirrors.values()) mirror.stop()
  mirrors.clear()
}
