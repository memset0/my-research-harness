// Module-level singleton holding the live experiment index, file caches,
// poller, and event bus shared across all API routes.
//
// Lifecycle:
//   - Initialized lazily on first request (so importing the module is cheap)
//   - Eagerly warmed up via apps/web/instrumentation.ts on server start
//   - Kept across requests in the Next.js dev server (module state persists)
//
// Production model: `memon serve` spawns Next.js with MEMON_CONFIG_PATH set;
// in dev `pnpm --filter @memon/web dev` we walk up to find the repo's
// config.yml (or config.example.yml as last-resort fallback).

import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  computeMembership,
  DIGEST_FILENAME_REGEX,
  discoverExperiments,
  discoverRuns,
  EXPERIMENT_FILENAME_REGEX,
  extractTitle,
  loadConfig,
  parseHypotheses,
  parseJournal,
  Poller,
  readExperimentDoc,
  readRunDir,
  REPORT_FILENAME_REGEX,
  RunIndex,
  type AuthConfig,
  type Config,
  type DigestSummary,
  type Experiment,
  type ExperimentMembershipAnomaly,
  type ParsedHypotheses,
  type ParsedJournal,
  type ReportSummary,
  type Run,
} from '@memon/core'
import { DirCache } from './runtime/dir-cache'
import { FileCache } from './runtime/file-cache'
import { ensureAuthInitialised } from './auth/first-run'

export interface ExperimentChangeEvent {
  type: 'set' | 'delete'
  experiment?: Run
  id: string
}

export class Runtime {
  /** Set when init() resolves; used by /api/runtime/health */
  public warmupAt: number = Date.now()
  /** Most recent error during init or background refresh */
  public lastError: string | null = null

  constructor(
    public readonly config: Config,
    public readonly configPath: string,
    public readonly index: RunIndex,
    public readonly poller: Poller,
    public readonly events: EventEmitter,
    public readonly hypothesesCache: FileCache<ParsedHypotheses>,
    public readonly journalCache: FileCache<ParsedJournal>,
    public readonly reportsCache: DirCache<ReportSummary>,
    public readonly digestsCache: DirCache<DigestSummary>,
    public readonly auth: AuthConfig,
    /**
     * v3 experiment-doc index, keyed by `E<NNNN>-<slug>`. Shared by reference
     * with the poller closure so poll-driven mutations and API reads see the
     * same Map.
     */
    public readonly experiments: Map<string, Experiment>,
    /**
     * v3 anomaly snapshot per project name. Mutated by recomputeAnomalies();
     * /api/anomalies reads in O(1).
     */
    public readonly anomaliesByProject: Map<string, ExperimentMembershipAnomaly[]>,
    /**
     * Recompute closure shared with the poller (so both reference the same
     * `experiments` / `anomaliesByProject` maps and emit the same SSE
     * `anomaly` topic on each recompute).
     */
    public readonly recomputeAnomalies: (projectName: string) => void,
  ) {}

  /** Reset poll backoff for the experiment whose path matches `path`. */
  pokeByPath(path: string): void {
    this.poller.resetBackoff(path)
  }

  pokeById(id: string): void {
    const exp = this.index.get(id)
    if (exp) this.poller.resetBackoff(exp.path)
  }

  /** Find the project that owns the given absolute path (or null). */
  projectFor(absolutePath: string): { name: string; root: string } | null {
    for (const p of this.config.projects) {
      if (absolutePath === p.root || absolutePath.startsWith(`${p.root}/`)) {
        return { name: p.name, root: p.root }
      }
    }
    return null
  }

  /** Path to <project>/docs/hypotheses.md for the given project name (or null). */
  hypothesesPath(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'hypotheses.md') : null
  }

  /** Path to <project>/docs/journal.md for the given project name (or null). */
  journalPath(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'journal.md') : null
  }

  /** Path to <project>/docs/reports/ for the given project (or null). */
  reportsDir(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'reports') : null
  }

  /** Path to <project>/docs/digests/ for the given project (or null). */
  digestsDir(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'docs', 'digests') : null
  }
}

