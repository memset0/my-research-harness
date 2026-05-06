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
  DIGEST_FILENAME_REGEX,
  ExperimentIndex,
  Poller,
  REPORT_FILENAME_REGEX,
  discoverExperiments,
  extractTitle,
  loadConfig,
  parseHypotheses,
  parseJournal,
  readExperimentDir,
  type AuthConfig,
  type Config,
  type DigestSummary,
  type Experiment,
  type ParsedHypotheses,
  type ParsedJournal,
  type ReportSummary,
} from '@memon/core'
import { DirCache } from './runtime/dir-cache'
import { FileCache } from './runtime/file-cache'
import { ensureAuthInitialised } from './auth/first-run'

export interface ExperimentChangeEvent {
  type: 'set' | 'delete'
  experiment?: Experiment
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
    public readonly index: ExperimentIndex,
    public readonly poller: Poller,
    public readonly events: EventEmitter,
    public readonly hypothesesCache: FileCache<ParsedHypotheses>,
    public readonly journalCache: FileCache<ParsedJournal>,
    public readonly reportsCache: DirCache<ReportSummary>,
    public readonly digestsCache: DirCache<DigestSummary>,
    public readonly auth: AuthConfig,
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

  const index = new ExperimentIndex()
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

      // Otherwise this is an experiment directory.
      const projectMatch = config.projects.find(
        (p) => path === p.root || path.startsWith(`${p.root}/`),
      )
      if (!projectMatch) return
      try {
        const exp = await readExperimentDir(path, projectMatch.name)
        index.set(exp)
        events.emit('experiment-change', { type: 'set', id: exp.id, experiment: exp })
      } catch {
        // If directory disappeared, drop from index silently
      }
    },
  )

  // Initial scan + parse + watch — file caches, dir caches and experiment
  // scan in parallel.
  const t0 = Date.now()
  await Promise.all([
    hypothesesCache.warmup(),
    journalCache.warmup(),
    reportsCache.warmup(),
    digestsCache.warmup(),
    (async () => {
      for (const project of config.projects) {
        const dirs = await discoverExperiments(project)
        for (const dir of dirs) {
          try {
            const exp = await readExperimentDir(dir, project.name)
            index.set(exp)
            poller.watch(dir, exp.mtime)
          } catch {
            // Skip unreadable directories
          }
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

  // eslint-disable-next-line no-console
  console.log(
    `memon: warmup complete in ${Date.now() - t0}ms — ${index.size()} experiments, ` +
      `${hypothesesCache.populated()}/${hypothesesPaths.length} hypotheses files, ` +
      `${journalCache.populated()}/${journalPaths.length} journal files, ` +
      `${reportsCache.paths().length} reports, ${digestsCache.paths().length} digests`,
  )

  return new Runtime(
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
  )
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
