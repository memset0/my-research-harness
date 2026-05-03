// Module-level singleton holding the live experiment index, poller, and event
// bus shared across all API routes.
//
// Lifecycle:
//   - Initialized lazily on first request (so importing the module is cheap)
//   - Kept across requests in the Next.js dev server (module state persists)
//   - Re-initialized only when this module is HMR'd; that's acceptable in dev
//
// Production model: `memon serve` spawns Next.js with MEMON_CONFIG_PATH set;
// in dev `pnpm --filter @memon/web dev` we walk up to find the repo's
// config.yml (or config.example.yml as last-resort fallback).

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  ExperimentIndex,
  Poller,
  discoverExperiments,
  loadConfig,
  readExperimentDir,
  type Config,
  type Experiment,
} from '@memon/core'
import { EventEmitter } from 'node:events'

export interface ExperimentChangeEvent {
  type: 'set' | 'delete'
  experiment?: Experiment
  id: string
}

export class Runtime {
  constructor(
    public readonly config: Config,
    public readonly configPath: string,
    public readonly index: ExperimentIndex,
    public readonly poller: Poller,
    public readonly events: EventEmitter,
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

  const poller = new Poller(
    {
      minIntervalMs: config.poll.minIntervalMs,
      maxIntervalMs: config.poll.maxIntervalMs,
      backoffFactor: config.poll.backoffFactor,
    },
    async (path) => {
      // Find the owning project
      const projectMatch = config.projects.find(
        (p) => path === p.root || path.startsWith(`${p.root}/`),
      )
      if (!projectMatch) return
      try {
        const exp = await readExperimentDir(path, projectMatch.name)
        index.set(exp)
        events.emit('experiment-change', { type: 'set', id: exp.id, experiment: exp })
      } catch {
        // If directory disappeared, drop from index
        // (mtime poller would otherwise keep firing for a missing path)
      }
    },
  )

  // Initial scan + watch
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

  return new Runtime(config, configPath, index, poller, events)
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