let runtimePromise: Promise<Runtime> | null = null

export async function getRuntime(): Promise<Runtime> {
  if (!runtimePromise) runtimePromise = init()
  return runtimePromise
}

async function init(): Promise<Runtime> {
  const configPath = await resolveConfigPath()
  if (!configPath) {
    throw new Error(
      'memon: no config file found. Set MEMON_CONFIG_PATH or place config.yml in the repo root',
    )
  }
  const config = await loadConfig({ explicitPath: configPath, cwd: process.cwd() })
  if (!config) {
    throw new Error(`memon: failed to load config at ${configPath}`)
  }

  // First-run init: if config.yml has no auth.password_hash, generate one,
  // write the hash back, print the plaintext once. Idempotent on subsequent
  // boots.
  const auth = await ensureAuthInitialised(configPath, config)

  const index = new RunIndex()
  const events = new EventEmitter()
  events.setMaxListeners(50)

  // Per-project file caches for docs/hypotheses.md / docs/journal.md
  const hypothesesPaths = config.projects.map((p) => join(p.root, 'docs', 'hypotheses.md'))
  const journalPaths = config.projects.map((p) => join(p.root, 'docs', 'journal.md'))

  const hypothesesCache = new FileCache<ParsedHypotheses>({
    name: 'hypotheses',
    paths: hypothesesPaths,
    parse: parseHypotheses,
  })
  const journalCache = new FileCache<ParsedJournal>({
    name: 'journal',
    paths: journalPaths,
    parse: parseJournal,
  })

  // Per-project directory caches for docs/reports/ and docs/digests/.
  const reportsDirs = config.projects.map((p) => join(p.root, 'docs', 'reports'))
  const digestsDirs = config.projects.map((p) => join(p.root, 'docs', 'digests'))

  const reportsCache = new DirCache<ReportSummary>({
    name: 'reports',
    dirs: reportsDirs,
    fileNameRegex: REPORT_FILENAME_REGEX,
    parseFile: (absPath, content, mtime) => {
      const name = basename(absPath)
      const m = REPORT_FILENAME_REGEX.exec(name)!
      return {
        id: `R${m[1]}`,
        slug: m[2]!,
        path: absPath,
        mtime,
        title: extractTitle(content),
      }
    },
    onUpdate: (dir) => {
      const project = projectForDir(config, dir)
      if (project) events.emit('reports-change', { project })
    },
  })
  const digestsCache = new DirCache<DigestSummary>({
    name: 'digests',
    dirs: digestsDirs,
    fileNameRegex: DIGEST_FILENAME_REGEX,
    parseFile: (absPath, content, mtime) => {
      const name = basename(absPath)
      const m = DIGEST_FILENAME_REGEX.exec(name)!
      return {
        id: `D${m[1]}`,
        date: m[2]!,
        path: absPath,
        mtime,
        title: extractTitle(content),
      }
    },
    onUpdate: (dir) => {
      const project = projectForDir(config, dir)
      if (project) events.emit('digests-change', { project })
    },
  })

  // Shared, mutable state captured by both the Poller closure and the
  // Runtime instance. The Runtime constructor takes these by reference so
  // poll-driven mutations and API-route reads see the same Map.
  const sharedExperiments: Map<string, Experiment> = new Map()
  const sharedAnomalies: Map<string, ExperimentMembershipAnomaly[]> = new Map()
  const recomputeAnomalies = (projectName: string) => {
    const exps = Array.from(sharedExperiments.values()).filter((e) => e.project === projectName)
    const runs = index.list({ project: projectName })
    const result = computeMembership({ experiments: exps, runs, project: projectName })
    sharedAnomalies.set(projectName, result.anomalies)
    events.emit('anomaly', { project: projectName, count: result.anomalies.length })
  }

  // Single Poller instance dispatched by path-membership to the right handler.
  const poller = new Poller(
    {
      minIntervalMs: config.poll.minIntervalMs,
      maxIntervalMs: config.poll.maxIntervalMs,
      backoffFactor: config.poll.backoffFactor,
    },
    async (path) => {
      // Try file caches first (cheap O(1) Set membership check each).
      if (hypothesesCache.handlePollChange(path)) return
      if (journalCache.handlePollChange(path)) return
      // Try directory caches (handles both dir-mtime and per-file changes).
      if (reportsCache.handlePollChange(path, poller)) return
      if (digestsCache.handlePollChange(path, poller)) return

      // v3: docs/experiments/ directory mtime advance → rediscover the
      // exp-doc set for the owning project. Individual file changes are
      // handled below (they also fall through to here).
      const expDirMatch = config.projects.find((p) => path === join(p.root, 'docs', 'experiments'))
      if (expDirMatch) {
        try {
          const { experiments: discovered } = await discoverExperiments(
            expDirMatch.root,
            expDirMatch.name,
          )
          const seen = new Set<string>()
          for (const e of discovered) {
            seen.add(e.id)
            // Register per-file watch so individual edits also get caught.
            poller.watch(e.path, e.mtime)
          }
          // Replace the project's slice of the experiments map.
          for (const id of Array.from(sharedExperiments.keys())) {
            const cur = sharedExperiments.get(id)!
            if (cur.project !== expDirMatch.name) continue
            if (!seen.has(id)) sharedExperiments.delete(id)
          }
          for (const e of discovered) sharedExperiments.set(e.id, e)
          recomputeAnomalies(expDirMatch.name)
          events.emit('experiment-change', { type: 'rediscover', project: expDirMatch.name })
        } catch {
          // Best-effort — keep existing state on transient errors.
        }
        return
      }

      // v3: individual exp doc file change.
      const expFileMatch = config.projects.find(
        (p) =>
          path.startsWith(join(p.root, 'docs', 'experiments') + '/') && path.endsWith('.md'),
      )
      if (expFileMatch) {
        const filename = basename(path)
        const m = EXPERIMENT_FILENAME_REGEX.exec(filename)
        if (m) {
          const expId = filename.replace(/\.md$/, '')
          try {
            const updated = await readExperimentDoc(expFileMatch.root, expFileMatch.name, expId)
            if (updated) {
              sharedExperiments.set(expId, updated)
            } else {
              sharedExperiments.delete(expId)
            }
            recomputeAnomalies(expFileMatch.name)
            events.emit('experiment-change', {
              type: updated ? 'set' : 'delete',
              id: expId,
              experiment: updated ?? undefined,
            })
          } catch {
            // best-effort
          }
        }
        return
      }

      // Otherwise this is a run directory.
      const projectMatch = config.projects.find(
        (p) => path === p.root || path.startsWith(`${p.root}/`),
      )
      if (!projectMatch) return
      try {
        const exp = await readRunDir(path, projectMatch.name)
        index.set(exp)
        events.emit('run-change', {
          type: 'set',
          id: exp.id,
          experiment: exp,
          parentExperimentId: exp.frontMatter.experiment ?? null,
        })
      } catch {
        // If directory disappeared, drop from index silently
      }
    },
  )

  // Initial scan + parse + watch — file caches, dir caches, run scan, and
  // experiment-doc scan in parallel.
  const t0 = Date.now()
  const experimentsByProject = new Map<string, Experiment[]>()
  await Promise.all([
    hypothesesCache.warmup(),
    journalCache.warmup(),
    reportsCache.warmup(),
    digestsCache.warmup(),
    (async () => {
      for (const project of config.projects) {
        const dirs = await discoverRuns(project)
        for (const dir of dirs) {
          try {
            const exp = await readRunDir(dir, project.name)
            index.set(exp)
            poller.watch(dir, exp.mtime)
          } catch {
            // Skip unreadable directories
          }
        }
      }
    })(),
    (async () => {
      for (const project of config.projects) {
        const { experiments: docs } = await discoverExperiments(project.root, project.name)
        experimentsByProject.set(project.name, docs)
        // Register the docs/experiments/ dir for poll tracking + each
        // discovered file for individual-mtime watch (task 5.6).
        const expDir = join(project.root, 'docs', 'experiments')
        poller.watch(expDir, await dirMtimeOrZero(expDir))
        for (const doc of docs) {
          poller.watch(doc.path, doc.mtime)
        }
      }
    })(),
  ])

  // Register watch entries for the file caches with the mtimes observed during
  // warmup. Must happen after warmup so the Poller's "lastSeen mtime" is
  // accurate (else the very first tick would unnecessarily refire).
  for (const p of hypothesesPaths) {
    const entry = hypothesesCache.get(p)
    poller.watch(p, entry?.mtime ?? 0)
  }
  for (const p of journalPaths) {
    const entry = journalCache.get(p)
    poller.watch(p, entry?.mtime ?? 0)
  }

  // Register dir-level + per-file watch for reports/digests. Both the
  // directory mtime (advances on add/remove) and each individual file
  // (advances on edit) are watched.
  for (const dir of reportsCache.dirs()) {
    poller.watch(dir, await dirMtimeOrZero(dir))
  }
  for (const filePath of reportsCache.paths()) {
    poller.watch(filePath, await fileMtimeOrZero(filePath))
  }
  for (const dir of digestsCache.dirs()) {
    poller.watch(dir, await dirMtimeOrZero(dir))
  }
  for (const filePath of digestsCache.paths()) {
    poller.watch(filePath, await fileMtimeOrZero(filePath))
  }

  const expDocCount = Array.from(experimentsByProject.values()).reduce(
    (n, list) => n + list.length,
    0,
  )
  // eslint-disable-next-line no-console
  console.log(
    `memon: warmup complete in ${Date.now() - t0}ms — ${index.size()} runs, ` +
      `${expDocCount} experiments, ` +
      `${hypothesesCache.populated()}/${hypothesesPaths.length} hypotheses files, ` +
      `${journalCache.populated()}/${journalPaths.length} journal files, ` +
      `${reportsCache.paths().length} reports, ${digestsCache.paths().length} digests`,
  )

  // Seed shared maps (used by both the poller closure and the Runtime
  // instance, by reference) before constructing the Runtime.
  for (const [, docs] of experimentsByProject) {
    for (const doc of docs) sharedExperiments.set(doc.id, doc)
  }

  const runtime = new Runtime(
    config,
    configPath,
    index,
    poller,
    events,
    hypothesesCache,
    journalCache,
    reportsCache,
    digestsCache,
    auth,
    sharedExperiments,
    sharedAnomalies,
    recomputeAnomalies,
  )
  for (const [projectName] of experimentsByProject) {
    recomputeAnomalies(projectName)
  }

  return runtime
}

function projectForDir(config: Config, dir: string): string | null {
  for (const p of config.projects) {
    if (dir === join(p.root, 'docs', 'reports')) return p.name
    if (dir === join(p.root, 'docs', 'digests')) return p.name
  }
  return null
}

async function dirMtimeOrZero(dir: string): Promise<number> {
  try {
    const stat = await fs.stat(dir)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

async function fileMtimeOrZero(path: string): Promise<number> {
  try {
    const stat = await fs.stat(path)
    return stat.mtimeMs
  } catch {
    return 0
  }
}

async function resolveConfigPath(): Promise<string | null> {
  if (process.env.MEMON_CONFIG_PATH) return process.env.MEMON_CONFIG_PATH

  // Walk up from cwd looking for pnpm-workspace.yaml (= repo root)
  let dir = process.cwd()
  while (true) {
    try {
      await fs.access(join(dir, 'pnpm-workspace.yaml'))
      for (const candidate of [join(dir, 'config.yml'), join(dir, 'config.example.yml')]) {
        try {
          await fs.access(candidate)
          return candidate
        } catch {
          // continue
        }
      }
      return null
    } catch {
      // continue walking
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
