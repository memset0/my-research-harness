// Shared config resolution used by every CLI subcommand.
//
// Per spec/memon-cli:
//   - Explicit --config wins over cwd/config.yml
//   - For non-`serve` commands, missing config falls back to implicit cwd-as-project
//   - `serve` requires an explicit config OR a cwd config.yml (no implicit mode)

import { ConfigError, implicitCwdProject, loadConfig, type Config } from '@memon/core'

export interface GlobalOptions {
  config?: string
  format?: 'json' | 'human'
}

export interface ResolveOptions {
  /** Explicit config path from CLI (--config). */
  configPath?: string
  cwd: string
  /**
   * If true, missing config errors out (used by `memon serve`).
   * If false, missing config falls back to cwd-as-project mode.
   */
  requireExplicit: boolean
}

export async function resolveConfig(opts: ResolveOptions): Promise<Config> {
  const cfg = await loadConfig({ explicitPath: opts.configPath, cwd: opts.cwd })
  if (cfg) return cfg
  if (opts.requireExplicit) {
    throw new ConfigError(
      'no config.yml found in cwd; pass --config <path> or create one (see config.example.yml)',
    )
  }
  return implicitCwdProject(opts.cwd)
}
