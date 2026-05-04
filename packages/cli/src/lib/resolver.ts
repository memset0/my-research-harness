// Shared config resolution used by every CLI subcommand.
//
// Per spec/memon-cli:
//   - Explicit --config wins over cwd/config.yml
//   - For non-`serve` commands, missing config falls back to implicit cwd-as-project
//   - `serve` requires an explicit config OR a cwd config.yml (no implicit mode)

import {
  ConfigError,
  DEFAULT_POLL,
  implicitCwdProject,
  loadConfig,
  type Config,
} from '@memon/core'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export interface GlobalOptions {
  config?: string
  format?: 'json' | 'human'
  projectRoot?: string
}

export interface ResolveOptions {
  /** Explicit config path from CLI (--config). */
  configPath?: string
  /** `--project-root <path>` — bypasses config entirely. Mutually exclusive with configPath. */
  projectRoot?: string
  cwd: string
  /**
   * If true, missing config errors out (used by `memon serve`).
   * If false, missing config falls back to cwd-as-project mode.
   */
  requireExplicit: boolean
}

export async function resolveConfig(opts: ResolveOptions): Promise<Config> {
  if (opts.projectRoot) {
    if (opts.configPath) {
      throw new ConfigError('--project-root cannot be combined with --config')
    }
    const abs = resolve(opts.projectRoot)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new ConfigError(`project root does not exist or is not a directory: ${abs}`)
    }
    return {
      projects: [{ name: '(project-root)', root: abs, include: [], exclude: [] }],
      poll: { ...DEFAULT_POLL },
    }
  }
  const cfg = await loadConfig({ explicitPath: opts.configPath, cwd: opts.cwd })
  if (cfg) return cfg
  if (opts.requireExplicit) {
    throw new ConfigError(
      'no config.yml found in cwd; pass --config <path> or --project-root <path>, or create config.yml (see config.example.yml)',
    )
  }
  return implicitCwdProject(opts.cwd)
}
