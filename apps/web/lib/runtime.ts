// Process-wide singleton holding the live experiment index, file caches,
// poller, and event bus shared across all API routes.
//
// Lifecycle:
//   - Initialized lazily on first request (so importing the module is cheap)
//   - Eagerly warmed up via apps/web/instrumentation.ts on server start
//   - Shared across separately bundled routes and Next.js dev reloads
//
// Production model: `memon serve` spawns Next.js with MEMON_CONFIG_PATH set;
// in dev `pnpm --filter @memon/web dev` we walk up to find the repo's
// instance config.yml. The committed config.example.yml is never a runtime
// configuration source.

import { promises as fs } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  CODE_REVIEW_FILENAME_REGEX,
  computeMembership,
  projectRunPath,
  configureProjectFileStore,
  configureProjectFileCache,
  deriveCompletion,
  discoverExperiments,
  parseCodeReview,
  discoverRuns,
  EXPERIMENT_DIR_REGEX,
  EXPERIMENT_FILENAME_REGEX,
  extractTitle,
  loadConfig,
  MANAGED_DOCUMENT_FILE_NAMES,
  parseHypotheses,
  parseJournal,
  Poller,
  readExperimentDoc,
  readRunDir,
  REPORT_FILENAME_REGEX,
  RunIndex,
  type AuthConfig,
  type CodeReviewSummary,
  type Config,
  type Experiment,
  type ExperimentMembershipAnomaly,
  type ParsedHypotheses,
  type ParsedJournal,
  type ReportSummary,
  type Run,
} from '@memon/core'
import { servesProjectsDirectly } from './central/direct-projects'
import { DirCache } from './runtime/dir-cache'
import { FileCache } from './runtime/file-cache'
import { WikiCache } from './runtime/wiki-cache'
import { ensureAuthInitialised } from './auth/first-run'
import { resolveRuntimeConfigPath } from './runtime-config-path'
import { listComponents } from './wiki-components/registry'
import { probeSqueue } from './slurm/probe'

export interface ExperimentChangeEvent {
  type: 'set' | 'delete'
  experiment?: Run
  id: string
}

export interface SlurmRuntimeState {
  /** True iff `Config.slurm.totalNodes !== -1` AND the startup probe passed. */
  enabled: boolean
  /** Mirror of `Config.slurm.totalNodes` when enabled; `-1` otherwise. */
  totalNodes: number
  /** Probe outcome. False when the probe was skipped (feature disabled). */
  supported: boolean
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
    public readonly codeReviewsCache: DirCache<CodeReviewSummary>,
    public readonly wikiCache: WikiCache,
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
    /**
     * Slurm feature state captured at init time. `/api/slurm/status` reads
     * this; when `enabled === false` the API short-circuits to
     * `{ enabled: false }` without spawning `squeue`.
     */
    public readonly slurm: SlurmRuntimeState,
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

