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
import { dirname, join } from 'node:path'
import { EventEmitter } from 'node:events'
import {
  ExperimentIndex,
  Poller,
  discoverExperiments,
  loadConfig,
  parseHypotheses,
  parseJournal,
  readExperimentDir,
  type Config,
  type Experiment,
  type ParsedHypotheses,
  type ParsedJournal,
} from '@memon/core'
import { FileCache } from './runtime/file-cache'

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

  /** Path to <project>/HYPOTHESES.md for the given project name (or null). */
  hypothesesPath(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'HYPOTHESES.md') : null
  }

  /** Path to <project>/JOURNAL.md for the given project name (or null). */
  journalPath(project: string): string | null {
    const p = this.config.projects.find((x) => x.name === project)
    return p ? join(p.root, 'JOURNAL.md') : null
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

  const index = new ExperimentIndex()
  const events = new EventEmitter()
  events.setMaxListeners(50)

  // Per-project file caches for HYPOTHESES.md / JOURNAL.md
  const hypothesesPaths = config.projects.map((p) => join(p.root, 'HYPOTHESES.md'))
  const journalPaths = config.projects.map((p) => join(p.root, 'JOURNAL.md'))

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

  // Initial scan + parse + watch — file caches and experiment scan in parallel.
  const t0 = Date.now()
  await Promise.all([
    hypothesesCache.warmup(),
    journalCache.warmup(),
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

  // eslint-disable-next-line no-console
  console.log(
    `memon: warmup complete in ${Date.now() - t0}ms — ${index.size()} experiments, ` +
      `${hypothesesCache.populated()}/${hypothesesPaths.length} hypotheses files, ` +
      `${journalCache.populated()}/${journalPaths.length} journal files`,
  )

  return new Runtime(
    config,
    configPath,
    index,
    poller,
    events,
    hypothesesCache,
    journalCache,
  )
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