  /**
   * Aggregated code-reviews for a project across the flat docs/code-review/
   * dir and every docs/experiments/E-slug/code-review/ dir, sorted by date
   * desc (ties broken by id desc).
   */
  getCodeReviewsList(project: string): CodeReviewSummary[] {
    const p = this.config.projects.find((x) => x.name === project)
    if (!p) return []
    const prefix = join(p.root, 'docs') + '/'
    return this.codeReviewsCache
      .getAllList()
      .filter((s) => s.path.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
  }

  /**
   * Absolute path for a code-review id (the docs-relative path without the
   * .md extension) in a project. Returns null for an unknown project. The
   * caller MUST still validate via assertWithinProjectRoots().
   */
  codeReviewPath(project: string, id: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    if (!p) return null
    return join(p.root, 'docs', `${id}.md`)
  }
}

// Next can bundle this module separately for multiple routes. Startup config
// and the shared Store/cache state must still be initialized once.
const RUNTIME_KEY = Symbol.for('memon.web-runtime.v1')

export async function getRuntime(): Promise<Runtime> {
  const shared = globalThis as typeof globalThis & { [RUNTIME_KEY]?: Promise<Runtime> }
  return (shared[RUNTIME_KEY] ??= init())
}

async function init(): Promise<Runtime> {
  const configPath = await resolveRuntimeConfigPath({
    cwd: process.cwd(),
    explicitPath: process.env.MEMON_CONFIG_PATH,
  })
  if (!configPath) {
    throw new Error(
      'memon: no instance config found. Copy config.example.yml to config.yml, ' +
        'set MEMON_CONFIG_PATH, or place config.yml in the repo root',
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

  // Slurm capability probe. When the user opts in via `slurm.total_nodes`,
  // we MUST be able to run `squeue --me` — refuse to start otherwise so the
  // failure surfaces at deploy time, not buried in a 500 nobody reads.
  let slurm: SlurmRuntimeState
  if (config.slurm.totalNodes === -1) {
    slurm = { enabled: false, totalNodes: -1, supported: false }
  } else {
    const probe = await probeSqueue()
    if (!probe.supported) {
      throw new Error(
        `memon: squeue probe failed (${probe.reason ?? 'unknown'}). ` +
          `The slurm-status widget requires \`squeue --me\` to work. ` +
          `Set \`slurm.total_nodes: -1\` in ${configPath} to disable the feature.`,
      )
    }
    slurm = { enabled: true, totalNodes: config.slurm.totalNodes, supported: true }
  }

  // Startup-only scheduler configuration for the project file store. Saved
  // settings apply at boot; nothing hot-applies mid-process.
  configureProjectFileStore(config.fileAccess ?? {})
  await configureProjectFileCache(config.fileCache)

  // Projects served directly through the project file store are read on
  // demand, per request, with bounded scheduled I/O. They must never enter
  // the legacy warm caches or the poller: that is exactly the continuous
  // whole-project scan this deployment mode removes. The legacy runtime stays
  // intact for project-only (standalone) instances.
  const legacyProjects = servesProjectsDirectly(config) ? [] : config.projects

  const index = new RunIndex()
  const events = new EventEmitter()
  events.setMaxListeners(50)

  // Per-project file caches for docs/hypotheses.md / docs/journal.md
  const hypothesesPaths = legacyProjects.map((p) => join(p.root, 'docs', 'hypotheses.md'))
  const journalPaths = legacyProjects.map((p) => join(p.root, 'docs', 'journal.md'))

  const hypothesesCache = new FileCache<ParsedHypotheses>({
    name: 'hypotheses',
    paths: hypothesesPaths,
    parse: parseHypotheses,
    onUpdate: (path) => {
      const project = config.projects.find(
        (candidate) => path === join(candidate.root, 'docs', 'hypotheses.md'),
      )
      if (!project) return
      wikiCache.invalidate(project.name)
      events.emit('wiki-change', { project: project.name })
    },
  })
  const journalCache = new FileCache<ParsedJournal>({
    name: 'journal',
    paths: journalPaths,
    parse: parseJournal,
  })

  // Per-project directory cache for docs/reports/.
  const reportsDirs = legacyProjects.map((p) => join(p.root, 'docs', 'reports'))

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
      if (!project) return
      events.emit('reports-change', { project })
      // Legacy `R<NNNN>` resolution depends on which reports still exist.
      wikiCache.invalidate(project)
    },
  })

  // Per-project code-review docs at the flat docs/code-review/ (project-wide)
  // plus the dynamic set of docs/experiments/E*/code-review/ (experiment-
  // scoped, seeded after experiment discovery below).
  const codeReviewsCache = new DirCache<CodeReviewSummary>({
    name: 'code-reviews',
    dirs: legacyProjects.map((p) => join(p.root, 'docs', 'code-review')),
    fileNameRegex: CODE_REVIEW_FILENAME_REGEX,
    parseFile: (absPath, content, mtime): CodeReviewSummary => {
      const { frontmatter: fm } = parseCodeReview(content)
      const proj = config.projects.find((p) => absPath.startsWith(join(p.root, 'docs') + '/'))
      const docsRoot = proj ? join(proj.root, 'docs') : dirname(dirname(absPath))
      const id = relative(docsRoot, absPath).replace(/\.md$/, '')
      const scope: 'project' | 'experiment' = id.startsWith('experiments/')
        ? 'experiment'
        : 'project'
      let experiment = fm.experiment
      if (!experiment && scope === 'experiment') {
        const m = /^experiments\/(E\d{4}-[a-z0-9-]+)\/code-review\//.exec(id)
        experiment = m ? m[1]! : null
      }
      const fn = CODE_REVIEW_FILENAME_REGEX.exec(basename(absPath))
      return {
        id,
        scope,
        experiment,
        title: fm.title,
        date: fn ? fn[1]! : '',
        createdAt: fm.createdAt,
        updatedAt: fm.updatedAt,
        path: absPath,
        mtime,
        completion: deriveCompletion(fm),
      }
    },
    onUpdate: (dir) => {
      const project = projectForDir(config, dir)
      if (project) events.emit('code-reviews-change', { project })
    },
  })

  // Shared, mutable state captured by both the Poller closure and the
  // Runtime instance. The Runtime constructor takes these by reference so
  // poll-driven mutations and API-route reads see the same Map.
  const sharedExperiments: Map<string, Experiment> = new Map()
  const sharedAnomalies: Map<string, ExperimentMembershipAnomaly[]> = new Map()
  const recomputeAnomalies = (projectName: string) => {
    const exps = Array.from(sharedExperiments.values()).filter((e) => e.project === projectName)
    // Membership needs the full Run set: a deprecated Run is still bound to
    // its Experiment, and hiding it here would report it as a phantom
    // reference. Deprecation filtering belongs to the collection endpoints.
    const runs = index.list({ project: projectName, includeDeprecated: true })
    const root = config.projects.find((project) => project.name === projectName)?.root
    const legacyCounts = new Map<string, number>()
    for (const run of runs) legacyCounts.set(run.id, (legacyCounts.get(run.id) ?? 0) + 1)
    if (root) for (const run of runs) {
      const reference = projectRunPath(root, run.path)
      const owners = exps.filter((experiment) => experiment.frontMatter.runs.includes(reference) || (legacyCounts.get(run.id) === 1 && experiment.frontMatter.runs.includes(run.id)))
      run.frontMatter.experiment = owners.length === 1 ? owners[0]!.id : null
    }
    const result = computeMembership({ experiments: exps, runs, project: projectName, projectRoot: config.projects.find((project) => project.name === projectName)?.root })
    sharedAnomalies.set(projectName, result.anomalies)
    events.emit('anomaly', { project: projectName, count: result.anomalies.length })
  }

  // Wiki pages (docs/wiki/<kind>/…). The projection needs the Experiment
  // index, the run index, the hypotheses file, and the report id set, so the
  // cache pulls them through this closure on every rebuild — never from disk.
  const wikiComponentNames = Array.from(
    new Set(listComponents().map((descriptor) => descriptor.name)),
  )
  const wikiCache = new WikiCache({
    projects: legacyProjects.map((p) => ({ name: p.name, root: p.root })),
    context: (project) => {
      const hypotheses = hypothesesCache.get(join(project.root, 'docs', 'hypotheses.md'))
      return {
        experiments: Array.from(sharedExperiments.values()).filter(
          (e) => e.project === project.name,
        ),
        runs: index.list({ project: project.name, includeDeprecated: true }).map((run) => ({ ...run, id: projectRunPath(project.root, run.path) })),
        hypothesesMtime: hypotheses?.mtime ? hypotheses.mtime : null,
        hypothesisIds: (hypotheses?.value?.entries ?? []).map((entry) => entry.id),
        reportIds: reportsCache
          .getList(join(project.root, 'docs', 'reports'))
          .map((report) => report.id),
        componentNames: wikiComponentNames,
      }
    },
    onChange: (project) => events.emit('wiki-change', { project }),
    onReviewChange: (project) => events.emit('wiki-review-change', { project }),
  })

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
      if (codeReviewsCache.handlePollChange(path, poller)) return
      // Wiki tree, `.memon/wiki-review.csv`, and the git HEAD/ref pair.
      if (wikiCache.handlePollChange(path, poller)) return

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
            // Register README, managed YAML sidecars, and the bundle directory
            // so direct Agent edits and sidecar creation/deletion are visible.
            await watchExperimentBundle(poller, e)
          }
          // Replace the project's slice of the experiments map.
          for (const id of Array.from(sharedExperiments.keys())) {
            const cur = sharedExperiments.get(id)!
            if (cur.project !== expDirMatch.name) continue
            if (!seen.has(id)) {
              unwatchExperimentBundle(poller, cur)
              sharedExperiments.delete(id)
            }
          }
          for (const e of discovered) sharedExperiments.set(e.id, e)
          // Reconcile the dynamic set of experiment-scoped code-review dirs:
          // add subdirs for newly-seen experiments, drop those for vanished
          // ones. The flat docs/code-review/ dir is never touched here.
          const desiredCrDirs = new Set(discovered.map((e) => join(dirname(e.path), 'code-review')))
          const expsRoot = join(expDirMatch.root, 'docs', 'experiments') + '/'
          for (const d of codeReviewsCache.dirs()) {
            if (d.startsWith(expsRoot) && !desiredCrDirs.has(d)) {
              codeReviewsCache.removeDir(d)
            }
          }
          for (const d of desiredCrDirs) {
            if (!codeReviewsCache.dirs().includes(d)) {
              await codeReviewsCache.addDir(d, poller)
            }
          }
          events.emit('code-reviews-change', { project: expDirMatch.name })
          recomputeAnomalies(expDirMatch.name)
          // Cited-Experiment times drive `stale` / `citedBy`.
          wikiCache.invalidate(expDirMatch.name)
          events.emit('experiment-change', { type: 'rediscover', project: expDirMatch.name })
        } catch {
          // Best-effort — keep existing state on transient errors.
        }
        return
      }

      // Individual Experiment bundle change: README.md, any managed YAML
      // sidecar, or the bundle directory itself. Also tolerate the legacy v4
      // file form (`docs/experiments/E*.md`) during migration.
      const expFileMatch = config.projects.find((p) =>
        path.startsWith(join(p.root, 'docs', 'experiments') + '/'),
      )
      if (expFileMatch) {
        const expId = experimentIdForWatchedPath(expFileMatch.root, path)
        if (expId) {
          try {
            const updated = await readExperimentDoc(expFileMatch.root, expFileMatch.name, expId)
            if (updated) {
              sharedExperiments.set(expId, updated)
              await watchExperimentBundle(poller, updated)
            } else {
              const previous = sharedExperiments.get(expId)
              if (previous) unwatchExperimentBundle(poller, previous)
              sharedExperiments.delete(expId)
            }
            recomputeAnomalies(expFileMatch.name)
            wikiCache.invalidate(expFileMatch.name)
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
        // A cited run's own update time feeds page staleness.
        wikiCache.invalidate(projectMatch.name)
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
    codeReviewsCache.warmup(),
    wikiCache.warmup(),
    (async () => {
      for (const project of legacyProjects) {
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
      for (const project of legacyProjects) {
        const { experiments: docs } = await discoverExperiments(project.root, project.name)
        experimentsByProject.set(project.name, docs)
        // Register the docs/experiments/ dir for poll tracking + each
        // discovered bundle for individual README/YAML/directory watches.
        const expDir = join(project.root, 'docs', 'experiments')
        poller.watch(expDir, await dirMtimeOrZero(expDir))
        for (const doc of docs) {
          await watchExperimentBundle(poller, doc)
        }
      }
    })(),
  ])

  // Seed the dynamic set of experiment-scoped code-review dirs (one level
  // deeper than the flat docs/code-review/). Tolerant of dirs that don't exist
  // yet — the Poller detects their creation like any watched directory. Poller
  // registration for these dirs + their files happens in the loop below.
  for (const [, docs] of experimentsByProject) {
    for (const doc of docs) {
      await codeReviewsCache.addDir(join(dirname(doc.path), 'code-review'))
    }
  }

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

  // Register dir-level + per-file observations for reports. Both the
  // directory mtime (advances on add/remove) and each individual file
  // (advances on edit) are watched.
  for (const dir of reportsCache.dirs()) {
    poller.watch(dir, await dirMtimeOrZero(dir))
  }
  for (const filePath of reportsCache.paths()) {
    poller.watch(filePath, await fileMtimeOrZero(filePath))
  }
  for (const dir of codeReviewsCache.dirs()) {
    poller.watch(dir, await dirMtimeOrZero(dir))
  }
  for (const filePath of codeReviewsCache.paths()) {
    poller.watch(filePath, await fileMtimeOrZero(filePath))
  }
  // Wiki: `docs/wiki/` itself, every kind directory, every page file, plus
  // the git HEAD / branch ref / review-store trio that invalidates review.
  for (const dir of wikiCache.dirs()) {
    poller.watch(dir, await dirMtimeOrZero(dir))
  }
  for (const filePath of wikiCache.paths()) {
    poller.watch(filePath, await fileMtimeOrZero(filePath))
  }
  await wikiCache.watchGitPaths(poller)

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
      `${reportsCache.paths().length} reports, ` +
      `${codeReviewsCache.paths().length} code-reviews, ` +
      `${wikiCache.paths().length} wiki pages`,
  )

  // Seed shared maps (used by both the poller closure and the Runtime
  // instance, by reference) before constructing the Runtime.
  for (const [, docs] of experimentsByProject) {
    for (const doc of docs) sharedExperiments.set(doc.id, doc)
  }
  // Wiki warmup runs alongside Experiment/Run discovery. Rebuild once more
  // after those in-memory indexes are fully seeded so the first request sees
  // final staleness/backlink state without doing projection work itself.
  wikiCache.invalidateAll()

  const runtime = new Runtime(
    config,
    configPath,
    index,
    poller,
    events,
    hypothesesCache,
    journalCache,
    reportsCache,
    codeReviewsCache,
    wikiCache,
    auth,
    sharedExperiments,
    sharedAnomalies,
    recomputeAnomalies,
    slurm,
  )
  for (const [projectName] of experimentsByProject) {
    recomputeAnomalies(projectName)
  }

  return runtime
}

function projectForDir(config: Config, dir: string): string | null {
  for (const p of config.projects) {
    if (dir === join(p.root, 'docs', 'reports')) return p.name
  }
  // Code-review dirs: the flat docs/code-review/ or any nested
  // docs/experiments/E*/code-review/.
  for (const p of config.projects) {
    const docs = join(p.root, 'docs')
    if (dir === join(docs, 'code-review')) return p.name
    if (dir.startsWith(docs + '/') && dir.endsWith('/code-review')) return p.name
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

const MANAGED_EXPERIMENT_FILE_NAMES = Object.values(MANAGED_DOCUMENT_FILE_NAMES)

export function experimentIdForWatchedPath(
  projectRoot: string,
  watchedPath: string,
): string | null {
  const experimentsRoot = join(projectRoot, 'docs', 'experiments')
  if (!watchedPath.startsWith(`${experimentsRoot}/`)) return null
  const filename = basename(watchedPath)
  if (EXPERIMENT_DIR_REGEX.test(filename) && dirname(watchedPath) === experimentsRoot) {
    return filename
  }
  if (filename === 'README.md' || MANAGED_EXPERIMENT_FILE_NAMES.includes(filename)) {
    const parent = basename(dirname(watchedPath))
    return EXPERIMENT_DIR_REGEX.test(parent) ? parent : null
  }
  const legacy = EXPERIMENT_FILENAME_REGEX.exec(filename)
  return legacy && dirname(watchedPath) === experimentsRoot ? filename.replace(/\.md$/, '') : null
}

export async function watchExperimentBundle(poller: Poller, experiment: Experiment): Promise<void> {
  poller.watch(experiment.path, experiment.readmeMtime)
  if (basename(experiment.path) !== 'README.md') return
  const directory = dirname(experiment.path)
  poller.watch(directory, await dirMtimeOrZero(directory))
  for (const fileName of MANAGED_EXPERIMENT_FILE_NAMES) {
    const sidecar = join(directory, fileName)
    poller.watch(sidecar, await fileMtimeOrZero(sidecar))
  }
}

function unwatchExperimentBundle(poller: Poller, experiment: Experiment): void {
  poller.unwatch(experiment.path)
  if (basename(experiment.path) !== 'README.md') return
  const directory = dirname(experiment.path)
  poller.unwatch(directory)
  for (const fileName of MANAGED_EXPERIMENT_FILE_NAMES) {
    poller.unwatch(join(directory, fileName))
  }
}
